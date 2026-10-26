import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, ArrowRight, ArrowLeft, CheckCircle, Flag, Code2, Trophy, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import Skeleton from '../../components/Skeleton';
import ConfirmModal from '../../components/ConfirmModal';
import './TakeInterview.css';

interface Question {
    id: number;
    question: string;
    options: string[];
}

interface Interview {
    id: number;
    job_role_target: string;
    total_score: number;
    ai_feedback: string | null;
}

interface MapSection {
    label: string;
    color: string;
    start: number;
    end: number;
}

const buildQuestionMapSections = (total: number): MapSection[] => {
    const templates = [
        { key: 'dsa', label: 'DSA', color: '#6366f1' },
        { key: 'logical', label: 'Logical', color: '#06b6d4' },
        { key: 'verbal', label: 'Verbal', color: '#8b5cf6' },
        { key: 'technical', label: 'Technical', color: '#D4AF37' },
    ];

    const remainderPriority = ['technical', 'dsa', 'logical', 'verbal'];
    const baseCount = Math.floor(total / templates.length);
    const remainder = total % templates.length;
    const remainderSet = new Set(remainderPriority.slice(0, remainder));

    let cursor = 0;
    return templates.map((template) => {
        const count = baseCount + (remainderSet.has(template.key) ? 1 : 0);
        const start = cursor;
        const end = cursor + count;
        cursor = end;
        return {
            label: template.label,
            color: template.color,
            start,
            end,
        };
    });
};

const TakeInterview = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const interviewShellRef = useRef<HTMLDivElement>(null);
    const warningCountRef = useRef(0);
    const lastViolationTimeRef = useRef(0);
    const hasStartedRef = useRef(false);
    const isTerminatedRef = useRef(false);
    
    const [interview, setInterview] = useState<Interview | null>(null);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [loading, setLoading] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
    const [warningCount, setWarningCount] = useState(0);
    const [isTerminated, setIsTerminated] = useState(false);
    
    const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [markedForReview, setMarkedForReview] = useState<Set<number>>(new Set());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    // Transition state after MCQ submission
    const [transitionData, setTransitionData] = useState<{ score: number; codingId: number | null } | null>(null);

    useEffect(() => {
        fetchInterviewData();
    }, [id]);

    useEffect(() => {
        document.body.classList.add('interview-solid-bg');
        return () => {
            document.body.classList.remove('interview-solid-bg');
        };
    }, []);

    useEffect(() => {
        if (questions.length > 0) {
            hasStartedRef.current = true;
        }
    }, [questions.length]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const currentFull = !!document.fullscreenElement;
            setIsFullscreen(currentFull);

            if (hasStartedRef.current && !isTerminatedRef.current) {
                if (currentFull === false) {
                    handleViolation('Fullscreen Exited');
                } else {
                    setTimeout(() => {
                        if (window.innerWidth < window.screen.width * 0.95) {
                            handleViolation('Browser Sidebar/Split Screen Detected');
                        }
                    }, 500);
                }
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && hasStartedRef.current && !isTerminatedRef.current) {
                handleViolation('Tab Switched/Minimized');
            }
        };

        const handleBlur = () => {
            if (hasStartedRef.current && !isTerminatedRef.current) {
                handleViolation('Window Focus Lost');
            }
        };

        const handleResize = () => {
            if (document.fullscreenElement && hasStartedRef.current && !isTerminatedRef.current) {
                // If viewport is significantly smaller than screen width, a side panel might be open
                if (window.innerWidth < window.screen.width * 0.95) {
                    handleViolation('Browser Sidebar/Split Screen Detected');
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
    }, []);

    useEffect(() => {
        if (warningCount >= 3 && !isTerminated) {
            terminateInterview('Proctoring violations (3/3 warnings)');
        }
    }, [warningCount, isTerminated]);

    const enterFullscreen = async () => {
        try {
            const element = document.documentElement;
            if (element.requestFullscreen) {
                await element.requestFullscreen();
            }
        } catch (error) {
            console.error('Failed to enter fullscreen', error);
        }
    };

    const handleViolation = (_type: string) => {
        if (isTerminatedRef.current) return;
        const now = Date.now();
        if (now - lastViolationTimeRef.current < 2500) return;

        lastViolationTimeRef.current = now;
        const nextCount = warningCountRef.current + 1;
        warningCountRef.current = nextCount;
        setWarningCount(nextCount);
    };

    const terminateInterview = async (reason: string) => {
        if (isTerminated) return;
        isTerminatedRef.current = true;
        setIsTerminated(true);

        if (document.fullscreenElement) {
            await document.exitFullscreen().catch(() => { });
        }

        try {
            const response = await apiFetch(`/api/interview/${id}/submit`, {
                method: 'POST',
                body: JSON.stringify({ answers })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Submission failed.');

            setTransitionData({ score: data.score, codingId: data.codingId || null });
        } catch (error: any) {
            alert(error.message || reason);
            navigate('/student/dashboard');
        }
    };

    const fetchInterviewData = async () => {
        try {
            const response = await apiFetch(`/api/interview/${id}`);
            const data = await response.json();
            
            if (!response.ok) throw new Error(data.message || 'Failed to load interview');
            
            setInterview(data.interview);
            setQuestions(data.questions || []);
            
            // If it's already graded, redirect to results
            if (data.interview.ai_feedback !== null) {
                navigate(`/student/interview/result/${id}`, { replace: true });
            }
        } catch (error) {
            console.error("Failed to load interview", error);
            alert("Could not load interview details.");
            navigate('/student/dashboard');
        } finally {
            setLoading(false);
        }
    };

    const handleSelectOption = (option: string) => {
        const qId = questions[currentQuestionIdx].id;
        setAnswers(prev => ({ ...prev, [qId]: option }));
    };

    const toggleMarkForReview = () => {
        const qId = questions[currentQuestionIdx].id;
        setMarkedForReview(prev => {
            const next = new Set(prev);
            if (next.has(qId)) next.delete(qId); else next.add(qId);
            return next;
        });
    };

    const handleNext = () => {
        if (currentQuestionIdx < questions.length - 1) {
            setCurrentQuestionIdx(prev => prev + 1);
        }
    };

    const handlePrev = () => {
        if (currentQuestionIdx > 0) {
            setCurrentQuestionIdx(prev => prev - 1);
        }
    };

    const handleSubmit = async () => {
        if (isTerminated) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`/api/interview/${id}/submit`, {
                method: 'POST',
                body: JSON.stringify({ answers })
            });
            
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Submission failed.');

            // Show transition overlay instead of immediately navigating
            setTransitionData({ score: data.score, codingId: data.codingId || null });
        } catch (error: any) {
            alert(error.message || 'Submission failed.');
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="take-interview-container">
                <header className="interview-header">
                    <div style={{ flex: 1 }}>
                        <Skeleton variant="text" width="60%" height={40} className="mb-2" />
                        <Skeleton variant="text" width="90%" height={20} />
                    </div>
                </header>
                <div className="interview-layout">
                    <main className="question-area">
                        <div className="question-card">
                            <Skeleton variant="text" width="30%" height={24} className="mb-4" />
                            <Skeleton variant="text" width="80%" height={32} className="mb-8" />
                            <div className="options-list">
                                {[1, 2, 3, 4].map(i => (
                                    <Skeleton key={i} variant="rounded" height={60} className="mb-4" />
                                ))}
                            </div>
                        </div>
                    </main>
                    <aside className="question-nav-sidebar">
                        <Skeleton variant="text" width="50%" height={24} className="mb-4" />
                        <div className="question-grid">
                            {Array.from({ length: 20 }).map((_, i) => (
                                <Skeleton key={i} variant="circular" width={32} height={32} />
                            ))}
                        </div>
                    </aside>
                </div>
            </div>
        );
    }

    // ─── Transition Overlay after MCQ Submission ───────────────────────────────
    if (transitionData) {
        const tier = transitionData.score >= 70 ? 'pass' : 'needs-work';
        return (
            <motion.div
                className="interview-transition-overlay"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
            >
                <div className="transition-card">
                    <div className={`transition-score-ring ${tier}`}>
                        <Trophy size={28} />
                        <span>{transitionData.score}%</span>
                    </div>
                    <h2>Part 1 Complete!</h2>
                    <p className="transition-desc">
                        You scored <strong>{transitionData.score}%</strong> on the Theory (MCQ) Round.
                        {transitionData.codingId 
                            ? " Now it's time to put your coding skills to the test!" 
                            : " View your detailed results below."}
                    </p>

                    {transitionData.codingId && (
                        <div className="transition-next-info">
                            <Code2 size={18} />
                            <span>Part 2: DSA Coding Round — 2 Algorithmic Problems</span>
                        </div>
                    )}

                    <div className="transition-actions">
                        <button
                            className="neo-btn-secondary"
                            onClick={() => navigate(`/student/interview/result/${id}`)}
                        >
                            Skip to MCQ Results
                        </button>
                        {transitionData.codingId && (
                            <button
                                className="neo-btn-primary transition-cta"
                                onClick={() => navigate(`/student/coding/${transitionData.codingId}`)}
                            >
                                <Code2 size={18} /> Start Coding Round <ArrowRight size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>
        );
    }

    if (!interview || questions.length === 0) {
        return <div className="interview-error">Interview not found or has no questions.</div>;
    }

    const currentQ = questions[currentQuestionIdx];
    const isLastQuestion = currentQuestionIdx === questions.length - 1;
    const answeredCount = Object.keys(answers).length;
    const progressPercent = (answeredCount / questions.length) * 100;
    const mapSections = buildQuestionMapSections(questions.length);

    if (isTerminated) {
        return (
            <div className="fullscreen-guard termination-screen">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="guard-content neo-card"
                >
                    <AlertTriangle size={48} className="text-error" />
                    <h1 className="text-error">Interview Terminated</h1>
                    <p>Your session has been terminated due to multiple rule violations (3/3 warnings). Results have been partially submitted.</p>
                    <button onClick={() => navigate('/student/dashboard')} className="neo-btn-primary">Return to Dashboard</button>
                </motion.div>
                <style>{`
                    .fullscreen-guard {
                        height: 100vh;
                        width: 100vw;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: radial-gradient(circle at center, #1a1a1a 0%, #000 100%);
                        position: fixed;
                        top: 0;
                        left: 0;
                        z-index: 9999;
                    }
                    .guard-content {
                        max-width: 520px;
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 1.5rem;
                        padding: 4rem;
                        border: 1px solid rgba(255,255,255,0.05);
                        background: rgba(20, 20, 22, 0.9);
                        border-radius: 12px;
                    }
                    .termination-screen { background: rgba(20, 10, 10, 1); }
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
                            <h1 className="text-warning" style={{ color: '#f97316' }}>Rule Violation Detected</h1>
                            <div className="warning-status">
                                <span className="warning-pill">Warning {warningCount} of 3</span>
                            </div>
                            <p>You have exited the secure interview environment. Continuing to do so will result in automatic termination.</p>
                        </>
                    ) : (
                        <>
                            <AlertTriangle size={48} className="text-accent" />
                            <h1>Secure Session Required</h1>
                            <p>This interview requires an immersive environment. Please enable fullscreen to commence. Our proctoring system will monitor your session.</p>
                        </>
                    )}
                    <button
                        onClick={enterFullscreen}
                        className="neo-btn-primary"
                    >
                        {warningCount > 0 ? "Resume Secure Session" : "Enter Fullscreen & Start"}
                    </button>
                </motion.div>
                <style>{`
                    .fullscreen-guard {
                        height: 100vh;
                        width: 100vw;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: radial-gradient(circle at center, var(--surface-low) 0%, var(--bg) 100%);
                        position: fixed;
                        top: 0;
                        left: 0;
                        z-index: 9999;
                    }
                    .guard-content {
                        max-width: 520px;
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 1.5rem;
                        padding: 3rem 2.5rem;
                        border: 1px solid var(--border);
                        background: var(--surface);
                        color: var(--text-primary);
                        border-radius: 12px;
                        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
                    }
                    .guard-content h1 {
                        color: var(--text-primary);
                        margin: 0;
                    }
                    .guard-content p {
                        color: var(--text-secondary);
                        line-height: 1.6;
                        margin: 0;
                    }
                    .warning-pill {
                        background: rgba(249, 115, 22, 0.1);
                        color: #f97316;
                        padding: 0.5rem 1.5rem;
                        border-radius: 20px;
                        font-weight: 700;
                        border: 1px solid rgba(249, 115, 22, 0.2);
                    }
                    .pulse-warning { animation: warning-pulse 1.5s infinite; }
                    @keyframes warning-pulse {
                        0% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                        100% { transform: scale(1); }
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div className={`take-interview-container ${isFullscreen ? 'fullscreen-active' : ''}`} ref={interviewShellRef}>
            {/* Header */}
            <header className="interview-header">
                <div>
                    <h1>{interview.job_role_target} Mock Interview</h1>
                    <p>Answer all questions to the best of your ability. The AI will analyze your performance.</p>
                </div>
                <div className="progress-section">
                    <div className="progress-text">
                        <span>Progress</span>
                        <span>{answeredCount} / {questions.length} Answered</span>
                    </div>
                    <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }}></div>
                    </div>
                    <div className="warning-badge" title="Three warnings will end the interview automatically">
                        Warnings: {warningCount}/3
                    </div>
                </div>
            </header>

            <div className="interview-layout">
                {/* Main Question Area */}
                <main className="question-area">
                    <motion.div 
                        key={currentQuestionIdx}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.3 }}
                        className="question-card"
                    >
                        <h2 className="question-number">Question {currentQuestionIdx + 1} of {questions.length}</h2>
                        <h3 className="question-text">{currentQ.question}</h3>
                        
                        <div className="options-list">
                            {currentQ.options.map((opt, index) => {
                                const isSelected = answers[currentQ.id] === opt;
                                return (
                                    <button 
                                        key={index}
                                        className={`option-btn ${isSelected ? 'selected' : ''}`}
                                        onClick={() => handleSelectOption(opt)}
                                    >
                                        <div className="option-indicator">{String.fromCharCode(65 + index)}</div>
                                        <div className="option-text">{opt}</div>
                                        {isSelected && <CheckCircle size={20} className="check-icon" />}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>

                    <div className="navigation-controls">
                        <button 
                            className="neo-btn-secondary" 
                            onClick={handlePrev} 
                            disabled={currentQuestionIdx === 0}
                        >
                            <ArrowLeft size={18} /> Previous
                        </button>

                        <button
                            className={`mark-review-btn ${markedForReview.has(currentQ.id) ? 'marked' : ''}`}
                            onClick={toggleMarkForReview}
                        >
                            <Flag size={16} />
                            {markedForReview.has(currentQ.id) ? 'Unmark Review' : 'Mark for Review'}
                        </button>
                        
                        {isLastQuestion ? (
                            <button 
                                className="neo-btn-primary submit-pulse" 
                                onClick={() => setShowConfirmModal(true)}
                                disabled={isSubmitting || isTerminated}
                            >
                                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : 'Submit Final Interview'}
                            </button>
                        ) : (
                            <button className="neo-btn-primary" onClick={handleNext} disabled={isTerminated}>
                                Next <ArrowRight size={18} />
                            </button>
                        )}
                    </div>
                </main>

                {/* Sidebar Navigation */}
                <aside className="question-nav-sidebar">
                    <h3>Question Map</h3>

                    {mapSections.map(section => (
                        <div key={section.label} className="map-section">
                            <div className="map-section-label" style={{ color: section.color }}>
                                {section.label}
                            </div>
                            <div className="question-grid">
                                {questions.slice(section.start, section.end).map((q, localIdx) => {
                                    const idx = section.start + localIdx;
                                    const isAnswered = !!answers[q.id];
                                    const isReview = markedForReview.has(q.id);
                                    const isActive = currentQuestionIdx === idx;
                                    let statusClass = '';
                                    if (isAnswered) statusClass = 'answered';
                                    if (isReview) statusClass = 'on-hold';
                                    if (isActive) statusClass += ' active';
                                    return (
                                        <button
                                            key={q.id}
                                            className={`nav-dot ${statusClass}`}
                                            onClick={() => setCurrentQuestionIdx(idx)}
                                            title={isAnswered ? 'Answered' : isReview ? 'Marked for Review' : 'Not Answered'}
                                        >
                                            {idx + 1}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    <div className="map-legend">
                        <div className="legend-item">
                            <span className="legend-dot answered"></span>
                            <span>Answered</span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-dot on-hold"></span>
                            <span>On Hold</span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-dot"></span>
                            <span>Unanswered</span>
                        </div>
                    </div>
                </aside>
            </div>

            <ConfirmModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onConfirm={handleSubmit}
                title="Submit Interview?"
                message="Are you sure you want to completely submit this interview? Your answers will be analyzed by AI."
                confirmText="Yes, Submit"
                type="primary"
            />
        </div>
    );
};

export default TakeInterview;
