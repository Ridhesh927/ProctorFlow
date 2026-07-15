import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Sidebar as SidebarIcon,
  Flag,
  Edit3
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import Peer from 'simple-peer';
import * as faceapi from 'face-api.js';
import { getToken, getUser } from '../../utils/auth';
import Skeleton from '../../components/Skeleton';
import RoughWorkPad from '../../components/RoughWorkPad';




const TakeExam = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState<number>(3600); // default, will be overridden by exam data
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRoughPad, setShowRoughPad] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const warningCountRef = useRef(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isExamTerminated, setIsExamTerminated] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  // Real exam data state
  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<{ [key: number]: number }>({});
  const [markedForReview, setMarkedForReview] = useState<Set<number>>(new Set());
  const answersRef = useRef<{ [questionId: number]: number }>({});
  const [examLoading, setExamLoading] = useState(true);
  const [examError, setExamError] = useState<string | null>(null);

  // Face detection states
  const [faceCount, setFaceCount] = useState(0);
  const [multipleFaceWarnings, setMultipleFaceWarnings] = useState(0);
  const multipleFaceWarningsRef = useRef(0);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const lastViolationTimeRef = useRef(0);
  const [detectionStabilized, setDetectionStabilized] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<{ [key: string]: Peer.Instance }>({});
  const hasStarted = useRef(false);
  const lastFullscreenState = useRef(false);
  const detectionIntervalRef = useRef<number | null>(null);
  const consecutiveMultipleFaces = useRef(0);

  // Fetch real exam data from API
  useEffect(() => {
    const fetchExam = async () => {
      try {
        const token = getToken('student');
        const res = await axios.get(`/api/exams/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = res.data;
        setExam(data);

        // Parse questions - options may be JSON string or array
        const parsedQuestions = (data.questions || []).map((q: any) => ({
          ...q,
          options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
        }));
        setQuestions(parsedQuestions);

        // Set timer from exam duration (minutes -> seconds)
        if (data.duration) {
          setTimeLeft(data.duration * 60);
        }

        // LOAD AUTO-SAVED ANSWERS
        const savedProgress = localStorage.getItem(`exam_progress_${id}`);
        if (savedProgress) {
            const { answers: savedAnswers, timeLeft: savedTime } = JSON.parse(savedProgress);
            setAnswers(savedAnswers);
            answersRef.current = savedAnswers;
            if (savedTime && savedTime < data.duration * 60) {
                setTimeLeft(savedTime);
            }
            console.log('[AUTO_RESUME] Restored progress from local storage.');
        }

      } catch (err: any) {
        console.error('Failed to fetch exam:', err);
        setExamError(err.response?.data?.message || 'Failed to load exam. Please try again.');
      } finally {
        setExamLoading(false);
      }
    };
    if (id) fetchExam();
  }, [id]);

  // Handle selecting an answer
  const selectAnswer = (questionId: number, optionIndex: number) => {
    const newAnswers = { ...answers, [questionId]: optionIndex };
    setAnswers(newAnswers);
    answersRef.current = newAnswers;
    
    // Immediate local save
    localStorage.setItem(`exam_progress_${id}`, JSON.stringify({
        answers: newAnswers,
        timeLeft,
        lastSaved: Date.now()
    }));
  };

  // Periodic Backend Sync (every 30s)
  useEffect(() => {
    if (!sessionId || isExamTerminated || !hasStarted.current) return;

    const syncProgress = async () => {
        try {
            const token = getToken('student');
            await axios.post('/api/exams/session/response', {
                examId: Number(id),
                answers: answersRef.current
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('[AUTO_SYNC] Progress synced to server.');
        } catch (err) {
            console.error('[AUTO_SYNC] Failed to sync progress:', err);
        }
    };

    const interval = setInterval(syncProgress, 30000);
    return () => clearInterval(interval);
  }, [sessionId, isExamTerminated]);

  const toggleMarkForReview = () => {
    if (questions.length === 0) return;
    const qId = questions[currentQuestion].id;
    setMarkedForReview(prev => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  };

  const handleRoughWorkUpdate = (content: string) => {
    if (socketRef.current) {
        const user = getUser('student') || {};
        socketRef.current.emit('rough-work-update', {
            examId: Number(id),
            userId: user.id || 0,
            content
        });
    }
  };


  const answeredCount = Object.keys(answers).length;

  // Load face detection models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        setModelsLoaded(true);
        console.log('Face detection models loaded successfully');
      } catch (err) {
        console.error('Failed to load face detection models:', err);
      }
    };
    loadModels();
  }, []);

  // Face detection loop
  useEffect(() => {
    if (!isFullscreen || !hasStarted.current || !modelsLoaded || !videoRef.current || isExamTerminated) {
      return;
    }

    const detectFaces = async () => {
      if (!videoRef.current || videoRef.current.readyState !== 4) return;

      try {
        const detections = await faceapi.detectAllFaces(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 })
        );

        const currentFaceCount = detections.length;
        setFaceCount(currentFaceCount);

        // Check for invalid face count (must be exactly 1)
        if (currentFaceCount !== 1) {
          consecutiveMultipleFaces.current += 1;

          // Require 2 consecutive detections to avoid false positives
          if (consecutiveMultipleFaces.current >= 2) {
            const now = Date.now();
            // Prevent duplicate warnings within 5 seconds
            if (now - lastViolationTimeRef.current > 5000) {
              handleFaceViolation(currentFaceCount);
              lastViolationTimeRef.current = now;
            }
          }
        } else {
          consecutiveMultipleFaces.current = 0;
        }
      } catch (err) {
        console.error('Face detection error:', err);
      }
    };

    // Run detection every 2 seconds
    const interval = window.setInterval(detectFaces, 2000);
    detectionIntervalRef.current = interval;

    // Stabilize detection after 6 seconds (3 detection cycles)
    const stabilizeTimeout = setTimeout(() => {
      setDetectionStabilized(true);
    }, 6000);

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
      clearTimeout(stabilizeTimeout);
    };
  }, [isFullscreen, modelsLoaded, isExamTerminated]);

  // Handle face violation
  const handleFaceViolation = async (detectedFaces: number) => {
    const newWarningCount = multipleFaceWarningsRef.current + 1;
    multipleFaceWarningsRef.current = newWarningCount;
    setMultipleFaceWarnings(newWarningCount);

    const violationType = detectedFaces === 0 ? 'No face detected' : `Multiple faces detected (${detectedFaces})`;
    console.log(`Face violation: ${violationType}. Warning ${newWarningCount}/3`);

    // Log to backend
    if (sessionId) {
      try {
        await axios.post('/api/exams/session/warning', {
          sessionId,
          warningType: detectedFaces === 0 ? 'no-face' : 'multiple-faces',
          message: `${violationType}. Warning ${newWarningCount}/3`
        });

        // Emit socket event for real-time teacher alert
        if (socketRef.current) {
          socketRef.current.emit('face-violation', {
            sessionId,
            faceCount: detectedFaces,
            warningNumber: newWarningCount,
            timestamp: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error('Failed to log face violation:', err);
      }
    }

    // Auto-terminate after 3 warnings
    if (newWarningCount >= 3) {
      terminateExam('Multiple face violations (3/3 warnings)');
    }
  };

  // Fullscreen enforcement and Warning Logic
  useEffect(() => {
    const handleFullscreenChange = () => {
      const currentFull = !!document.fullscreenElement;
      setIsFullscreen(currentFull);

      // If we were in fullscreen and exited, and the exam has started
      if (lastFullscreenState.current && !currentFull && hasStarted.current && !isExamTerminated) {
        handleViolation("Fullscreen Exited");
      } else if (currentFull && hasStarted.current && !isExamTerminated) {
        setTimeout(() => {
          if (window.innerWidth < window.screen.width * 0.95) {
            handleViolation("Browser Sidebar/Split Screen Detected");
          }
        }, 500);
      }

      lastFullscreenState.current = currentFull;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && hasStarted.current && !isExamTerminated) {
        handleViolation("Tab Switched/Minimized");
      }
    };

    const handleBlur = () => {
      if (hasStarted.current && !isExamTerminated) {
        handleViolation("Window Focus Lost");
      }
    };

    const handleResize = () => {
      if (document.fullscreenElement && hasStarted.current && !isExamTerminated) {
        if (window.innerWidth < window.screen.width * 0.95) {
          handleViolation("Browser Sidebar/Split Screen Detected");
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', handleResize);
    };
  }, [sessionId, isExamTerminated, warningCount]);

  useEffect(() => {
    if (warningCount >= 3 && !isExamTerminated) {
      terminateExam();
    }
  }, [warningCount, isExamTerminated]);

  const handleViolation = async (type: string) => {
    const newCount = warningCountRef.current + 1;
    warningCountRef.current = newCount;
    setWarningCount(newCount);

    if (sessionId) {
      try {
        await axios.post('/api/exams/session/warning', {
          sessionId,
          warningType: type,
          message: `${type} detected (Total warnings: ${newCount})`
        });
      } catch (err) {
        console.error("Failed to log warning", err);
      }
    }
  };

  const terminateExam = (reason: string = 'Rule violations') => {
    setIsExamTerminated(true);

    // Stop face detection
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { });
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }

    console.log(`Exam terminated: ${reason}`);

    // Finalize session in DB with actual answers
    const token = getToken('student');
    axios.post('/api/exams/submit', {
      examId: id,
      answers: answersRef.current,
      completionTime: (exam?.duration ? exam.duration * 60 : 3600) - timeLeft
    }, {
      headers: { Authorization: `Bearer ${token}` }
    }).then((response) => {
      if (response.data?.resultId && response.data?.recommendations) {
        sessionStorage.setItem('latest_exam_recommendations', JSON.stringify({
          resultId: response.data.resultId,
          recommendations: response.data.recommendations
        }));
      }
    }).catch(err => console.error("Auto-submit failed", err));
  };

  const handleSubmit = async () => {
    setShowSubmitModal(true);
  };

  const confirmSubmit = async () => {
    setShowSubmitModal(false);

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => { });
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }

    try {
      const token = getToken('student');
      const response = await axios.post('/api/exams/submit', {
        examId: id,
        answers,
        completionTime: (exam?.duration ? exam.duration * 60 : 3600) - timeLeft
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      localStorage.removeItem(`exam_progress_${id}`);

      if (response.data?.resultId && response.data?.recommendations) {
        sessionStorage.setItem('latest_exam_recommendations', JSON.stringify({
          resultId: response.data.resultId,
          recommendations: response.data.recommendations
        }));
      }
      navigate('/student/results');
    } catch (err) {
      console.error("Submission failed", err);
      navigate('/student/results');
    }
  };

  const enterFullscreen = async () => {
    setPermissionError(null);
    try {
      // 1. Request Camera & Mic simultaneously
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;

      // 2. Enter Fullscreen
      const element = document.documentElement;
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      }

      // 3. Start Session & Sync Video
      if (!hasStarted.current) {
        hasStarted.current = true;
        try {
          const token = getToken('student');
          const res = await axios.post('/api/exams/session/start',
            { examId: id },
            {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            }
          );
          const newSessionId = res.data.sessionId;
          setSessionId(newSessionId);

          // Initialize Socket and Signaling
          const socket = io({
            auth: { token }
          });
          socketRef.current = socket;
          const user = getUser('student') || {};

          socket.emit('join-room', {
            examId: Number(id),
            userId: user.id || 0,
            role: 'student',
            name: user.username || user.name || 'Student',
            sessionId: newSessionId
          });

          socket.on('teacher-online', (data: { teacherId: string }) => {
            if (localStream.current) {
              const peer = createPeer(data.teacherId, socket.id!, localStream.current);
              peersRef.current[data.teacherId] = peer;
            }
          });

          socket.on('signal', (data: { from: string, signal: any }) => {
            const peer = peersRef.current[data.from];
            if (peer) {
              peer.signal(data.signal);
            } else if (localStream.current) {
              const peer = addPeer(data.signal, data.from, localStream.current);
              peersRef.current[data.from] = peer;
            }
          });

          socket.on('warning-received', (payload: { message?: string }) => {
            const nextWarningCount = warningCountRef.current + 1;
            warningCountRef.current = nextWarningCount;
            setWarningCount(nextWarningCount);
            if (payload?.message) {
              console.log('[TEACHER_WARNING]', payload.message);
            }
          });

          socket.on('student-session-action', (payload: { actionType?: string, reason?: string }) => {
            const actionType = payload?.actionType || 'terminate';
            if (actionType === 'suspend' || actionType === 'terminate') {
              terminateExam(payload?.reason || `Session ${actionType} by invigilator.`);
            }
          });

          socket.on('voice-alert', (payload: { message: string }) => {
            if ('speechSynthesis' in window && payload.message) {
                const utterance = new SpeechSynthesisUtterance(payload.message);
                utterance.rate = 0.9;
                utterance.pitch = 1;
                window.speechSynthesis.speak(utterance);
                console.log('[VOICE_INTERVENTION]', payload.message);
            }
          });

        } catch (err) {
          console.error("Failed to start session", err);
          setSessionId(Math.floor(Math.random() * 1000));
        }
      }

      // Small delay to ensure Ref is attached when entering fullscreen
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = localStream.current;
      }, 500);

    } catch (err: any) {
      console.error("Permission denied:", err);
      setPermissionError("Proctoring Error: Camera and Microphone access are mandatory to begin the examination. Please grant permissions in your browser bar and try again.");
    }
  };

  const createPeer = (userToSignal: string, callerId: string, stream: MediaStream) => {
    const user = getUser('student') || {};
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
    });

    peer.on('signal', (signal) => {
      socketRef.current?.emit('signal', { to: userToSignal, from: callerId, signal, userId: user.id });
    });

    return peer;
  };

  const addPeer = (incomingSignal: any, callerId: string, stream: MediaStream) => {
    const user = getUser('student') || {};
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
    });

    peer.on('signal', (signal) => {
      socketRef.current?.emit('signal', { to: callerId, from: socketRef.current.id, signal, userId: user.id });
    });

    peer.signal(incomingSignal);
    return peer;
  };

  // Timer logic
  useEffect(() => {
    if (!isFullscreen) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isFullscreen]);

  // Periodic Snapshots logic (every 5 minutes)
  useEffect(() => {
    if (!sessionId || !hasStarted.current || isExamTerminated) return;

    const takeSnapshot = async () => {
      if (!videoRef.current || videoRef.current.readyState !== 4) return;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0);
          const snapshotData = canvas.toDataURL('image/webp', 0.5); // Compressed webp

          const token = getToken('student');
          await axios.post('/api/exams/session/snapshot', {
            sessionId,
            snapshotData
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          console.log('[SNAPSHOT_CAPTURED] Secret security frame stored.');
        }
      } catch (err) {
        console.error('Failed to capture snapshot:', err);
      }
    };

    // Initial snapshot after 1 minute of starting
    const initialDelay = setTimeout(takeSnapshot, 60000);
    
    // Then every 5 minutes
    const interval = setInterval(takeSnapshot, 300000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [sessionId, isExamTerminated]);

  // Sync video ref on mount or session start
  useEffect(() => {
    return () => {
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => track.stop());
      }
      socketRef.current?.disconnect();
      Object.values(peersRef.current).forEach(p => p.destroy());
    };
  }, []);

  // Timer logic stays the same
  useEffect(() => {
    if (!isFullscreen) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isFullscreen]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (isExamTerminated) {
    return (
      <div className="fullscreen-guard termination-screen">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="guard-content neo-card"
        >
          <AlertTriangle size={48} className="text-error" />
          <h1 className="text-error">Exam Terminated</h1>
          <p>Your session has been terminated due to multiple rule violations (3/3 warnings). This incident has been reported to your instructor.</p>
          <button onClick={() => navigate('/student/dashboard')} className="neo-btn-primary">Return to Dashboard</button>
        </motion.div>
        <style>{`
          .termination-screen { background: rgba(20, 10, 10, 1); }
          .text-error { color: #ef4444; }
        `}</style>
      </div>
    )
  }

  // Loading and error states for exam data
  if (examLoading) {
    return (
      <div className="fullscreen-guard">
        <div className="guard-content neo-card" style={{ width: '100%', maxWidth: '800px' }}>
          <div style={{ width: '100%', textAlign: 'left' }}>
            <Skeleton variant="text" width="40%" height={32} className="mb-4" />
            <Skeleton variant="text" width="70%" height={20} className="mb-8" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
              <Skeleton variant="rounded" height={100} />
              <Skeleton variant="rounded" height={100} />
            </div>
            <Skeleton variant="rectangular" height={200} className="mb-8" />
            <Skeleton variant="rounded" width={200} height={48} style={{ margin: '0 auto' }} />
          </div>
        </div>
        <style>{`
          .fullscreen-guard { height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at center, #1a1a1a 0%, #000 100%); }
          .guard-content { max-width: 520px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; padding: 4rem; border: 1px solid rgba(255,255,255,0.05); background: rgba(20, 20, 22, 0.9); border-radius: var(--radius-md); }
        `}</style>
      </div>
    );
  }

  if (examError) {
    return (
      <div className="fullscreen-guard">
        <div className="guard-content neo-card">
          <AlertTriangle size={48} className="text-error" />
          <h1 style={{ color: '#ef4444' }}>Cannot Load Exam</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{examError}</p>
          <button onClick={() => navigate('/student/exams')} className="neo-btn-primary">Back to Exams</button>
        </div>
        <style>{`
          .fullscreen-guard { height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at center, #1a1a1a 0%, #000 100%); }
          .guard-content { max-width: 520px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; padding: 4rem; border: 1px solid rgba(255,255,255,0.05); background: rgba(20, 20, 22, 0.9); border-radius: var(--radius-md); }
          .text-error { color: #ef4444; }
        `}</style>
      </div>
    );
  }

  if (!isFullscreen) {
    return (
      <div className="fullscreen-guard">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="guard-content neo-card"
        >
          {warningCount > 0 ? (
            <>
              <AlertTriangle size={64} className="text-warning pulse-warning" />
              <h1 className="text-warning">Rule Violation Detected</h1>
              <div className="warning-status">
                <span className="warning-pill">Warning {warningCount} of 3</span>
              </div>
              <p>You have exited the secure examination environment. Continuing to do so will result in automatic termination of your session.</p>
              <div className="warning-steps">
                <div className={`step ${warningCount >= 1 ? 'active' : ''}`}><span>1</span></div>
                <div className={`step ${warningCount >= 2 ? 'active' : ''}`}><span>2</span></div>
                <div className={`step ${warningCount >= 3 ? 'active' : ''}`}><span>3</span></div>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle size={48} className="text-accent" />
              <h1>Secure Session Required</h1>
              <p>This assessment requires an immersive environment. Please enable fullscreen to commence. Our AI proctoring system will monitor your session.</p>
            </>
          )}
          <button
            onClick={enterFullscreen}
            className="neo-btn-primary"
          >
            {warningCount > 0 ? "Resume Secure Session" : "Initialize Secure Mode"}
          </button>
        </motion.div>

        <AnimatePresence>
          {permissionError && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="permission-error-modal"
            >
              <div className="modal-content">
                <AlertTriangle size={48} color="var(--error)" />
                <h2>Access Required</h2>
                <p>{permissionError}</p>
                <div className="modal-actions">
                  <button onClick={() => setPermissionError(null)} className="neo-btn-secondary">Dismiss</button>
                  <button onClick={enterFullscreen} className="neo-btn-primary">Try Again</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <style>{`
          .permission-error-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.85);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 2rem;
          }

          .modal-content {
            background: var(--surface-low);
            border: 1px solid var(--border);
            padding: 3rem;
            border-radius: var(--radius-md);
            max-width: 500px;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1.5rem;
            box-shadow: 0 24px 48px rgba(0,0,0,0.4);
          }

          .modal-content h2 {
            font-size: 2rem;
            color: var(--text-primary);
          }

          .modal-content p {
            color: var(--text-secondary);
            line-height: 1.6;
          }

          .modal-actions {
            display: flex;
            gap: 1rem;
            width: 100%;
            margin-top: 1rem;
          }

          .modal-actions button {
            flex: 1;
          }

          .fullscreen-guard {
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: radial-gradient(circle at center, #1a1a1a 0%, #000 100%);
            position: relative;
          }
          .guard-content {
            max-width: 520px;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1.5rem;
            padding: 4rem;
            z-index: 1;
            border: 1px solid rgba(255,255,255,0.05);
            background: rgba(20, 20, 22, 0.9);
          }
          .text-warning { color: #f97316; }
          .pulse-warning { animation: warning-pulse 1.5s infinite; }
          @keyframes warning-pulse {
            0% { transform: scale(1); filter: drop-shadow(0 0 0px #f97316); }
            50% { transform: scale(1.05); filter: drop-shadow(0 0 15px #f97316); }
            100% { transform: scale(1); filter: drop-shadow(0 0 0px #f97316); }
          }
          .warning-status { margin: 1rem 0; }
          .warning-pill {
            background: rgba(249, 115, 22, 0.1);
            color: #f97316;
            padding: 0.5rem 1.5rem;
            border-radius: 20px;
            font-weight: 700;
            font-size: 0.875rem;
            border: 1px solid rgba(249, 115, 22, 0.2);
          }
          .warning-steps {
            display: flex;
            gap: 1rem;
            margin: 1rem 0;
          }
          .warning-steps .step {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 2px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            color: var(--text-muted);
            transition: all 0.3s ease;
          }
          .warning-steps .step.active {
            border-color: #f97316;
            color: #f97316;
            background: rgba(249, 115, 22, 0.1);
            box-shadow: 0 0 10px rgba(249, 115, 22, 0.2);
          }
          .guard-content h1 {
            font-family: var(--font-display);
            font-size: 2.25rem;
            color: var(--text-primary);
            margin-bottom: 0.5rem;
          }
          .guard-content p {
            color: var(--text-secondary);
            line-height: 1.6;
          }
          
          /* Submit Modal Styles */
          .submit-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 2rem;
          }

          .submit-modal-content {
            background: linear-gradient(135deg, rgba(28, 28, 31, 0.98) 0%, rgba(20, 20, 22, 0.98) 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            max-width: 520px;
            width: 100%;
            overflow: hidden;
            box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
          }

          .submit-modal-header {
            padding: 2rem 2rem 1.5rem;
            text-align: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          }

          .submit-icon-wrapper {
            width: 64px;
            height: 64px;
            margin: 0 auto 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, rgba(249, 115, 22, 0.15) 0%, rgba(234, 88, 12, 0.15) 100%);
            border: 2px solid rgba(249, 115, 22, 0.3);
            border-radius: 50%;
            color: #f97316;
            animation: pulse-icon 2s infinite;
          }

          @keyframes pulse-icon {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4); }
            50% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(249, 115, 22, 0); }
          }

          .submit-modal-header h2 {
            font-family: var(--font-display);
            font-size: 1.75rem;
            color: var(--text-primary);
            margin: 0;
            font-weight: 700;
          }

          .submit-modal-body {
            padding: 2rem;
          }

          .submit-warning-text {
            font-size: 1.125rem;
            color: var(--text-primary);
            font-weight: 600;
            margin: 0 0 0.75rem 0;
            text-align: center;
          }

          .submit-info-text {
            font-size: 0.9375rem;
            color: var(--text-secondary);
            margin: 0 0 2rem 0;
            text-align: center;
            line-height: 1.6;
          }

          .submit-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-bottom: 1rem;
          }

          .stat-item {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 1rem;
            text-align: center;
          }

          .stat-label {
            display: block;
            font-size: 0.75rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
            font-weight: 600;
          }

          .stat-value {
            display: block;
            font-size: 1.5rem;
            color: var(--text-primary);
            font-weight: 700;
            font-family: monospace;
          }

          .submit-modal-actions {
            padding: 1.5rem 2rem 2rem;
            display: flex;
            gap: 1rem;
          }

          .modal-btn {
            flex: 1;
            padding: 0.875rem 1.5rem;
            border-radius: 8px;
            font-size: 0.9375rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            border: none;
            font-family: inherit;
          }

          .modal-btn-cancel {
            background: rgba(255, 255, 255, 0.05);
            color: var(--text-primary);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .modal-btn-cancel:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-1px);
          }

          .modal-btn-submit {
            background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
            color: white;
            border: 1px solid rgba(249, 115, 22, 0.3);
            box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
          }

          .modal-btn-submit:hover {
            background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
            box-shadow: 0 6px 16px rgba(249, 115, 22, 0.4);
            transform: translateY(-1px);
          }

          .modal-btn:active {
            transform: translateY(0);
          }
          
          /* Face Detection Lock Overlay */
          .face-lock-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.92);
            backdrop-filter: blur(12px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            padding: 2rem;
          }

          .face-lock-message {
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.1) 100%);
            border: 2px solid rgba(239, 68, 68, 0.3);
            border-radius: 16px;
            padding: 3rem;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
          }

          .face-lock-message svg {
            color: #ef4444;
            margin-bottom: 1.5rem;
            filter: drop-shadow(0 0 12px rgba(239, 68, 68, 0.4));
          }

          .face-lock-message h3 {
            font-family: var(--font-display);
            font-size: 1.75rem;
            color: var(--text-primary);
            margin: 0 0 1rem 0;
            font-weight: 700;
          }

          .face-lock-message p {
            color: var(--text-secondary);
            font-size: 1rem;
            line-height: 1.6;
            margin: 0 0 2rem 0;
          }

          .face-lock-status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            padding: 1rem;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 8px;
            font-size: 0.875rem;
            color: var(--text-muted);
          }

          .status-indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #ef4444;
          }

          .status-indicator.pulsing {
            animation: status-pulse 1.5s infinite;
          }

          @keyframes status-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
          }

          button:disabled {
            opacity: 0.4;
            cursor: not-allowed !important;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="exam-take-layout">

      <header className="exam-header">
        <div className="exam-info">
          <span className="exam-id">{exam?.subject || 'Exam'}</span>
          <h2 className="exam-title">{exam?.title || 'Assessment'}</h2>
        </div>

        <div className="header-controls" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <button 
            className={`rough-pad-toggle ${showRoughPad ? 'active' : ''}`}
            onClick={() => setShowRoughPad(!showRoughPad)}
            title="Open Scratchpad"
          >
            <Edit3 size={20} />
            <span>Digital Pad</span>
          </button>

          <div className={`exam-timer ${timeLeft < 300 ? 'warning' : ''}`}>
            <Clock size={20} />
            <span>{formatTime(timeLeft)}</span>
          </div>
        </div>

        <button className="neo-btn-primary finish-btn" onClick={handleSubmit}>
          Finalize Submission
        </button>
      </header>

      <RoughWorkPad 
        isOpen={showRoughPad} 
        onClose={() => setShowRoughPad(false)} 
        onUpdate={handleRoughWorkUpdate} 
      />

      <div className="exam-workspace">
        {/* Face Detection Lock Overlay */}
        <AnimatePresence>
          {faceCount !== 1 && detectionStabilized && isFullscreen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="face-lock-overlay"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="face-lock-message"
              >
                <AlertTriangle size={48} />
                <h3>{faceCount === 0 ? 'Face Not Detected' : 'Multiple Faces Detected'}</h3>
                <p>
                  {faceCount === 0
                    ? 'Please position yourself in front of the camera to continue the exam.'
                    : 'Only one person is allowed. Please ensure you are alone to continue.'}
                </p>
                <div className="face-lock-status">
                  <div className="status-indicator pulsing"></div>
                  <span>Exam paused - Waiting for valid face detection</span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="question-area">
          <div className="question-card neo-card">
            <header className="q-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span className="q-number">Inquiry {currentQuestion + 1} of {questions.length}</span>
                {questions[currentQuestion] && (
                  <button
                    className={`mark-review-btn ${markedForReview.has(questions[currentQuestion].id) ? 'active' : ''}`}
                    onClick={toggleMarkForReview}
                    disabled={faceCount !== 1 && detectionStabilized}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: markedForReview.has(questions[currentQuestion].id) ? '#f59e0b' : 'var(--text-muted)' }}
                  >
                    <Flag size={14} fill={markedForReview.has(questions[currentQuestion].id) ? '#f59e0b' : 'none'} />
                    {markedForReview.has(questions[currentQuestion].id) ? 'Marked' : 'Mark for Review'}
                  </button>
                )}
              </div>
              <span className="q-points">{questions[currentQuestion]?.marks || 5} Points</span>
            </header>

            {questions.length > 0 && questions[currentQuestion] ? (
              <div className="q-content">
                <p>{questions[currentQuestion].question}</p>

                <div className="options-grid">
                  {(questions[currentQuestion].options || []).map((opt: string, i: number) => (
                    <button
                      key={i}
                      className={`option-btn ${answers[questions[currentQuestion].id] === i ? 'selected' : ''}`}
                      disabled={faceCount !== 1 && detectionStabilized}
                      onClick={() => selectAnswer(questions[currentQuestion].id, i)}
                      style={{ opacity: faceCount !== 1 && detectionStabilized ? 0.5 : 1, cursor: faceCount !== 1 && detectionStabilized ? 'not-allowed' : 'pointer' }}
                    >
                      <span className="opt-idx">{String.fromCharCode(65 + i)}</span>
                      <span className="opt-text">{opt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="q-content">
                <p style={{ color: 'var(--text-muted)' }}>No questions available for this exam.</p>
              </div>
            )}

            <footer className="question-nav">
              <button
                className="text-btn"
                onClick={() => setCurrentQuestion(q => Math.max(0, q - 1))}
                disabled={(faceCount !== 1 && detectionStabilized) || currentQuestion === 0}
              >
                <ChevronLeft /> Previous
              </button>
              <button
                className="text-btn"
                onClick={() => setCurrentQuestion(q => Math.min(questions.length - 1, q + 1))}
                disabled={(faceCount !== 1 && detectionStabilized) || currentQuestion >= questions.length - 1}
              >
                Next <ChevronRight />
              </button>
            </footer>
          </div>
        </main>

        <aside className={`exam-sidebar ${showSidebar ? '' : 'collapsed'}`}>
          <div className="proctoring-box neo-card">
            <div className="camera-view">
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="proctor-status">
                <div className="status-dot pulse"></div>
                <span>AI Proctoring Active</span>
              </div>
            </div>
            <div className="proctor-metrics">
              <div className="metric">
                <span>Faces Detected</span>
                <strong className={faceCount !== 1 ? 'text-error' : 'text-success'}>
                  {modelsLoaded ? faceCount : '...'}
                </strong>
              </div>
              <div className="metric">
                <span>Face Warnings</span>
                <strong className={multipleFaceWarnings > 0 ? 'text-warning' : ''}>
                  {multipleFaceWarnings}/3
                </strong>
              </div>
            </div>
            {faceCount !== 1 && modelsLoaded && (
              <div className="face-warning-alert">
                <AlertTriangle size={16} />
                <span>{faceCount === 0 ? 'No face detected!' : 'Multiple faces detected!'}</span>
              </div>
            )}
          </div>

          <div className="question-palette neo-card">
            <h3>Navigation Palette</h3>
            <div className="palette-grid">
              {questions.map((q, i) => {
                const isAnswered = answers[q.id] !== undefined;
                const isFlagged = markedForReview.has(q.id);
                const isActive = i === currentQuestion;
                return (
                  <button
                    key={q.id || i}
                    className={`palette-idx ${isActive ? 'active' : ''} ${isAnswered ? 'answered' : ''} ${isFlagged ? 'flagged' : ''}`}
                    onClick={() => setCurrentQuestion(i)}
                    disabled={faceCount !== 1 && detectionStabilized}
                  >
                    {i + 1}
                    {isFlagged && <div className="indicator-dot flagged" />}
                    {isAnswered && !isFlagged && <div className="indicator-dot answered" />}
                  </button>
                );
              })}
            </div>
            <div className="palette-legend" style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--accent)' }}></span> Answered</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--surface-high)', border: '1px solid var(--border)' }}></span> Unanswered</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--surface-high)', border: '1px solid #f59e0b' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', margin: '2px' }}></div></span> Flagged</div>
            </div>
          </div>
        </aside>

        <button
          className="sidebar-toggle"
          onClick={() => setShowSidebar(!showSidebar)}
          style={{ right: showSidebar ? '360px' : '1rem' }}
        >
          <SidebarIcon size={20} />
        </button>
      </div>

      {/* Submit Confirmation Modal - rendered in fullscreen context */}
      <AnimatePresence>
        {showSubmitModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="submit-modal-overlay"
            onClick={() => setShowSubmitModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="submit-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="submit-modal-header">
                <div className="submit-icon-wrapper">
                  <AlertTriangle size={32} />
                </div>
                <h2>Finalize Submission</h2>
              </div>

              <div className="submit-modal-body">
                <p className="submit-warning-text">
                  Are you sure you want to submit your assessment?
                </p>
                <p className="submit-info-text">
                  Once submitted, you will not be able to make any changes to your answers.
                </p>

                <div className="submit-stats">
                  <div className="stat-item">
                    <span className="stat-label">Time Remaining</span>
                    <span className="stat-value">{formatTime(timeLeft)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Questions Answered</span>
                    <span className="stat-value">{answeredCount}/{questions.length}</span>
                  </div>
                </div>
              </div>

              <div className="submit-modal-actions">
                <button
                  onClick={() => setShowSubmitModal(false)}
                  className="modal-btn modal-btn-cancel"
                >
                  Continue Exam
                </button>
                <button
                  onClick={confirmSubmit}
                  className="modal-btn modal-btn-submit"
                >
                  Submit Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .exam-take-layout {
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--bg);
          position: relative;
          overflow: hidden;
        }
        .exam-header {
          height: 80px;
          padding: 0 2.5rem;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(20, 20, 22, 0.8);
          backdrop-filter: blur(10px);
          z-index: 10;
        }
        .exam-timer {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-family: monospace;
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
          padding: 0.5rem 1.5rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
        }
        .exam-timer.warning {
          color: var(--error);
          border-color: var(--error);
          animation: timer-pulse 2s infinite;
        }
        .exam-workspace {
          flex: 1;
          display: flex;
          position: relative;
          overflow: hidden;
          z-index: 1;
        }
        .question-area {
          flex: 1;
          padding: 3rem;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          overflow-y: auto;
          background: transparent;
        }
        .question-card {
          width: 100%;
          max-width: 800px;
          padding: 3rem;
          background: rgba(28, 28, 31, 0.6);
          backdrop-filter: blur(10px);
        }
        .q-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 2rem;
          font-size: 0.875rem;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .q-content p {
          font-size: 1.25rem;
          line-height: 1.6;
          margin-bottom: 3rem;
          color: var(--text-primary);
        }
        .options-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }
        .option-btn {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          padding: 1.25rem 2rem;
          background: var(--surface-low);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          transition: var(--transition-fast);
          text-align: left;
          color: var(--text-primary);
          font-family: inherit;
          cursor: pointer;
        }
        .option-btn:hover {
          border-color: var(--accent);
          background: var(--surface);
        }
        .option-btn.selected {
          border-color: var(--accent);
          background: rgba(99, 102, 241, 0.15);
          box-shadow: 0 0 0 1px var(--accent);
        }
        .option-btn.selected .opt-idx {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .opt-idx {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border);
          border-radius: 50%;
          font-weight: 700;
          font-size: 0.875rem;
        }
        .question-nav {
          margin-top: 4rem;
          padding-top: 2rem;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
        }
        .exam-sidebar {
          width: 360px;
          padding: 1.5rem;
          border-left: 1px solid var(--border);
          background: rgba(20, 20, 22, 0.4);
          backdrop-filter: blur(20px);
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          transition: transform 0.3s ease;
        }
        .exam-sidebar.collapsed {
          position: absolute;
          right: 0;
          transform: translateX(100%);
        }
        .camera-view {
          position: relative;
          border-radius: var(--radius-sm);
          overflow: hidden;
          aspect-ratio: 4 / 3;
          background: #000;
          margin-bottom: 1rem;
        }
        .camera-view video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .rough-pad-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.6rem 1rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: var(--text-secondary);
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s;
        }
        .rough-pad-toggle:hover {
          background: rgba(139, 92, 246, 0.15);
          border-color: rgba(139, 92, 246, 0.4);
          color: #a78bfa;
        }
        .rough-pad-toggle.active {
          background: rgba(139, 92, 246, 0.2);
          border-color: #8b5cf6;
          color: white;
          box-shadow: 0 0 15px rgba(139, 92, 246, 0.3);
        }

        .proctor-status {
          position: absolute;
          bottom: 1rem;
          left: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.8rem;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 20px;
          font-size: 0.75rem;
          color: #fff;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--success);
        }
        .status-dot.pulse {
          animation: dot-pulse 2s infinite;
        }
        .proctor-metrics {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .metric {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
        }
        .metric span {
          color: var(--text-muted);
        }
        .palette-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .palette-idx {
          position: relative;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 0.875rem;
          font-weight: 600;
          background: var(--surface);
          color: var(--text-primary);
          cursor: pointer;
          transition: var(--transition-fast);
        }
        .palette-idx.active {
          border-color: var(--accent);
          color: var(--accent);
          background: var(--surface-high);
          box-shadow: 0 0 0 1px var(--accent);
        }
        .palette-idx.answered {
          background: var(--accent);
          color: var(--bg);
          border-color: var(--accent);
        }
        .palette-idx.flagged {
          border-color: #f59e0b;
        }
        .indicator-dot {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .indicator-dot.flagged { background: #f59e0b; }
        .indicator-dot.answered { background: var(--bg); }
        .sidebar-toggle {
          position: absolute;
          top: 1rem;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--surface-low);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          transition: right 0.3s ease;
          color: var(--text-primary);
          cursor: pointer;
          z-index: 20;
        }
        @keyframes timer-pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        @keyframes dot-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
        .text-success { color: var(--success); }
        .text-error { color: var(--error); }
        .text-warning { color: #f97316; }
        .face-warning-alert {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
          background: rgba(249, 115, 22, 0.1);
          border: 1px solid rgba(249, 115, 22, 0.3);
          border-radius: var(--radius-sm);
          color: #f97316;
          font-size: 0.75rem;
          margin-top: 0.5rem;
          animation: warning-pulse 1.5s infinite;
        }
        @keyframes warning-pulse {
          0% { background: rgba(249, 115, 22, 0.1); border-color: rgba(249, 115, 22, 0.3); }
          50% { background: rgba(249, 115, 22, 0.2); border-color: rgba(249, 115, 22, 0.6); }
          100% { background: rgba(249, 115, 22, 0.1); border-color: rgba(249, 115, 22, 0.3); }
        }
        
        /* Enhanced Navigation Buttons */
        .text-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 0.9375rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }
        
        .text-btn::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        
        .text-btn:hover:not(:disabled)::before {
          opacity: 1;
        }
        
        .text-btn:hover:not(:disabled) {
          border-color: rgba(99, 102, 241, 0.6);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2), 0 0 0 1px rgba(99, 102, 241, 0.1);
          transform: translateY(-2px);
        }
        
        .text-btn:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 2px 6px rgba(99, 102, 241, 0.15);
        }
        
        .text-btn svg {
          position: relative;
          z-index: 1;
          transition: transform 0.3s ease;
        }
        
        .text-btn:hover:not(:disabled) svg {
          transform: translateX(0);
        }
        
        .text-btn:hover:not(:disabled) svg:first-child {
          transform: translateX(-3px);
        }
        
        .text-btn:hover:not(:disabled) svg:last-child {
          transform: translateX(3px);
        }
        
        .text-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.05);
        }
        
        .text-btn span {
          position: relative;
          z-index: 1;
        }

        /* Submit Modal Styles */
        .submit-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 2rem;
        }

        .submit-modal-content {
          background: linear-gradient(135deg, rgba(28, 28, 31, 0.98) 0%, rgba(20, 20, 22, 0.98) 100%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          max-width: 520px;
          width: 100%;
          overflow: hidden;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
        }

        .submit-modal-header {
          padding: 2rem 2rem 1.5rem;
          text-align: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .submit-icon-wrapper {
          width: 64px;
          height: 64px;
          margin: 0 auto 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(249, 115, 22, 0.15) 0%, rgba(234, 88, 12, 0.15) 100%);
          border: 2px solid rgba(249, 115, 22, 0.3);
          border-radius: 50%;
          color: #f97316;
          animation: pulse-icon 2s infinite;
        }

        @keyframes pulse-icon {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4); }
          50% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(249, 115, 22, 0); }
        }

        .submit-modal-header h2 {
          font-family: var(--font-display);
          font-size: 1.75rem;
          color: var(--text-primary);
          margin: 0;
          font-weight: 700;
        }

        .submit-modal-body {
          padding: 2rem;
        }

        .submit-warning-text {
          font-size: 1.125rem;
          color: var(--text-primary);
          font-weight: 600;
          margin: 0 0 0.75rem 0;
          text-align: center;
        }

        .submit-info-text {
          font-size: 0.9375rem;
          color: var(--text-secondary);
          margin: 0 0 2rem 0;
          text-align: center;
          line-height: 1.6;
        }

        .submit-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .submit-modal-actions {
          padding: 1.5rem 2rem 2rem;
          display: flex;
          gap: 1rem;
        }

        .modal-btn {
          flex: 1;
          padding: 0.875rem 1.5rem;
          border-radius: 8px;
          font-size: 0.9375rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          border: none;
          font-family: inherit;
        }

        .modal-btn-cancel {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .modal-btn-cancel:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-1px);
        }

        .modal-btn-submit {
          background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
          color: white;
          border: 1px solid rgba(249, 115, 22, 0.3);
          box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
        }

        .modal-btn-submit:hover {
          background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
          box-shadow: 0 6px 16px rgba(249, 115, 22, 0.4);
          transform: translateY(-1px);
        }

        .modal-btn:active {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
};

export default TakeExam;
