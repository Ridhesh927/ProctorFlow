import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, ArrowLeft, BrainCircuit, Code2, CheckCircle, XCircle, Trophy, Download, Sparkles, ArrowRight } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import './CodingResults.css';

interface CodingQuestion {
    title: string;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    description: string;
}

interface CodingRound {
    id: number;
    parent_interview_id?: number;
    parent_interview_completed?: boolean;
    questions: CodingQuestion[];
    student_codes: { q1: string; q2: string };
    language: string;
    total_score: number;
    ai_feedback: string;
    completion_time_seconds?: number;
    submitted_at?: string;
    created_at: string;
}

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

const DIFF_COLOR: Record<string, string> = {
    Easy: '#22c55e',
    Medium: '#eab308',
    Hard: '#ef4444',
};

const CodingResults = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [round, setRound] = useState<CodingRound | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeQ, setActiveQ] = useState(0);

    useEffect(() => {
        const fetchRound = async () => {
            try {
                const res = await apiFetch(`/api/coding/${id}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.message);
                setRound(data.round);
            } catch (e: any) {
                alert(e.message);
                navigate('/student/dashboard');
            } finally {
                setLoading(false);
            }
        };
        fetchRound();
    }, [id, navigate]);

    const handleDownload = () => {
        if (!round) return;
        const date = new Date(round.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
        const timeTaken = formatElapsedTime(round.completion_time_seconds || 0);

        const questionsHTML = round.questions.map((q, i) => {
            const code = i === 0 ? round.student_codes?.q1 : round.student_codes?.q2;
            return `
            <h3 style="color:#6366f1;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:8px">Q${i + 1}: ${q.title} (${q.difficulty})</h3>
            <p style="color:#374151;font-size:13px;margin-bottom:10px">${q.description}</p>
            <pre style="background:#1e293b;color:#e2e8f0;padding:14px;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap">${code || '// No code submitted'}</pre>`;
        }).join('<hr style="margin:20px 0">');

        const feedbackHTML = (round.ai_feedback || '').replace(/=== (.*?) ===/g, '<h4 style="color:#6366f1;margin-top:12px">$1</h4>').replace(/\n/g, '<br>');

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Coding Round Results</title>
        <style>body{font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:30px;color:#1a1a1a;} @media print{@page{margin:20mm;}}</style>
        </head><body>
        <h1 style="font-size:22px;margin-bottom:4px">DSA Coding Round — Results</h1>
        <p style="color:#6b7280;font-size:13px;margin-bottom:4px">Date: ${date} &nbsp;|&nbsp; Score: <strong>${round.total_score}%</strong> &nbsp;|&nbsp; Time Taken: <strong>${timeTaken}</strong></p>
        <hr style="margin:16px 0;border-color:#e5e7eb">
        <h2 style="font-size:16px;margin-bottom:12px">💻 Code Submissions</h2>
        ${questionsHTML}
        <hr style="margin:20px 0;border-color:#e5e7eb">
        <h2 style="font-size:16px;margin-bottom:10px">🤖 AI Code Review</h2>
        <div style="font-size:13px;color:#374151;line-height:1.8">${feedbackHTML}</div>
        </body></html>`;

        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 500); }
    };

    if (loading) return (
        <div className="coding-results-loader">
            <Loader2 className="animate-spin" size={48} />
            <p>Loading your results...</p>
        </div>
    );

    if (!round) return null;

    const score = round.total_score;
    const scoreTier = score >= 80 ? 'excellent' : score >= 50 ? 'good' : 'needs-work';
    const feedbackSections = (round.ai_feedback || '').split(/(=== .+? ===)/g).filter(Boolean);

    return (
        <motion.div className="coding-results-container" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <button className="back-btn neo-btn-secondary" onClick={() => navigate('/student/dashboard')}>
                <ArrowLeft size={18} /> Back to Dashboard
            </button>

            <header className="results-header">
                <div>
                    <h1><Code2 size={26} className="text-accent" /> DSA Coding Round — Results</h1>
                    <p className="text-muted">AI Code Review from your Algorithmic Interview</p>
                </div>
                <div className={`score-ring ${scoreTier}`}>
                    <span className="score-num">{score}</span>
                    <span className="score-pct">/ 100</span>
                </div>
            </header>

            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Time Taken</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatElapsedTime(round.completion_time_seconds || 0)}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Submitted At</div>
                    <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                        {round.submitted_at ? new Date(round.submitted_at).toLocaleString('en-IN') : 'Not submitted yet'}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', marginBottom: '20px' }}>
                {round.parent_interview_id && (
                    round.parent_interview_completed ? (
                        <button 
                            className="neo-btn-primary" 
                            onClick={() => navigate(`/student/interview/result/${round.parent_interview_id}`)}
                            style={{ background: '#10b981', borderColor: '#059669', color: '#fff' }}
                        >
                            <BrainCircuit size={16} /> View MCQ Report
                        </button>
                    ) : (
                        <button 
                            className="neo-btn-primary" 
                            onClick={() => navigate(`/student/interview/${round.parent_interview_id}`)}
                        >
                            <Sparkles size={16} /> Proceed to Part 2: MCQ Round <ArrowRight size={16} />
                        </button>
                    )
                )}
                <button className="neo-btn-primary" onClick={handleDownload}>
                    <Download size={16} /> Download Report
                </button>
                <button className="neo-btn-secondary" onClick={() => navigate('/student/dashboard')}>
                    Finish Review
                </button>
            </div>

            {/* Code Review Section */}
            <div className="results-body">
                <div className="code-review-card card">
                    <div className="q-switcher">
                        {round.questions.map((q, i) => (
                            <button key={i} className={`q-switch-btn ${activeQ === i ? 'active' : ''}`} onClick={() => setActiveQ(i)}>
                                {activeQ === i ? <CheckCircle size={14} /> : <XCircle size={14} style={{ opacity: 0.4 }} />}
                                Q{i + 1}: {q.title}
                                <span className="diff-chip" style={{ color: DIFF_COLOR[q.difficulty] }}>{q.difficulty}</span>
                            </button>
                        ))}
                    </div>

                    <div className="code-display">
                        <div className="code-header">
                            <span>Your Code — {round.language}</span>
                        </div>
                        <pre className="code-block">
                            {(activeQ === 0 ? round.student_codes?.q1 : round.student_codes?.q2) || '// No code submitted'}
                        </pre>
                    </div>
                </div>

                {/* AI Feedback */}
                <div className="feedback-card card">
                    <div className="feedback-title-row">
                        <BrainCircuit size={22} className="text-accent" />
                        <h3>AI Code Review</h3>
                        <Trophy size={18} style={{ color: scoreTier === 'excellent' ? '#f59e0b' : '#6b7280', marginLeft: 'auto' }} />
                    </div>

                    <div className="feedback-sections">
                        {feedbackSections.map((part, i) => {
                            const isHeader = part.startsWith('=== ');
                            if (isHeader) {
                                return <h4 key={i} className="feedback-section-header">{part.replace(/===/g, '').trim()}</h4>;
                            }
                            return <p key={i} className="feedback-para">{part.trim()}</p>;
                        })}
                    </div>
                </div>
            </div>


        </motion.div>
    );
};

export default CodingResults;
