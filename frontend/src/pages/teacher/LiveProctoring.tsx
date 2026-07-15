import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { motion } from 'framer-motion';
import {
    Users,
    ShieldAlert,
    Search,
    Monitor,
    Video,
    VideoOff,
    Edit3,
    Mic,
    X
} from 'lucide-react';
import Peer from 'simple-peer';
import DashboardLayout from '../../layouts/DashboardLayout';
import { Socket } from 'socket.io-client';

interface TimelineEntry {
    id: string;
    sessionId: number;
    eventType: 'warning' | 'action' | 'activity';
    actionType: string;
    reason: string;
    actorName?: string;
    actorRole?: string;
    occurredAt: string;
}

interface StudentSession {
    id: number;
    student_id: number;
    student_name: string;
    prn_number: string;
    warnings_count: number;
    status: string;
    is_suspended?: boolean;
    last_update?: string;
    last_action?: string;
    roughWork?: string;
}

interface SessionLogState {
    session: StudentSession;
    timeline: TimelineEntry[];
    auditTrail: TimelineEntry[];
}

const LiveProctoring = () => {
    const [exams, setExams] = useState<any[]>([]);
    const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
    const [sessions, setSessions] = useState<StudentSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [streams, setStreams] = useState<{ [key: string]: MediaStream }>({});
    const [timelineBySession, setTimelineBySession] = useState<Record<number, TimelineEntry[]>>({});
    const [selectedSessionLog, setSelectedSessionLog] = useState<SessionLogState | null>(null);
    const [logLoading, setLogLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionReasonBySession, setActionReasonBySession] = useState<Record<number, string>>({});
    const [actionInProgress, setActionInProgress] = useState<Record<number, string | null>>({});
    const peersRef = useRef<{ [key: string]: Peer.Instance }>({});
    const socketRef = useRef<Socket | null>(null);

    const handleVoiceIntervention = (session: StudentSession) => {
        const message = (actionReasonBySession[session.id] || '').trim();
        if (!message) {
            alert('Please enter a message in the Reason box to speak to the student.');
            return;
        }

        if (socketRef.current) {
            socketRef.current.emit('voice-intervention', {
                studentId: session.student_id,
                message
            });
            // Also append to timeline locally
            appendTimelineEvent(session.id, {
                id: `voice-${Date.now()}`,
                sessionId: session.id,
                eventType: 'action',
                actionType: 'voice-intervention',
                reason: `Voice Intervention: "${message}"`,
                actorName: 'Teacher',
                actorRole: 'teacher',
                occurredAt: new Date().toISOString()
            });
        }
    };

    const appendTimelineEvent = (sessionId: number, entry: TimelineEntry) => {
        setTimelineBySession((prev) => {
            const next = {
                ...prev,
                [sessionId]: [entry, ...(prev[sessionId] || [])].slice(0, 60)
            };
            return next;
        });
        setSelectedSessionLog((prev) => {
            if (!prev || prev.session.id !== sessionId) return prev;
            const nextTimeline = [entry, ...prev.timeline].slice(0, 300);
            return {
                ...prev,
                timeline: nextTimeline,
                auditTrail: entry.eventType === 'action'
                    ? [entry, ...prev.auditTrail].slice(0, 300)
                    : prev.auditTrail
            };
        });
    };

    const fetchExams = async () => {
        try {
            const response = await axios.get('/api/exams/teacher/my-exams');
            const teacherExams = Array.isArray(response.data) ? response.data : [];
            setExams(teacherExams);
            if (teacherExams.length > 0) {
                setSelectedExamId(teacherExams[0].id);
            }
        } catch (error) {
            console.error('Failed to fetch teacher exams', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchSessionsAndTimeline = async (examId: number) => {
        try {
            const [activeResponse, timelineResponse] = await Promise.all([
                axios.get(`/api/exams/teacher/active-sessions/${examId}`),
                axios.get(`/api/exams/teacher/proctoring/${examId}/timeline`)
            ]);

            const activeSessions = Array.isArray(activeResponse.data) ? activeResponse.data : [];
            const timelineSessions = Array.isArray(timelineResponse.data?.sessions) ? timelineResponse.data.sessions : [];

            const timelineMap: Record<number, TimelineEntry[]> = {};
            timelineSessions.forEach((session: any) => {
                timelineMap[session.id] = Array.isArray(session.timeline) ? session.timeline : [];
            });

            setTimelineBySession(timelineMap);
            setSessions(activeSessions.map((session: any) => {
                const timelineSource = timelineSessions.find((entry: any) => entry.id === session.id);
                return {
                    ...session,
                    is_suspended: !!timelineSource?.is_suspended,
                    last_action: timelineSource?.timeline?.[0]?.actionType || session.last_action,
                    last_update: timelineSource?.timeline?.[0]?.occurredAt || session.last_update
                };
            }));
        } catch (error) {
            console.error('Failed to fetch active sessions/timeline', error);
        }
    };

    const openSessionLog = async (session: StudentSession) => {
        try {
            setLogLoading(true);
            const response = await axios.get(`/api/exams/teacher/proctoring/session/${session.id}/log`);
            const payload = response.data || {};
            setSelectedSessionLog({
                session,
                timeline: Array.isArray(payload.timeline) ? payload.timeline : [],
                auditTrail: Array.isArray(payload.auditTrail) ? payload.auditTrail : []
            });
        } catch (error) {
            console.error('Failed to fetch session audit trail', error);
        } finally {
            setLogLoading(false);
        }
    };

    const runAction = async (session: StudentSession, actionType: 'warn' | 'suspend' | 'terminate') => {
        if (!selectedExamId) return;
        try {
            setActionInProgress((prev) => ({ ...prev, [session.id]: actionType }));
            await axios.post(`/api/exams/teacher/proctoring/session/${session.id}/action`, {
                actionType,
                reason: (actionReasonBySession[session.id] || '').trim()
            });
            await fetchSessionsAndTimeline(selectedExamId);
            if (selectedSessionLog && selectedSessionLog.session.id === session.id) {
                await openSessionLog(session);
            }
        } catch (error) {
            console.error(`Failed to execute ${actionType} action`, error);
        } finally {
            setActionInProgress((prev) => ({ ...prev, [session.id]: null }));
        }
    };

    useEffect(() => {
        fetchExams();
    }, []);

    useEffect(() => {
        if (!selectedExamId) return;

        fetchSessionsAndTimeline(selectedExamId);
        const timelineRefreshInterval = window.setInterval(() => {
            fetchSessionsAndTimeline(selectedExamId);
        }, 15000);

        const token = localStorage.getItem('token') || localStorage.getItem('teacher_token') || '';
        const socket = io({
            auth: { token }
        });
        socketRef.current = socket;

        const user = JSON.parse(localStorage.getItem('user') || '{}');
        socket.emit('join-room', {
            examId: selectedExamId,
            userId: user.id || 0,
            role: 'teacher',
            name: user.username || user.name || 'Teacher'
        });

        socket.on('student-connected', (data: { socketId: string; userId: number; sessionId?: number }) => {
            fetchSessionsAndTimeline(selectedExamId);
            const peer = new Peer({
                initiator: true,
                trickle: false
            });

            peer.on('signal', (signal) => {
                socket.emit('signal', { to: data.socketId, from: socket.id, signal });
            });

            peer.on('stream', (stream: MediaStream) => {
                setStreams((prev) => ({ ...prev, [String(data.userId)]: stream }));
            });

            peersRef.current[data.socketId] = peer;
        });

        socket.on('signal', (data: { from: string; signal: any; userId?: number }) => {
            const existingPeer = peersRef.current[data.from];
            if (existingPeer) {
                existingPeer.signal(data.signal);
                return;
            }

            const peer = new Peer({
                initiator: false,
                trickle: false
            });

            peer.on('signal', (signal) => {
                socket.emit('signal', { to: data.from, from: socket.id, signal });
            });
            peer.on('stream', (stream: MediaStream) => {
                if (data.userId) {
                    setStreams((prev) => ({ ...prev, [String(data.userId)]: stream }));
                }
            });

            peer.signal(data.signal);
            peersRef.current[data.from] = peer;
        });

        socket.on('student-warning-alert', (data: { sessionId: number; warningType: string; message?: string }) => {
            setSessions((prev) => prev.map((session) =>
                session.id === data.sessionId
                    ? { ...session, warnings_count: session.warnings_count + 1, last_action: data.warningType, last_update: new Date().toISOString() }
                    : session
            ));
            appendTimelineEvent(data.sessionId, {
                id: `socket-warning-${Date.now()}`,
                sessionId: data.sessionId,
                eventType: 'warning',
                actionType: data.warningType || 'warning',
                reason: data.message || data.warningType || 'Violation alert received',
                actorName: 'Proctoring Engine',
                actorRole: 'system',
                occurredAt: new Date().toISOString()
            });
        });

        socket.on('student-face-violation', (data: { sessionId: number; faceCount: number; warningNumber: number; timestamp?: string }) => {
            appendTimelineEvent(data.sessionId, {
                id: `socket-face-${Date.now()}`,
                sessionId: data.sessionId,
                eventType: 'warning',
                actionType: 'face-violation',
                reason: `Face anomaly detected (${data.faceCount} faces). Warning ${data.warningNumber}/3.`,
                actorName: 'Proctoring Engine',
                actorRole: 'system',
                occurredAt: data.timestamp || new Date().toISOString()
            });
        });

        socket.on('student-progress-update', (data: { sessionId: number; questionId: number }) => {
            appendTimelineEvent(data.sessionId, {
                id: `socket-progress-${Date.now()}`,
                sessionId: data.sessionId,
                eventType: 'activity',
                actionType: 'progress',
                reason: `Answered question ${data.questionId}`,
                actorName: 'Student',
                actorRole: 'student',
                occurredAt: new Date().toISOString()
            });
        });

        socket.on('teacher-proctor-action', (data: {
            sessionId: number;
            actionType: string;
            reason: string;
            actionedByName?: string;
            actionedAt?: string;
        }) => {
            setSessions((prev) => prev.map((session) => {
                if (session.id !== data.sessionId) return session;
                if (data.actionType === 'terminate') {
                    return { ...session, status: 'terminated', last_action: 'terminated', last_update: data.actionedAt || new Date().toISOString() };
                }
                if (data.actionType === 'suspend') {
                    return { ...session, is_suspended: true, last_action: 'suspend', last_update: data.actionedAt || new Date().toISOString() };
                }
                if (data.actionType === 'warn') {
                    return {
                        ...session,
                        warnings_count: session.warnings_count + 1,
                        last_action: 'warn',
                        last_update: data.actionedAt || new Date().toISOString()
                    };
                }
                return session;
            }));
            appendTimelineEvent(data.sessionId, {
                id: `socket-action-${Date.now()}`,
                sessionId: data.sessionId,
                eventType: 'action',
                actionType: data.actionType,
                reason: data.reason,
                actorName: data.actionedByName || 'Teacher',
                actorRole: 'teacher',
                occurredAt: data.actionedAt || new Date().toISOString()
            });
        });

        socket.on('student-disconnected', (data: { userId: number }) => {
            setSessions((prev) => prev.filter((session) => session.student_id !== data.userId));
        });

        socket.on('student-rough-work', (data: { userId: number; content: string }) => {
            setSessions((prev) => prev.map((session) =>
                session.student_id === data.userId ? { ...session, roughWork: data.content } : session
            ));
            setSelectedSessionLog((prev) => {
                if (!prev || prev.session.student_id !== data.userId) return prev;
                return { ...prev, session: { ...prev.session, roughWork: data.content } };
            });
        });

        return () => {
            window.clearInterval(timelineRefreshInterval);
            socket.disconnect();
            Object.values(peersRef.current).forEach((peer) => peer.destroy());
            peersRef.current = {};
        };
    }, [selectedExamId]);

    const filteredSessions = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        if (!query) return sessions;
        return sessions.filter((session) =>
            session.student_name.toLowerCase().includes(query)
            || session.prn_number.toLowerCase().includes(query)
        );
    }, [sessions, searchTerm]);

    const getStatusType = (session: StudentSession) => {
        if (session.status === 'terminated') return 'critical';
        if (session.is_suspended) return 'suspended';
        if (session.warnings_count >= 3) return 'critical';
        if (session.warnings_count > 0) return 'warning';
        return 'secure';
    };

    const getStatusLabel = (session: StudentSession) => {
        if (session.status === 'terminated') return 'terminated';
        if (session.is_suspended) return 'suspended';
        if (session.warnings_count > 0) return 'flagged';
        return 'secure';
    };

    return (
        <DashboardLayout userType="teacher">
            <div className="proctoring-page">
                <header className="page-header">
                    <div className="header-meta">
                        <h1>Live Invigilation</h1>
                        <div className="active-stats">
                            <div className="stat"><Users size={16} /> {sessions.length} Active</div>
                            <div className="stat warn"><ShieldAlert size={16} /> {sessions.filter((session) => session.warnings_count > 0 || session.is_suspended).length} Flagged</div>
                        </div>
                    </div>

                    <div className="header-filters">
                        <select
                            className="neo-select"
                            value={selectedExamId || ''}
                            onChange={(event) => setSelectedExamId(Number(event.target.value))}
                            style={{ padding: '0.6rem 1rem', background: 'var(--surface-low)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                        >
                            <option value="" disabled>Select Exam to Monitor</option>
                            {exams.map((exam) => (
                                <option key={exam.id} value={exam.id}>{exam.title}</option>
                            ))}
                        </select>
                        <div className="search-box">
                            <Search size={18} />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Filter by Name or PRN..."
                            />
                        </div>
                    </div>
                </header>

                <div className="monitoring-grid">
                    {filteredSessions.length === 0 && !loading && (
                        <div className="no-sessions neo-card" style={{ gridColumn: '1/-1', padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <Users size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                            <h3>No active sessions found for this exam</h3>
                            <p>Waiting for students to join...</p>
                        </div>
                    )}

                    {filteredSessions.map((session, index) => {
                        const statusType = getStatusType(session);
                        const actionState = actionInProgress[session.id];
                        const timeline = timelineBySession[session.id] || [];

                        return (
                            <motion.div
                                key={session.id}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: index * 0.04 }}
                                className={`proctor-feed neo-card ${statusType}`}
                            >
                                <div className="feed-video">
                                    {streams[session.student_id] ? (
                                        <video
                                            autoPlay
                                            playsInline
                                            ref={(video) => {
                                                if (video) video.srcObject = streams[session.student_id];
                                            }}
                                        />
                                    ) : (
                                        <div className="video-placeholder">
                                            {statusType === 'critical' ? <VideoOff size={48} /> : <Video size={48} />}
                                        </div>
                                    )}
                                    <div className="feed-overlay">
                                        <span className="device-tag"><Monitor size={12} /> Live</span>
                                        {session.roughWork && <span className="device-tag" style={{ background: 'rgba(139, 92, 246, 0.4)' }}><Edit3 size={12} /> Pad Active</span>}
                                        <span className="focus-tag">Warnings: {session.warnings_count}/3</span>
                                    </div>
                                </div>

                                <div className="feed-info">
                                    <div className="student-brief">
                                        <span className="student-name">{session.student_name}</span>
                                        <span className="status-label">{getStatusLabel(session)}</span>
                                    </div>
                                    <div className="last-action">
                                        {session.last_action || 'Session Active'}
                                        {session.last_update && ` • ${new Date(session.last_update).toLocaleTimeString()}`}
                                    </div>

                                    <div className="reason-input-wrap">
                                        <input
                                            className="reason-input"
                                            value={actionReasonBySession[session.id] || ''}
                                            onChange={(event) => setActionReasonBySession((prev) => ({
                                                ...prev,
                                                [session.id]: event.target.value
                                            }))}
                                            placeholder="Reason (optional)"
                                        />
                                    </div>

                                    <div className="feed-actions-grid">
                                        <button className="small-btn talk" title="Voice Intervention" onClick={() => handleVoiceIntervention(session)}>
                                            <Mic size={14} /> Talk
                                        </button>
                                        <button className="small-btn" onClick={() => openSessionLog(session)}>View Log</button>
                                        <button className="small-btn warn" disabled={!!actionState} onClick={() => runAction(session, 'warn')}>
                                            {actionState === 'warn' ? 'Applying...' : 'Warn'}
                                        </button>
                                        <button className="small-btn suspend" disabled={!!actionState} onClick={() => runAction(session, 'suspend')}>
                                            {actionState === 'suspend' ? 'Applying...' : 'Suspend'}
                                        </button>
                                        <button className="small-btn terminate" disabled={!!actionState} onClick={() => runAction(session, 'terminate')}>
                                            {actionState === 'terminate' ? 'Applying...' : 'Terminate'}
                                        </button>
                                    </div>

                                    <div className="timeline-preview">
                                        <h4>Violation Timeline</h4>
                                        {timeline.length === 0 ? (
                                            <p>No incidents logged yet.</p>
                                        ) : (
                                            <ul>
                                                {timeline.slice(0, 3).map((entry) => (
                                                    <li key={entry.id}>
                                                        <span>{entry.reason}</span>
                                                        <small>{new Date(entry.occurredAt).toLocaleTimeString()}</small>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                {selectedSessionLog && (
                    <div className="log-overlay" onClick={() => setSelectedSessionLog(null)}>
                        <div className="log-panel neo-card" onClick={(event) => event.stopPropagation()}>
                            <header className="log-header">
                                <div>
                                    <h3>{selectedSessionLog.session.student_name} • Session Log</h3>
                                    <p>{selectedSessionLog.session.prn_number}</p>
                                </div>
                                <button className="icon-close" onClick={() => setSelectedSessionLog(null)}>
                                    <X size={16} />
                                </button>
                            </header>

                            {logLoading ? (
                                <div className="log-loading">Loading audit trail...</div>
                            ) : (
                                <div className="log-content" style={{ gridTemplateColumns: '1fr 1fr 1.29fr' }}>
                                    <section>
                                        <h4>Timeline</h4>
                                        {selectedSessionLog.timeline.length === 0 ? (
                                            <p className="empty-log">No timeline entries found.</p>
                                        ) : (
                                            <ul className="log-list">
                                                {selectedSessionLog.timeline.map((entry) => (
                                                    <li key={entry.id}>
                                                        <div>
                                                            <strong>{entry.actionType}</strong>
                                                            <p>{entry.reason}</p>
                                                        </div>
                                                        <small>{new Date(entry.occurredAt).toLocaleString()}</small>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </section>

                                    <section>
                                        <h4>Audit Trail (Who / When / Why)</h4>
                                        {selectedSessionLog.auditTrail.length === 0 ? (
                                            <p className="empty-log">No proctor actions captured yet.</p>
                                        ) : (
                                            <ul className="log-list">
                                                {selectedSessionLog.auditTrail.map((entry) => (
                                                    <li key={`${entry.id}-audit`}>
                                                        <div>
                                                            <strong>{entry.actorName || 'System'} • {entry.actionType}</strong>
                                                            <p>{entry.reason || 'No reason provided'}</p>
                                                        </div>
                                                        <small>{new Date(entry.occurredAt).toLocaleString()}</small>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </section>

                                    <section className="rough-work-section">
                                        <h4>Digital Rough Pad (Live)</h4>
                                        <div className="rough-work-display">
                                            {selectedSessionLog.session.roughWork ? (
                                                <pre>{selectedSessionLog.session.roughWork}</pre>
                                            ) : (
                                                <p className="empty-log">No rough work recorded yet.</p>
                                            )}
                                        </div>
                                    </section>
                                    <section className="snapshots-gallery">
                                        <h4>Periodic Security Snapshots (Every 5 min)</h4>
                                        <div className="snapshot-grid">
                                            {selectedSessionLog.timeline.filter(t => t.actionType === 'periodic-snapshot' || (t as any).metadata?.snapshotData).length === 0 ? (
                                                <p className="empty-log">No automated snapshots captured yet.</p>
                                            ) : (
                                                selectedSessionLog.timeline
                                                    .filter(t => (t as any).metadata?.snapshotData)
                                                    .map((t: any) => (
                                                        <div key={t.id} className="snapshot-item">
                                                            <img src={t.metadata.snapshotData} alt="Secret Snapshot" />
                                                            <span>{new Date(t.occurredAt).toLocaleTimeString()}</span>
                                                        </div>
                                                    ))
                                            )}
                                        </div>
                                    </section>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <style>{`
          .proctoring-page { display: flex; flex-direction: column; gap: 2rem; }
          .small-btn.talk {
            background: rgba(139, 92, 246, 0.1);
            border-color: rgba(139, 92, 246, 0.3);
            color: #a78bfa;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
          }
          .small-btn.talk:hover {
            background: rgba(139, 92, 246, 0.2);
            border-color: rgba(139, 92, 246, 0.6);
            color: #fff;
          }

          .snapshots-gallery {
            padding: 1.5rem;
            border-top: 1px solid var(--border);
            background: rgba(0,0,0,0.1);
          }
          .snapshots-gallery h4 { margin: 0 0 1rem; font-size: 0.85rem; color: var(--text-muted); }
          .snapshot-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 1rem;
          }
          .snapshot-item {
            position: relative;
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid var(--border);
            aspect-ratio: 4/3;
            background: #000;
          }
          .snapshot-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.8;
            transition: 0.3s;
          }
          .snapshot-item:hover img { opacity: 1; transform: scale(1.05); }
          .snapshot-item span {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 0.25rem 0.5rem;
            background: rgba(0,0,0,0.7);
            font-size: 0.65rem;
            color: #fff;
            text-align: center;
          }
          .page-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
          .header-meta h1 { font-size: 2.2rem; margin-bottom: 0.45rem; font-family: var(--font-display); }
          .active-stats { display: flex; gap: 1.2rem; font-size: 0.8125rem; font-weight: 700; }
          .stat { display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted); }
          .stat.warn { color: var(--error); }
          
          .header-filters { display: flex; gap: 0.8rem; flex-wrap: wrap; }
          .search-box { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: var(--surface-low); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); font-size: 0.875rem; min-width: 240px; }
          .search-box input { background: none; color: var(--text-primary); border: none; outline: none; width: 100%; }

          .monitoring-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 1rem;
            padding-bottom: 2rem;
          }
          .proctor-feed {
            padding: 0.75rem;
            display: flex;
            flex-direction: column;
            gap: 0.85rem;
            border: 2px solid transparent !important;
            background: var(--surface-low);
            transition: var(--transition-normal);
          }
          .proctor-feed.warning { border-color: var(--accent) !important; }
          .proctor-feed.critical { border-color: var(--error) !important; box-shadow: 0 0 15px rgba(239, 68, 68, 0.2); }
          .proctor-feed.suspended { border-color: #f97316 !important; box-shadow: 0 0 15px rgba(249, 115, 22, 0.22); }
          
          .feed-video { position: relative; aspect-ratio: 16/9; background: var(--bg, #000000); border-radius: 4px; overflow: hidden; }
          .feed-video video { width: 100%; height: 100%; object-fit: cover; }
          .video-placeholder { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--surface); opacity: 0.35; }
          .feed-overlay { position: absolute; top: 0; left: 0; right: 0; padding: 0.65rem; display: flex; justify-content: space-between; background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent); }
          .device-tag, .focus-tag { font-size: 0.6rem; font-weight: 700; color: #fff; text-transform: uppercase; background: rgba(0,0,0,0.55); padding: 0.2rem 0.4rem; border-radius: 2px; display: flex; align-items: center; gap: 0.25rem; }
          
          .feed-info { display: flex; flex-direction: column; gap: 0.75rem; }
          .student-brief { display: flex; justify-content: space-between; align-items: center; }
          .student-name { font-weight: 700; font-size: 0.9375rem; color: var(--text-primary); }
          .status-label { font-size: 0.625rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.5rem; border-radius: 2px; background: var(--surface-high); }
          .critical .status-label { color: var(--error); background: rgba(239, 68, 68, 0.1); }
          .warning .status-label { color: var(--accent); background: rgba(255, 171, 0, 0.1); }
          .suspended .status-label { color: #f97316; background: rgba(249, 115, 22, 0.16); }
          .secure .status-label { color: var(--success); background: rgba(16, 185, 129, 0.1); }
          .last-action { font-size: 0.75rem; color: var(--text-muted); }
          
          .reason-input-wrap { display: flex; }
          .reason-input {
            width: 100%;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 0.45rem 0.55rem;
            color: var(--text-primary);
            font-size: 0.78rem;
          }
          .reason-input:focus { outline: none; border-color: var(--accent); }

          .feed-actions-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; }
          .small-btn {
            padding: 0.55rem 0.35rem;
            font-size: 0.7rem;
            font-weight: 700;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text-secondary);
            border-radius: 4px;
            transition: var(--transition-fast);
          }
          .small-btn:hover:not(:disabled) { background: var(--surface-high); color: var(--text-primary); }
          .small-btn:disabled { opacity: 0.55; cursor: not-allowed; }
          .small-btn.warn { border-color: rgba(249, 115, 22, 0.4); color: #f59e0b; }
          .small-btn.suspend { border-color: rgba(239, 68, 68, 0.35); color: #f97316; }
          .small-btn.terminate { border-color: rgba(239, 68, 68, 0.45); color: #ef4444; }

          .timeline-preview {
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 0.65rem;
            background: rgba(255,255,255,0.01);
          }
          .timeline-preview h4 { margin: 0 0 0.45rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
          .timeline-preview p { margin: 0; font-size: 0.77rem; color: var(--text-muted); }
          .timeline-preview ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.45rem; }
          .timeline-preview li { display: flex; justify-content: space-between; gap: 0.65rem; font-size: 0.76rem; }
          .timeline-preview li span { color: var(--text-secondary); line-height: 1.35; }
          .timeline-preview li small { color: var(--text-muted); white-space: nowrap; }

          .log-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.76);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            z-index: 1000;
          }
          .log-panel {
            width: min(980px, 100%);
            max-height: 88vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          .log-header {
            padding: 1rem 1.2rem;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 1rem;
          }
          .log-header h3 { margin: 0 0 0.2rem; font-size: 1rem; }
          .log-header p { margin: 0; color: var(--text-muted); font-size: 0.8rem; }
          .icon-close {
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--surface);
            color: var(--text-secondary);
          }
          .log-content {
            padding: 1rem 1.2rem 1.2rem;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1rem;
            overflow: auto;
          }
          .log-content section { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem; }
          .log-content section h4 { margin: 0 0 0.65rem; font-size: 0.85rem; }
          .empty-log { margin: 0; color: var(--text-muted); font-size: 0.8rem; }
          .log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.65rem; }
          .log-list li { border: 1px solid var(--border); border-radius: 6px; padding: 0.55rem; display: flex; justify-content: space-between; gap: 0.7rem; }
          .log-list strong { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; }
          .log-list p { margin: 0.2rem 0 0; color: var(--text-secondary); font-size: 0.8rem; line-height: 1.35; }
          .log-list small { color: var(--text-muted); font-size: 0.72rem; white-space: nowrap; }
          .log-loading { padding: 2rem; color: var(--text-muted); text-align: center; }

          .rough-work-section { background: rgba(0,0,0,0.2) !important; border-color: rgba(139, 92, 246, 0.3) !important; flex: 1; display: flex; flex-direction: column; }
          .rough-work-display { 
              flex: 1;
              min-height: 300px;
              overflow: auto; 
              background: var(--bg, #000000); 
              padding: 1rem; 
              border-radius: 4px; 
              font-family: 'JetBrains Mono', monospace; 
              font-size: 0.85rem; 
              color: #a78bfa;
              line-height: 1.5;
              white-space: pre-wrap;
              border: 1px solid rgba(255,255,255,0.05);
          }
          .rough-work-display pre { margin: 0; }

          @media (max-width: 900px) {
            .feed-actions-grid { grid-template-columns: 1fr 1fr; }
            .log-content { grid-template-columns: 1fr; }
          }
        `}</style>
            </div>
        </DashboardLayout>
    );
};

export default LiveProctoring;
