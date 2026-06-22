import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer, 
    Cell
} from 'recharts';
import { 
    Activity, 
    AlertCircle, 
    Clock, 
    TrendingDown, 
    ChevronLeft,
    BrainCircuit,
    CheckCircle2,
    HelpCircle
} from 'lucide-react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { apiFetch } from '../../utils/api';
import Skeleton from '../../components/Skeleton';

const ExamItemAnalysis = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await apiFetch(`/api/exams/teacher/exam-health/${id}`);
                const json = await response.json();
                setData(json);
            } catch (error) {
                console.error('Failed to fetch item analysis', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id]);

    if (loading) {
        return (
            <DashboardLayout userType="teacher">
                <div style={{ padding: '2rem' }}>
                    <Skeleton height={60} className="mb-4" />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
                        <Skeleton height={150} />
                        <Skeleton height={150} />
                        <Skeleton height={150} />
                    </div>
                    <Skeleton height={400} />
                </div>
            </DashboardLayout>
        );
    }

    if (!data) return <div className="p-8 text-center">Analysis not available.</div>;


    return (
        <DashboardLayout userType="teacher">
            <div className="item-analysis-page">
                <header className="analysis-header">
                    <button onClick={() => navigate(-1)} className="back-btn">
                        <ChevronLeft size={20} /> Back
                    </button>
                    <h1>{data.examTitle}</h1>
                    <div className="health-badge">
                        <Activity size={18} />
                        Exam Health: <strong>{data.metrics.overallSuccessRate}% Accuracy</strong>
                    </div>
                </header>

                <main className="analysis-grid">
                    {/* Key Metrics Cards */}
                    <div className="metrics-summary">
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="metric-card neo-card">
                            <TrendingDown size={24} className="text-error" />
                            <div>
                                <h3>Hardest Question</h3>
                                <p>{data.metrics.hardestQuestions[0]?.successRate || 'N/A'}% Success</p>
                            </div>
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="metric-card neo-card">
                            <AlertCircle size={24} className="text-warning" />
                            <div>
                                <h3>Ambiguous Items</h3>
                                <p>{data.metrics.ambiguousQuestions.length} Items Flagged</p>
                            </div>
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="metric-card neo-card">
                            <Clock size={24} className="text-accent" />
                            <div>
                                <h3>Avg. Time/Question</h3>
                                <p>{(data.allQuestions.reduce((a: any, b: any) => a + b.avgTime, 0) / data.allQuestions.length).toFixed(1)}s</p>
                            </div>
                        </motion.div>
                    </div>

                    {/* Chart Section */}
                    <div className="chart-section neo-card">
                        <div className="section-title">
                            <BrainCircuit className="text-accent" />
                            <h2>Success Rate & Timing Performance</h2>
                        </div>
                        <div className="responsive-chart">
                            <ResponsiveContainer width="100%" height={350}>
                                <BarChart data={data.allQuestions}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="id" hide />
                                    <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                        itemStyle={{ color: '#fff' }}
                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                    />
                                    <Bar dataKey="successRate" name="Success Rate (%)" radius={[4, 4, 0, 0]}>
                                        {data.allQuestions.map((entry: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={entry.successRate < 40 ? '#ef4444' : entry.successRate > 80 ? '#10b981' : '#8b5cf6'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="analysis-feed">
                        {/* Flags and Insights */}
                        <div className="insights-panel">
                            <h2>Critical Observations</h2>
                            <div className="insight-list">
                                {data.metrics.hardestQuestions.length > 0 && (
                                    <div className="insight-item error">
                                        <AlertCircle size={20} />
                                        <div>
                                            <strong>Question #{data.allQuestions.findIndex((q:any)=>q.id === data.metrics.hardestQuestions[0].id)+1} is a bottleneck.</strong>
                                            <p>Only {data.metrics.hardestQuestions[0].successRate}% of students got this right. Consider reviewing this topic in class.</p>
                                        </div>
                                    </div>
                                )}
                                {data.metrics.ambiguousQuestions.map((q: any) => (
                                    <div key={q.id} className="insight-item warning">
                                        <HelpCircle size={20} />
                                        <div>
                                            <strong>Ambiguity detected in Question #{data.allQuestions.findIndex((aq:any)=>aq.id === q.id)+1}.</strong>
                                            <p>Responses are split significantly between options. Verify if the question phrasing or options are confusing.</p>
                                        </div>
                                    </div>
                                ))}
                                {data.metrics.overallSuccessRate > 70 && (
                                    <div className="insight-item success">
                                        <CheckCircle2 size={20} />
                                        <div>
                                            <strong>High curriculum alignment.</strong>
                                            <p>Students performed exceptionally well on this assessment overall.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Detailed Question List */}
                        <div className="question-deep-dive">
                            <h2>Full Item Breakdown</h2>
                            {data.allQuestions.map((q: any, i: number) => (
                                <div key={q.id} className="q-analysis-card neo-card">
                                    <div className="q-card-top">
                                        <span className="q-number">Question {i + 1}</span>
                                        <div className="q-tags">
                                            {q.healthTags.map((tag: string) => (
                                                <span key={tag} className={`q-tag ${tag.toLowerCase().replace(' ', '-')}`}>{tag}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <p className="q-text">{q.question}</p>
                                    
                                    <div className="q-stats-grid">
                                        <div className="stat-unit">
                                            <span>Accuracy</span>
                                            <div className="progress-bar-mini">
                                                <div className="progress-fill" style={{ width: `${q.successRate}%`, background: q.successRate < 40 ? '#ef4444' : '#10b981' }}></div>
                                            </div>
                                            <small>{q.successRate}%</small>
                                        </div>
                                        <div className="stat-unit">
                                            <span>Avg. Time</span>
                                            <strong>{q.avgTime}s</strong>
                                        </div>
                                        <div className="stat-unit">
                                            <span>Attempts</span>
                                            <strong>{q.attempts}</strong>
                                        </div>
                                    </div>

                                    <div className="option-distribution">
                                        <h4>Option Selection Distribution</h4>
                                        <div className="dist-bars">
                                            {q.optionDistribution.map((count: number, idx: number) => {
                                                const pct = q.attempts > 0 ? (count / q.attempts) * 100 : 0;
                                                const isCorrect = idx === Number(q.correct_answer);
                                                return (
                                                    <div key={idx} className="dist-bar-row">
                                                        <span className={isCorrect ? 'text-success font-bold' : ''}>{String.fromCharCode(65 + idx)}</span>
                                                        <div className="bar-bg">
                                                            <div 
                                                                className={`bar-fill ${isCorrect ? 'correct' : 'incorrect'}`} 
                                                                style={{ width: `${pct}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="dist-pct">{pct.toFixed(0)}%</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </main>

                <style>{`
                    .item-analysis-page { display: flex; flex-direction: column; gap: 2rem; }
                    .analysis-header { display: flex; align-items: center; gap: 2rem; }
                    .back-btn { display: flex; align-items: center; gap: 0.5rem; background: var(--surface-low); padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.875rem; color: var(--text-secondary); transition: 0.2s; }
                    .back-btn:hover { background: var(--surface-high); color: var(--text-primary); }
                    .analysis-header h1 { font-size: 1.75rem; margin: 0; flex: 1; }
                    .health-badge { display: flex; align-items: center; gap: 0.75rem; background: rgba(16, 185, 129, 0.1); padding: 0.6rem 1.25rem; border-radius: 999px; color: #10b981; font-size: 0.875rem; }
                    
                    .metrics-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
                    .metric-card { display: flex; align-items: center; gap: 1.5rem; padding: 1.75rem; }
                    .metric-card h3 { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); margin: 0 0 0.25rem 0; letter-spacing: 0.05em; }
                    .metric-card p { font-size: 1.5rem; font-weight: 700; margin: 0; }
                    
                    .chart-section { padding: 2.5rem; }
                    .section-title { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; }
                    .section-title h2 { font-size: 1.25rem; margin: 0; }
                    
                    .analysis-feed { display: grid; grid-template-columns: 350px 1fr; gap: 2rem; align-items: start; }
                    .insights-panel { position: sticky; top: 2rem; background: var(--surface-low); padding: 2rem; border-radius: 12px; border: 1px solid var(--border); }
                    .insights-panel h2 { font-size: 1rem; margin-bottom: 1.5rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); }
                    
                    .insight-list { display: flex; flex-direction: column; gap: 1.25rem; }
                    .insight-item { display: flex; gap: 1rem; padding: 1rem; border-radius: 8px; border-left: 4px solid; }
                    .insight-item.error { background: rgba(239, 68, 68, 0.05); border-color: #ef4444; color: #ef4444; }
                    .insight-item.warning { background: rgba(245, 158, 11, 0.05); border-color: #f59e0b; color: #f59e0b; }
                    .insight-item.success { background: rgba(16, 185, 129, 0.05); border-color: #10b981; color: #10b981; }
                    .insight-item strong { display: block; font-size: 0.9375rem; margin-bottom: 0.25rem; }
                    .insight-item p { margin: 0; font-size: 0.8125rem; opacity: 0.8; line-height: 1.5; }
                    
                    .question-deep-dive { display: flex; flex-direction: column; gap: 1.5rem; }
                    .question-deep-dive h2 { font-size: 1.25rem; margin: 0 0 0.5rem 0; }
                    .q-analysis-card { padding: 2.5rem; border: 1px solid var(--border);  }
                    .q-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
                    .q-number { font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); }
                    .q-tags { display: flex; gap: 0.5rem; }
                    .q-tag { font-size: 0.625rem; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
                    .q-tag.ambiguous { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
                    .q-tag.high-difficulty { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
                    .q-tag.concept-mastered { background: rgba(16, 185, 129, 0.1); color: #10b981; }
                    .q-text { font-size: 1.125rem; font-weight: 500; line-height: 1.6; margin-bottom: 2rem; }
                    
                    .q-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; margin-bottom: 2.5rem; padding-bottom: 2.5rem; border-bottom: 1px solid var(--border); }
                    .stat-unit span { font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem; }
                    .stat-unit strong { font-size: 1.25rem; }
                    .progress-bar-mini { width: 100%; height: 6px; background: var(--surface-high); border-radius: 3px; margin: 0.5rem 0; overflow: hidden; }
                    .progress-fill { height: 100%; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
                    
                    .option-distribution h4 { font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1.25rem; font-weight: 700; }
                    .dist-bars { display: flex; flex-direction: column; gap: 1rem; }
                    .dist-bar-row { display: grid; grid-template-columns: 20px 1fr 40px; align-items: center; gap: 1.5rem; font-size: 0.875rem; }
                    .bar-bg { height: 12px; background: var(--surface-low); border-radius: 6px; overflow: hidden; }
                    .bar-fill { height: 100%; transition: 0.5s ease-out; }
                    .bar-fill.correct { background: #10b981; }
                    .bar-fill.incorrect { background: #64748b; opacity: 0.3; }
                    .dist-pct { text-align: right; color: var(--text-muted); font-size: 0.8125rem; font-weight: 700; }
                    
                    @media (max-width: 1024px) {
                        .analysis-feed { grid-template-columns: 1fr; }
                        .insights-panel { position: static; }
                        .metrics-summary { grid-template-columns: 1fr; }
                    }
                `}</style>
            </div>
        </DashboardLayout>
    );
};

export default ExamItemAnalysis;
