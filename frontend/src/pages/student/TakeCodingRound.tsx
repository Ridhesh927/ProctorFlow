import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { Loader2, Send, AlertTriangle, CheckCircle, Code2, Play, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { apiFetch } from '../../utils/api';
import './TakeCodingRound.css';

interface CodingQuestion {
    title: string;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    description: string;
    examples: { input: string; output: string; explanation?: string }[];
    constraints: string;
    hint?: string;
    source_company?: string;
    round_type?: 'coding' | 'aptitude' | 'mixed';
    provenance_mode?: string;
    history_note?: string;
}

interface CodingRound {
    id: number;
    include_hard: boolean;
    questions: CodingQuestion[];
    language: string;
}

const LANGUAGES = [
    { label: 'JavaScript', value: 'javascript' },
    { label: 'Python', value: 'python' },
    { label: 'Java', value: 'java' },
    { label: 'C++', value: 'cpp' },
];

const STARTER_CODE: Record<string, string> = {
    javascript: '// Write your solution here\nfunction solution() {\n  \n}\n',
    python: '# Write your solution here\ndef solution():\n    pass\n',
    java: '// Write your solution here\nclass Solution {\n    public void solution() {\n        \n    }\n}\n',
    cpp: '// Write your solution here\n#include <bits/stdc++.h>\nusing namespace std;\n\nvoid solution() {\n    \n}\n',
};

const DIFF_COLOR: Record<string, string> = {
    Easy: '#22c55e',
    Medium: '#eab308',
    Hard: '#ef4444',
};

const formatElapsedTime = (totalSeconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

type TimerStatus = 'running' | 'paused';

interface CodingTimerState {
    startedAt: number | null;
    accumulatedSeconds: number;
    status: TimerStatus;
}

interface TestCaseStats {
    total_test_cases: number;
    completed_test_cases: number;
    passed_test_cases: number;
    failed_test_cases: number;
    remaining_test_cases: number;
}



const TakeCodingRound = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const codingShellRef = useRef<HTMLDivElement>(null);
    const warningCountRef = useRef(0);
    const lastViolationTimeRef = useRef(0);
    const hasStartedRef = useRef(false);
    const isTerminatedRef = useRef(false);
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
    const [warningCount, setWarningCount] = useState(0);
    const [isTerminated, setIsTerminated] = useState(false);

    const [round, setRound] = useState<CodingRound | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeQ, setActiveQ] = useState(0);
    const [language, setLanguage] = useState('javascript');
    
    // Store code per language
    const [codesByLang, setCodesByLang] = useState<Record<string, { q1: string, q2: string }>>({
        javascript: { q1: STARTER_CODE['javascript'], q2: STARTER_CODE['javascript'] },
        python: { q1: STARTER_CODE['python'], q2: STARTER_CODE['python'] },
        java: { q1: STARTER_CODE['java'], q2: STARTER_CODE['java'] },
        cpp: { q1: STARTER_CODE['cpp'], q2: STARTER_CODE['cpp'] },
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showHint, setShowHint] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [timerStatus, setTimerStatus] = useState<TimerStatus>('running');
    const timerStateRef = useRef<CodingTimerState>({
        startedAt: null,
        accumulatedSeconds: 0,
        status: 'running',
    });
    const timerRef = useRef<number | null>(null);
    const timerStorageKey = id ? `coding-round-timer-${id}` : null;

    const syncTimerDisplay = () => {
        const state = timerStateRef.current;
        const runningSeconds = state.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
        const totalSeconds = state.accumulatedSeconds + runningSeconds;
        setElapsedSeconds(totalSeconds);
        setTimerStatus(state.status);
        return totalSeconds;
    };

    const persistTimerState = () => {
        if (!timerStorageKey) return;
        localStorage.setItem(timerStorageKey, JSON.stringify(timerStateRef.current));
    };

    const loadTimerState = () => {
        if (!timerStorageKey) return;

        const stored = localStorage.getItem(timerStorageKey);
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as Partial<CodingTimerState>;
                timerStateRef.current = {
                    startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
                    accumulatedSeconds: Math.max(0, Number(parsed.accumulatedSeconds) || 0),
                    status: parsed.status === 'paused' ? 'paused' : 'running',
                };
            } catch {
                timerStateRef.current = { startedAt: Date.now(), accumulatedSeconds: 0, status: 'running' };
            }
        } else {
            timerStateRef.current = { startedAt: Date.now(), accumulatedSeconds: 0, status: 'running' };
            persistTimerState();
        }

        syncTimerDisplay();
    };

    const startTimer = () => {
        const current = timerStateRef.current;
        if (current.status === 'running') return;

        current.startedAt = Date.now();
        current.status = 'running';
        timerStateRef.current = current;
        persistTimerState();
        syncTimerDisplay();
    };

    const pauseTimer = () => {
        const current = timerStateRef.current;
        if (current.status === 'paused') return;

        if (current.startedAt) {
            current.accumulatedSeconds += Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000));
        }
        current.startedAt = null;
        current.status = 'paused';
        timerStateRef.current = current;
        persistTimerState();
        syncTimerDisplay();
    };

    const restartTimer = () => {
        timerStateRef.current = {
            startedAt: Date.now(),
            accumulatedSeconds: 0,
            status: 'running',
        };
        persistTimerState();
        syncTimerDisplay();
    };

    const getElapsedTime = () => syncTimerDisplay();

    const [runState, setRunState] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
    const [runOutput, setRunOutput] = useState<{ stdout: string; stderr: string; compile: string; ai_test_feedback?: string; test_case_stats?: TestCaseStats | null } | null>(null);
    const [showConsole, setShowConsole] = useState(false);

    useEffect(() => {
        const fetch = async () => {
            try {
                const res = await apiFetch(`/api/coding/${id}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.message);
                setRound(data.round);

                loadTimerState();
            } catch (e: any) {
                alert(e.message);
                navigate('/student/dashboard');
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [id, navigate]);

    useEffect(() => {
        if (round) {
            hasStartedRef.current = true;
        }
    }, [round]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const currentFull = !!document.fullscreenElement;
            setIsFullscreen(currentFull);

            if (!currentFull && hasStartedRef.current && !isTerminatedRef.current) {
                handleViolation('Fullscreen Exited');
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

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    useEffect(() => {
        if (warningCount >= 3 && !isTerminated) {
            terminateCodingRound('Proctoring violations (3/3 warnings)');
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

    const terminateCodingRound = async (reason: string) => {
        if (isTerminated) return;
        isTerminatedRef.current = true;
        setIsTerminated(true);

        if (document.fullscreenElement) {
            await document.exitFullscreen().catch(() => { });
        }

        try {
            await handleSubmit();
        } catch (error) {
            console.error('Auto-submit failed after termination', error);
            alert(reason);
            navigate('/student/dashboard');
        }
    };

    useEffect(() => {
        if (!round || isSubmitting || timerStatus !== 'running') {
            if (timerRef.current) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }

        if (timerRef.current) {
            window.clearInterval(timerRef.current);
        }

        timerRef.current = window.setInterval(() => {
            syncTimerDisplay();
            persistTimerState();
        }, 1000);

        return () => {
            if (timerRef.current) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [round, isSubmitting, timerStatus]);

    const handleLanguageChange = (lang: string) => {
        setLanguage(lang);
    };

    const handleRunCode = async () => {
        setRunState('running');
        setShowConsole(true);
        setRunOutput(null);

        const currentCode = codesByLang[language][activeQ === 0 ? 'q1' : 'q2'];
        try {
            const res = await apiFetch('/api/coding/execute', {
                method: 'POST',
                body: JSON.stringify({
                    language,
                    sourceCode: currentCode,
                    stdin: '',
                    codingId: id,
                    questionIndex: activeQ
                })
            });
            const data = await res.json();
            
            if (res.ok) {
                const aiStatus = data.ai_test_status || 'fail';
                const testCaseStats = data.test_case_stats || null;
                const aiPassed = aiStatus === 'pass' && (!testCaseStats || testCaseStats.failed_test_cases === 0);

                setRunOutput({
                    stdout: data.stdout || '',
                    stderr: data.stderr || '',
                    compile: data.compile_output || '',
                    ai_test_feedback: data.ai_test_feedback || '',
                    test_case_stats: testCaseStats,
                });
                
                // Green only when AI test passes and there are no failed test cases.
                if (!aiPassed) {
                    setRunState('error');
                } else {
                    setRunState(data.status?.id === 3 ? 'success' : 'error');
                }
            } else {
                throw new Error(data.message || 'Execution failed');
            }
        } catch (e: any) {
            setRunOutput({ stdout: '', stderr: e.message || 'Failed to reach execution engine.', compile: '' });
            setRunState('error');
        }
    };

    const handleSubmit = async () => {
        if (isTerminated && isSubmitting) return;
        setIsSubmitting(true);
        try {
            const res = await apiFetch(`/api/coding/${id}/submit`, {
                method: 'POST',
                body: JSON.stringify({
                    q1Code: codesByLang[language].q1,
                    q2Code: codesByLang[language].q2,
                    language,
                        completionTimeSeconds: getElapsedTime(),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            if (id) {
                localStorage.removeItem(timerStorageKey || `coding-round-timer-${id}`);
            }
            navigate(`/student/coding/result/${id}`);
        } catch (e: any) {
            alert(e.message || 'Submission failed.');
            setIsSubmitting(false);
        }
    };

    if (loading) return (
        <div className="coding-full-loader">
            <Loader2 className="animate-spin" size={48} />
            <p>Loading your coding challenge...</p>
        </div>
    );

    if (!round) return null;

    const q = round.questions[activeQ];
    const codeKey = activeQ === 0 ? 'q1' : 'q2';
    const expandedHint = q.hint && q.hint.length < 120
        ? `${q.hint} Focus on the core pattern, keep the solution linear if possible, and test edge cases before you submit.`
        : q.hint;

    if (isTerminated) {
        return (
            <div className="fullscreen-guard termination-screen">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="guard-content neo-card"
                >
                    <AlertTriangle size={48} className="text-error" />
                    <h1 className="text-error">Coding Round Terminated</h1>
                    <p>Your session has been terminated due to multiple rule violations (3/3 warnings). Progress has been auto-submitted.</p>
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
                            <p>You have exited the secure coding environment. Continuing to do so will result in automatic termination.</p>
                        </>
                    ) : (
                        <>
                            <AlertTriangle size={48} className="text-accent" />
                            <h1>Secure Session Required</h1>
                            <p>This coding assessment requires an immersive environment. Please enable fullscreen to commence.</p>
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
        <div className={`coding-container ${isFullscreen ? 'fullscreen-active' : ''}`} ref={codingShellRef}>
            {/* Top bar */}
            <header className="coding-header">
                <div className="coding-header-left">
                    <Code2 size={22} className="text-accent" />
                    <span className="coding-title">DSA Coding Round</span>
                    {round.questions?.[0]?.source_company && (
                        <span className="diff-tag" style={{ marginLeft: '0.75rem' }}>
                            {round.questions[0].source_company} Pattern
                        </span>
                    )}
                    {round.questions?.[0]?.round_type && (
                        <span className="diff-tag" style={{ marginLeft: '0.5rem' }}>
                            {round.questions[0].round_type.toUpperCase()}
                        </span>
                    )}
                    {round.questions?.[0]?.provenance_mode === 'pattern-simulated' && (
                        <span className="diff-tag" style={{ marginLeft: '0.5rem', opacity: 0.9 }}>
                            Pattern Simulated
                        </span>
                    )}
                    <div className="q-tabs">
                        {round.questions.map((q2, i) => (
                            <button
                                key={i}
                                className={`q-tab ${activeQ === i ? 'active' : ''}`}
                                onClick={() => { setActiveQ(i); setShowHint(false); }}
                            >
                                Q{i + 1}
                                <span className="diff-tag" style={{ background: DIFF_COLOR[q2.difficulty] + '22', color: DIFF_COLOR[q2.difficulty] }}>
                                    {q2.difficulty}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="coding-header-right">
                    <div className="coding-timer" title="Time spent on this coding round">
                        <span className="coding-timer-label">Time</span>
                        <span className="coding-timer-value">{formatElapsedTime(elapsedSeconds)}</span>
                        <span className={`coding-timer-status ${timerStatus}`}>{timerStatus === 'running' ? 'Running' : 'Paused'}</span>
                    </div>
                    <div className="coding-timer-actions">
                        {timerStatus === 'running' ? (
                            <button type="button" className="timer-action-btn" onClick={pauseTimer} disabled={isSubmitting}>
                                Pause
                            </button>
                        ) : (
                            <button type="button" className="timer-action-btn" onClick={startTimer} disabled={isSubmitting}>
                                Start
                            </button>
                        )}
                        <button type="button" className="timer-action-btn secondary" onClick={restartTimer} disabled={isSubmitting}>
                            Restart
                        </button>
                    </div>
                    <div className="coding-warning-badge" title="Three warnings will end the coding round automatically">
                        Warnings: {warningCount}/3
                    </div>
                    <select
                        className="lang-select"
                        value={language}
                        onChange={e => handleLanguageChange(e.target.value)}
                    >
                        {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            className="btn-secondary"
                            onClick={handleRunCode}
                            disabled={runState === 'running' || isSubmitting}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'var(--surface-high)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', opacity: (runState === 'running' || isSubmitting) ? 0.6 : 1 }}
                        >
                            {runState === 'running' ? (
                                <><Loader2 size={16} className="animate-spin" /> Running...</>
                            ) : (
                                <><Play size={16} /> Run Code</>
                            )}
                        </button>
                        <button
                            className="submit-code-btn"
                            onClick={handleSubmit}
                            disabled={isSubmitting || runState === 'running' || isTerminated}
                        >
                            {isSubmitting ? (
                                <><Loader2 size={16} className="animate-spin" /> AI Grading...</>
                            ) : (
                                <><Send size={16} /> Submit Both Solutions</>
                            )}
                        </button>
                    </div>
                </div>
            </header>

            {/* Main split pane */}
            <div className="coding-split">
                {/* Left: Problem Statement */}
                <div className="problem-pane">
                    <div className="problem-title-row">
                        <h2>{q.title}</h2>
                        <span className="diff-badge" style={{ background: DIFF_COLOR[q.difficulty] + '22', color: DIFF_COLOR[q.difficulty] }}>
                            {q.difficulty}
                        </span>
                    </div>

                    <p className="problem-description">{q.description}</p>
                    {q.examples.map((ex: any, i: number) => (
                        <div key={i} className="example-block">
                            <div className="example-label">Example {i + 1}</div>
                            <div className="example-line"><strong>Input:</strong> <code>{typeof ex.input === 'object' ? JSON.stringify(ex.input) : ex.input}</code></div>
                            <div className="example-line"><strong>Output:</strong> <code>{typeof ex.output === 'object' ? JSON.stringify(ex.output) : ex.output}</code></div>
                            {ex.explanation && <div className="example-line text-muted"><strong>Explanation:</strong> {ex.explanation}</div>}
                        </div>
                    ))}

                    <div className="constraints-block">
                        <strong>Constraints:</strong>
                        <pre>{q.constraints}</pre>
                    </div>

                    {q.hint && (
                        <div className="hint-section">
                            <button className="hint-toggle" onClick={() => setShowHint(v => !v)}>
                                <AlertTriangle size={14} /> {showHint ? 'Hide Hint' : 'Show Hint'}
                            </button>
                            {showHint && <p className="hint-text">{expandedHint}</p>}
                        </div>
                    )}
                </div>

                {/* Right: Monaco Editor + Console */}
                <div className="editor-pane" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="editor-tabs" style={{ flexShrink: 0 }}>
                        {round.questions.map((_, i) => (
                            <button
                                key={i}
                                className={`editor-tab ${activeQ === i ? 'active' : ''}`}
                                onClick={() => { setActiveQ(i); setShowConsole(false); }}
                            >
                                {i === 0 ? <CheckCircle size={14} style={{ color: codesByLang[language].q1 !== STARTER_CODE[language] ? '#22c55e' : 'currentColor' }} /> : <CheckCircle size={14} style={{ color: codesByLang[language].q2 !== STARTER_CODE[language] ? '#22c55e' : 'currentColor' }} />}
                                &nbsp;Q{i + 1}.{language.slice(0, 2)}
                            </button>
                        ))}
                    </div>
                    <div style={{ flexGrow: 1, minHeight: 0 }}>
                        <Editor
                            height={showConsole ? "calc(100vh - 430px)" : "calc(100vh - 180px)"}
                            language={language}
                            value={codesByLang[language][codeKey]}
                            onChange={val => setCodesByLang(prev => ({
                                ...prev,
                                [language]: {
                                    ...prev[language],
                                    [codeKey]: val || ''
                                }
                            }))}
                            theme="vs-dark"
                            options={{
                                fontSize: 14,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                wordWrap: 'on',
                                automaticLayout: true,
                            }}
                        />
                    </div>
                    
                    {/* Execution Console */}
                    {showConsole && (
                        <div className="output-console neo-card" style={{ height: '250px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)', margin: 0, borderRadius: 0, animation: 'slideUp 0.3s ease-out' }}>
                            <div className="console-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1rem', background: 'var(--surface-high)', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span>Execution Console</span>
                                    {runState === 'success' && <span style={{ color: '#22c55e', fontSize: '0.75rem', background: '#22c55e22', padding: '0.1rem 0.4rem', borderRadius: '12px' }}>Success</span>}
                                    {runState === 'error' && <span style={{ color: '#ef4444', fontSize: '0.75rem', background: '#ef444422', padding: '0.1rem 0.4rem', borderRadius: '12px' }}>Error</span>}
                                </div>
                                <button onClick={() => setShowConsole(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="console-body" style={{ flex: 1, padding: '1rem', overflowY: 'auto', background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: '1.5' }}>
                                {runState === 'running' && <div style={{ color: '#888', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Loader2 size={14} className="animate-spin" /> Compiling and executing...</div>}
                                {runState !== 'running' && runOutput && (
                                    <>
                                        {runOutput.ai_test_feedback && (
                                            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: runOutput.ai_test_feedback.includes('❌') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)', border: `1px solid ${runOutput.ai_test_feedback.includes('❌') ? '#ef444455' : '#22c55e55'}`, borderRadius: '6px' }}>
                                                <strong style={{ marginBottom: '0.3rem', color: runOutput.ai_test_feedback.includes('❌') ? '#fca5a5' : '#86efac', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    AI Test Runner:
                                                </strong>
                                                <div style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{runOutput.ai_test_feedback}</div>
                                                {runOutput.test_case_stats && (
                                                    <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                        <strong style={{ color: 'var(--text-primary)' }}>Test Cases:</strong>{' '}
                                                        Completed {runOutput.test_case_stats.completed_test_cases}/{runOutput.test_case_stats.total_test_cases}{' '}
                                                        | Passed {runOutput.test_case_stats.passed_test_cases}{' '}
                                                        | Failed {runOutput.test_case_stats.failed_test_cases}{' '}
                                                        | Remaining {runOutput.test_case_stats.remaining_test_cases}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {runOutput.compile && (
                                            <div style={{ color: '#ef4444', marginBottom: '1rem' }}>
                                                <strong style={{ display: 'block', marginBottom: '0.3rem', color: '#fca5a5' }}>Compile Error:</strong>
                                                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{runOutput.compile}</pre>
                                            </div>
                                        )}
                                        {runOutput.stderr && (
                                            <div style={{ color: '#ef4444', marginBottom: '1rem' }}>
                                                <strong style={{ display: 'block', marginBottom: '0.3rem', color: '#fca5a5' }}>Error / Exception:</strong>
                                                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{runOutput.stderr}</pre>
                                            </div>
                                        )}
                                        {runOutput.stdout && (
                                            <div>
                                                <strong style={{ display: 'block', marginBottom: '0.3rem', color: '#86efac' }}>Output:</strong>
                                                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{runOutput.stdout}</pre>
                                            </div>
                                        )}
                                        {!runOutput.compile && !runOutput.stderr && !runOutput.stdout && (
                                            <div style={{ color: '#888', fontStyle: 'italic' }}>Program exited with code 0 (No output from stdout/stderr).</div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TakeCodingRound;
