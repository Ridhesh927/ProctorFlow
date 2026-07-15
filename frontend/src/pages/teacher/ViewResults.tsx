import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { motion } from 'framer-motion';
import {
    TrendingUp,
    Search,
    ArrowRight,
    Download,
    Filter,
    BarChart3,
    Loader2,
    ShieldAlert,
    AlertTriangle
} from 'lucide-react';
import DashboardLayout from '../../layouts/DashboardLayout';
/*

interface TeacherResultRow {
    id: number;
    exam_id: number;
    score: number;
    total_questions: number;
    correct_answers: number;
    total_marks: number;
    submitted_at: string;
    student_name: string;
    student_email: string;
    exam_title: string;
    passing_marks: number;
    warnings_count: number;
    score_percentage: number;
}

interface ExamTrend {
    exam_id: number;
    title: string;
    attempts: number;
    pass_count: number;
    fail_count: number;
    avg_percentage: number;
    pass_rate: number;
}

interface TopicWeakness {
    topic: string;
    attempts: number;
    correctAttempts: number;
    incorrectAttempts: number;
    accuracy: number;
    weaknessScore: number;
}

interface WarningCorrelation {
    warning_band: string;
    attempts: number;
    avg_percentage: number;
}

interface ClassRemediationSuggestion {
    topic: string;
    attempts: number;
    accuracy: number;
    priority: 'high' | 'medium' | 'low';
    recommendation: string;
}

interface AnalyticsState {
    avgScore: number;
    completionRate: number;
    distinctionRate: number;
    passRate: number;
    examTrends: ExamTrend[];
    topicWeakness: TopicWeakness[];
    warningCorrelation: WarningCorrelation[];
    classRemediationSuggestions: ClassRemediationSuggestion[];
}

type ExportFormat = 'csv' | 'pdf';

const defaultAnalytics: AnalyticsState = {
    avgScore: 0,
    completionRate: 0,
    distinctionRate: 0,
    passRate: 0,
    examTrends: [],
    topicWeakness: [],
    warningCorrelation: [],
    classRemediationSuggestions: []
};

const ViewResults = () => {
    const [results, setResults] = useState<TeacherResultRow[]>([]);
    const [analytics, setAnalytics] = useState<AnalyticsState>(defaultAnalytics);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [exporting, setExporting] = useState<ExportFormat | null>(null);
    const [selectedScript, setSelectedScript] = useState<any>(null);
    const [loadingScript, setLoadingScript] = useState(false);

    useEffect(() => {
        fetchResultsAndAnalytics();
    }, []);

    const fetchResultsAndAnalytics = async () => {
        try {
            setLoading(true);
            setError('');
            const [resultsResponse, analyticsResponse] = await Promise.all([
                apiFetch('/api/exams/teacher/results'),
                apiFetch('/api/exams/teacher/analytics')
            ]);

            const resultsData = await resultsResponse.json();
            const analyticsData = await analyticsResponse.json();

            setResults(Array.isArray(resultsData.results) ? resultsData.results : []);
            setAnalytics({
                avgScore: Number(analyticsData.avgScore || 0),
                completionRate: Number(analyticsData.completionRate || 0),
                distinctionRate: Number(analyticsData.distinctionRate || 0),
                passRate: Number(analyticsData.passRate || 0),
                examTrends: Array.isArray(analyticsData.examTrends) ? analyticsData.examTrends : [],
                topicWeakness: Array.isArray(analyticsData.topicWeakness) ? analyticsData.topicWeakness : [],
                warningCorrelation: Array.isArray(analyticsData.warningCorrelation) ? analyticsData.warningCorrelation : [],
                classRemediationSuggestions: Array.isArray(analyticsData.classRemediationSuggestions)
                    ? analyticsData.classRemediationSuggestions
                    : []
            });
        } catch (fetchError) {
            console.error('Failed to fetch teacher analytics data', fetchError);
            setError('Failed to load analytics. Please refresh and try again.');
        } finally {
            setLoading(false);
        }
    };

    const getStatus = (score: number, total: number) => {
        const percentage = (score / Math.max(total, 1)) * 100;
        if (percentage >= 75) return 'Distinction';
        if (percentage >= 60) return 'Merit';
        if (percentage >= 35) return 'Pass';
        return 'Fail';
    };

    const filteredResults = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return results.filter((result) => {
            const matchesSearch = !query || (
                result.student_name?.toLowerCase().includes(query)
                || result.student_email?.toLowerCase().includes(query)
                || result.exam_title?.toLowerCase().includes(query)
            );
            
            const status = getStatus(result.score, result.total_marks || 1);
            const matchesStatus = statusFilter === 'All' || status === statusFilter;
            
            return matchesSearch && matchesStatus;
        });
    }, [results, searchTerm, statusFilter]);

    const fetchScript = async (resultId: number) => {
        try {
            setLoadingScript(true);
            const res = await apiFetch(`/api/exams/teacher/result/${resultId}/script`);
            const data = await res.json();
            setSelectedScript(data);
        } catch (err) {
            console.error('Failed to fetch script:', err);
            alert('Could not load exam script.');
        } finally {
            setLoadingScript(false);
        }
    };

    const handleExport = async (format: ExportFormat) => {
        try {
            setExporting(format);
            const response = await apiFetch(`/api/exams/teacher/results/export?format=${format}`);
            if (!response.ok) {
                throw new Error('Failed to export results');
            }

            const blob = await response.blob();
            const extension = format === 'csv' ? 'csv' : 'pdf';
            const fileName = `teacher-results-${new Date().toISOString().slice(0, 10)}.${extension}`;
            const downloadUrl = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = downloadUrl;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(downloadUrl);
        } catch (exportError) {
            console.error('Failed to export results', exportError);
            alert('Unable to export report. Please try again.');
        } finally {
            setExporting(null);
        }
    };


    return (
        <DashboardLayout userType="teacher">
            <div className="results-page">
                <header className="page-header">
                    <div className="title-area">
                        <h1>Scholastic Analytics</h1>
                        <p className="text-secondary">Analyze student performance, proctoring signals, and intervention opportunities.</p>
                    </div>
                    <div className="header-actions">
                        <button
                            className="neo-btn-secondary"
                            onClick={() => handleExport('csv')}
                            disabled={!!exporting}
                        >
                            <Download size={18} />
                            {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
                        </button>
                        <button
                            className="neo-btn-primary"
                            onClick={() => handleExport('pdf')}
                            disabled={!!exporting}
                        >
                            {exporting === 'pdf' ? 'Generating...' : 'Generate PDF Report'}
                        </button>
                    </div>
                </header>

                {loading ? (
                    <div className="loading-state neo-card">
                        <Loader2 className="animate-spin text-accent" size={32} />
                        <p>Loading analytics dashboard...</p>
                    </div>
                ) : error ? (
                    <div className="error-state neo-card">
                        <AlertTriangle size={28} />
                        <p>{error}</p>
                    </div>
                ) : (
                    <>
                        <div className="analytics-overview">
                            {[
                                {
                                    label: 'Avg. Class Score',
                                    value: `${analytics.avgScore}%`,
                                    icon: <TrendingUp className="text-accent" />,
                                    trend: `${analytics.passRate}% pass rate`
                                },
                                {
                                    label: 'Completion Rate',
                                    value: `${analytics.completionRate}%`,
                                    icon: <BarChart3 className="text-accent" />,
                                    trend: 'Real exam session data'
                                },
                                {
                                    label: 'Distinction Rate',
                                    value: `${analytics.distinctionRate}%`,
                                    icon: <TrendingUp className="text-accent" />,
                                    trend: `${results.length} evaluated attempts`
                                }
                            ].map((stat, i) => (
                                <motion.div
                                    key={stat.label}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.08 }}
                                    className="stat-card neo-card"
                                >
                                    <div className="stat-icon">{stat.icon}</div>
                                    <div className="stat-info">
                                        <span className="stat-label">{stat.label}</span>
                                        <div className="stat-value-group">
                                            <span className="stat-value">{stat.value}</span>
                                            <span className="stat-trend">{stat.trend}</span>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>

                        <div className="analytics-insights-grid">
                            <section className="neo-card insight-card">
                                <h3><BarChart3 size={18} /> Pass / Fail Trend by Exam</h3>
                                {analytics.examTrends.length === 0 ? (
                                    <p className="empty-copy">No pass/fail trend data available yet.</p>
                                ) : (
                                    <div className="trend-list">
                                        {analytics.examTrends.map((trend) => {
                                            const passRate = Math.max(0, Math.min(100, Number(trend.pass_rate || 0)));
                                            const failRate = Math.max(0, 100 - passRate);
                                            return (
                                                <div className="trend-row" key={trend.exam_id}>
                                                    <div className="trend-head">
                                                        <span>{trend.title}</span>
                                                        <small>{trend.attempts} attempts</small>
                                                    </div>
                                                    <div className="trend-bar">
                                                        <div className="trend-pass" style={{ width: `${passRate}%` }} />
                                                        <div className="trend-fail" style={{ width: `${failRate}%` }} />
                                                    </div>
                                                    <div className="trend-meta">
                                                        <span>Pass {trend.pass_count}</span>
                                                        <span>Fail {trend.fail_count}</span>
                                                        <span>{passRate}% pass</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>

                            <section className="neo-card insight-card">
                                <h3><ShieldAlert size={18} /> Warning vs Score Correlation</h3>
                                {analytics.warningCorrelation.length === 0 ? (
                                    <p className="empty-copy">No warning correlation data available yet.</p>
                                ) : (
                                    <div className="correlation-grid">
                                        {analytics.warningCorrelation.map((band) => (
                                            <div key={band.warning_band} className="correlation-item">
                                                <span className="band-label">{band.warning_band}</span>
                                                <strong>{Math.round(Number(band.avg_percentage || 0))}%</strong>
                                                <small>{band.attempts} attempts</small>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className="neo-card insight-card full-width">
                                <h3><TrendingUp size={18} /> Topic-wise Weakness Analysis</h3>
                                {analytics.topicWeakness.length === 0 ? (
                                    <p className="empty-copy">No topic weakness data available yet.</p>
                                ) : (
                                    <div className="weakness-grid">
                                        {analytics.topicWeakness.slice(0, 8).map((topic) => (
                                            <div key={topic.topic} className="weakness-item">
                                                <div className="weakness-head">
                                                    <span>{topic.topic}</span>
                                                    <strong>{Math.round(topic.accuracy)}% accuracy</strong>
                                                </div>
                                                <div className="weakness-bar">
                                                    <div className="weakness-bar-fill" style={{ width: `${Math.max(0, Math.min(100, topic.accuracy))}%` }} />
                                                </div>
                                                <div className="weakness-meta">
                                                    <small>{topic.attempts} attempts</small>
                                                    <small>{topic.incorrectAttempts} incorrect</small>
                                                    <small>Weakness {Math.round(topic.weaknessScore)}</small>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className="neo-card insight-card full-width">
                                <h3><AlertTriangle size={18} /> Class Remediation Suggestions</h3>
                                {analytics.classRemediationSuggestions.length === 0 ? (
                                    <p className="empty-copy">No remediation suggestions generated yet.</p>
                                ) : (
                                    <div className="remediation-list">
                                        {analytics.classRemediationSuggestions.map((suggestion) => (
                                            <div className="remediation-item" key={`${suggestion.topic}-${suggestion.priority}`}>
                                                <div className="remediation-head">
                                                    <span>{suggestion.topic}</span>
                                                    <span className={`priority-badge ${suggestion.priority}`}>{suggestion.priority} priority</span>
                                                </div>
                                                <p>{suggestion.recommendation}</p>
                                                <small>{suggestion.attempts} attempts · {Math.round(suggestion.accuracy)}% class accuracy</small>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </div>

                        <div className="results-explorer neo-card">
                            <div className="explorer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                                <div className="search-box">
                                    <Search size={18} />
                                    <input
                                        type="text"
                                        placeholder="Search by student, email, or exam..."
                                        value={searchTerm}
                                        onChange={(event) => setSearchTerm(event.target.value)}
                                    />
                                </div>
                                <div className="filter-select" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <Filter size={18} className="text-muted" />
                                    <select 
                                        className="neo-input" 
                                        style={{ width: 'auto', padding: '0.4rem 1rem' }}
                                        value={statusFilter}
                                        onChange={(e) => setStatusFilter(e.target.value)}
                                    >
                                        <option value="All">All Status</option>
                                        <option value="Distinction">Distinction</option>
                                        <option value="Merit">Merit</option>
                                        <option value="Pass">Pass</option>
                                        <option value="Fail">Fail</option>
                                    </select>
                                </div>
                            </div>

                            <div className="table-responsive">
                                {filteredResults.length === 0 ? (
                                    <div className="empty-state">
                                        <p>No results found for the current filters.</p>
                                    </div>
                                ) : (
                                    <table className="results-table">
                                        <thead>
                                            <tr>
                                                <th>Scholar Identity</th>
                                                <th>Assessment Module</th>
                                                <th>Result Percentage</th>
                                                <th>Status Mapping</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredResults.map((res) => {
                                                const percentage = Math.round((res.score / (res.total_marks || 1)) * 100);
                                                const status = getStatus(res.score, res.total_marks || 1);

                                                return (
                                                    <tr key={res.id}>
                                                        <td>
                                                            <div className="student-profile">
                                                                <div className="avatar-small">{res.student_name.charAt(0).toUpperCase()}</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                    <span>{res.student_name}</span>
                                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{res.student_email}</span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td>{res.exam_title}</td>
                                                        <td className="score-cell">
                                                            <div className="score-bar-bg">
                                                                <div className="score-bar-fill" style={{ width: `${percentage}%` }}></div>
                                                            </div>
                                                            <span>{percentage}%</span>
                                                        </td>
                                                        <td>
                                                            <span className={`status-tag ${status.toLowerCase()}`}>{status}</span>
                                                        </td>
                                                        <td>
                                                            <button 
                                                                className="icon-btn-text"
                                                                onClick={() => fetchScript(res.id)}
                                                                disabled={loadingScript}
                                                            >
                                                                {loadingScript ? 'Opening...' : 'View Scripts'}
                                                                <ArrowRight size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {selectedScript && (
                    <div className="modal-overlay" onClick={() => setSelectedScript(null)}>
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="modal-container" 
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <div>
                                    <h2>{selectedScript.result.exam_title} - Script</h2>
                                    <p className="text-muted">{selectedScript.result.username} ({selectedScript.result.email})</p>
                                </div>
                                <button className="close-btn" onClick={() => setSelectedScript(null)}>&times;</button>
                            </div>
                            <div className="modal-body script-body">
                                <div className="script-stats">
                                    <div className="stat-min">
                                        <span>Score</span>
                                        <strong>{selectedScript.result.score}/{selectedScript.result.total_marks}</strong>
                                    </div>
                                    <div className="stat-min">
                                        <span>Percentage</span>
                                        <strong>{Math.round((selectedScript.result.score / selectedScript.result.total_marks) * 100)}%</strong>
                                    </div>
                                    <div className="stat-min">
                                        <span>Accuracy</span>
                                        <strong>{selectedScript.result.correct_answers}/{selectedScript.result.total_questions} Qs</strong>
                                    </div>
                                </div>

                                <div className="questions-review">
                                    {selectedScript.questions.map((q: any, idx: number) => (
                                        <div key={q.question_id} className={`question-review-card ${q.is_correct ? 'correct' : 'incorrect'} ${q.selected_option === null ? 'skipped' : ''}`}>
                                            <div className="q-review-header">
                                                <span className="q-num">Q{idx + 1}</span>
                                                <span className="q-topic">{q.topic}</span>
                                                <span className="q-marks">{q.marks} pt</span>
                                            </div>
                                            <p className="q-text">{q.question}</p>
                                            <div className="options-review">
                                                {q.options.map((opt: string, optIdx: number) => {
                                                    let className = "opt-review";
                                                    if (optIdx === q.correct_answer) className += " correct-opt";
                                                    if (optIdx === q.selected_option && !q.is_correct) className += " wrong-opt";
                                                    
                                                    return (
                                                        <div key={optIdx} className={className}>
                                                            <div className="opt-indicator"></div>
                                                            <span>{opt}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="q-review-footer">
                                                {q.selected_option === null ? (
                                                    <span className="badge skipped">Skipped</span>
                                                ) : q.is_correct ? (
                                                    <span className="badge correct">Correct</span>
                                                ) : (
                                                    <span className="badge incorrect">Incorrect</span>
                                                )}
                                                <span className="time-spent">Time Spent: {q.time_spent || 0}s</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                <style>{`
          .results-page { display: flex; flex-direction: column; gap: 2rem; }
          .page-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
          .page-header h1 { font-size: 2.4rem; margin-bottom: 0.35rem; }
          .header-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
          
          .analytics-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
          .stat-card { padding: 1.25rem; display: flex; align-items: center; gap: 1rem; }
          .stat-icon { width: 42px; height: 42px; background: var(--surface-high); display: flex; align-items: center; justify-content: center; border-radius: 10px; }
          .stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
          .stat-value-group { display: flex; flex-direction: column; gap: 0.1rem; margin-top: 0.25rem; }
          .stat-value { font-size: 1.4rem; font-weight: 700; font-family: var(--font-display); }
          .stat-trend { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; }
          
          .analytics-insights-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1rem;
          }
          .insight-card { padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
          .insight-card.full-width { grid-column: 1 / -1; }
          .insight-card h3 { margin: 0; display: flex; align-items: center; gap: 0.55rem; font-size: 1rem; }
          .empty-copy { margin: 0; color: var(--text-muted); font-size: 0.9rem; }

          .trend-list { display: flex; flex-direction: column; gap: 0.9rem; }
          .trend-row { display: flex; flex-direction: column; gap: 0.45rem; padding: 0.7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
          .trend-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; font-size: 0.9rem; }
          .trend-head small { color: var(--text-muted); }
          .trend-bar { height: 8px; background: var(--surface-high); border-radius: 999px; overflow: hidden; display: flex; }
          .trend-pass { background: #10b981; height: 100%; }
          .trend-fail { background: #ef4444; height: 100%; }
          .trend-meta { display: flex; justify-content: space-between; gap: 0.75rem; color: var(--text-muted); font-size: 0.75rem; }

          .correlation-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.8rem; }
          .correlation-item { padding: 0.9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 0.25rem; }
          .band-label { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em; }
          .correlation-item strong { font-size: 1.2rem; }
          .correlation-item small { color: var(--text-muted); font-size: 0.72rem; }

          .weakness-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.8rem; }
          .weakness-item { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
          .weakness-head { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.82rem; }
          .weakness-bar { height: 7px; border-radius: 999px; background: var(--surface-high); overflow: hidden; }
          .weakness-bar-fill { height: 100%; background: linear-gradient(90deg, #ef4444, #f59e0b, #10b981); }
          .weakness-meta { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 0.7rem; gap: 0.4rem; flex-wrap: wrap; }

          .remediation-list { display: flex; flex-direction: column; gap: 0.8rem; }
          .remediation-item { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
          .remediation-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
          .remediation-head span:first-child { font-weight: 700; }
          .priority-badge { font-size: 0.68rem; text-transform: uppercase; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 999px; letter-spacing: 0.05em; }
          .priority-badge.high { background: rgba(239,68,68,0.15); color: #ef4444; }
          .priority-badge.medium { background: rgba(249,115,22,0.15); color: #f59e0b; }
          .priority-badge.low { background: rgba(16,185,129,0.15); color: #10b981; }
          .remediation-item p { margin: 0; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.45; }
          .remediation-item small { color: var(--text-muted); font-size: 0.73rem; }
          
          .results-explorer { padding: 0; overflow: hidden; }
          .explorer-header { padding: 1.2rem 1.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
          .search-box { display: flex; align-items: center; gap: 0.9rem; color: var(--text-muted); flex: 1; min-width: 240px; max-width: 460px; }
          .search-box input { background: none; color: var(--text-primary); width: 100%; border: none; outline: none; }
          
          .results-table { width: 100%; border-collapse: collapse; }
          .results-table th { text-align: left; padding: 1rem 1.5rem; background: var(--surface-low); font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
          .results-table td { padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); font-size: 0.92rem; }
          
          .student-profile { display: flex; align-items: center; gap: 0.8rem; }
          .avatar-small { width: 30px; height: 30px; background: var(--surface-high); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--accent); }
          
          .score-cell { display: flex; align-items: center; gap: 0.8rem; }
          .score-bar-bg { flex: 1; max-width: 100px; height: 6px; background: var(--surface-high); border-radius: 3px; overflow: hidden; }
          .score-bar-fill { height: 100%; background: var(--accent); }
          
          .status-tag { padding: 0.25rem 0.7rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
          .status-tag.distinction { background: rgba(16, 185, 129, 0.1); color: #10b981; }
          .status-tag.merit { background: rgba(96, 165, 250, 0.1); color: #60a5fa; }
          .status-tag.pass { background: rgba(107, 114, 128, 0.1); color: #6b7280; }
          .status-tag.fail { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
          
          .icon-btn-text { background: none; color: var(--accent); font-size: 0.81rem; font-weight: 600; display: flex; align-items: center; gap: 0.45rem; transition: var(--transition-fast); }
          .icon-btn-text:hover { gap: 0.65rem; }
           
          .loading-state, .empty-state, .error-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem 1.5rem; color: var(--text-muted); gap: 0.9rem; text-align: center; }
          .error-state { color: #ef4444; }

          @media (max-width: 980px) {
            .analytics-insights-grid { grid-template-columns: 1fr; }
            .insight-card.full-width { grid-column: auto; }
          }

          .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem; }
          .modal-container { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; max-width: 900px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
          .modal-header { padding: 1.5rem 2rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start; }
          .modal-header h2 { margin: 0; font-size: 1.5rem; }
          .close-btn { background: none; border: none; font-size: 2rem; color: var(--text-muted); cursor: pointer; }
          .modal-body { padding: 2rem; overflow-y: auto; flex: 1; }
          
          .script-stats { display: flex; gap: 2rem; margin-bottom: 2rem; background: var(--surface-low); padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--border); }
          .stat-min { display: flex; flex-direction: column; gap: 0.25rem; }
          .stat-min span { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; }
          .stat-min strong { font-size: 1.25rem; font-family: var(--font-display); }

          .questions-review { display: flex; flex-direction: column; gap: 1.5rem; }
          .question-review-card { border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.5rem; border-left: 4px solid var(--border); }
          .question-review-card.correct { border-left-color: #10b981; background: rgba(16, 185, 129, 0.02); }
          .question-review-card.incorrect { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.02); }
          .question-review-card.skipped { border-left-color: #6b7280; }

          .q-review-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; font-size: 0.82rem; }
          .q-num { font-weight: 700; color: var(--accent); }
          .q-topic { padding: 0.2rem 0.6rem; background: var(--surface-high); border-radius: 4px; color: var(--text-secondary); }
          .q-marks { margin-left: auto; font-weight: 600; }
          .q-text { font-size: 1.1rem; font-weight: 500; margin-bottom: 1.5rem; }

          .options-review { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1.5rem; }
          .opt-review { padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm); display: flex; align-items: center; gap: 1rem; font-size: 0.9rem; }
          .opt-indicator { width: 12px; height: 12px; border: 2px solid var(--border); border-radius: 50%; flex-shrink: 0; }
          .correct-opt { border-color: #10b981; background: rgba(16, 185, 129, 0.1); color: #10b981; }
          .correct-opt .opt-indicator { border-color: #10b981; background: #10b981; }
          .wrong-opt { border-color: #ef4444; background: rgba(239, 68, 68, 0.1); color: #ef4444; }
          .wrong-opt .opt-indicator { border-color: #ef4444; background: #ef4444; }
          
          .q-review-footer { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 1rem; }
          .badge { padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
          .badge.correct { background: #10b981; color: white; }
          .badge.incorrect { background: #ef4444; color: white; }
          .badge.skipped { background: #6b7280; color: white; }
          .time-spent { font-size: 0.75rem; color: var(--text-muted); }

          @media (max-width: 768px) {
            .options-review { grid-template-columns: 1fr; }
            .script-stats { flex-direction: column; gap: 1rem; }
          }
        `}</style>
            </div>
        </DashboardLayout>
    );
};

export default ViewResults;

*/

const ViewResults = () => {
    return (
        <DashboardLayout userType="teacher">
            <div className="results-page" style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center', 
                minHeight: '70vh', 
                textAlign: 'center',
                padding: '2rem'
            }}>
                <div className="neo-card" style={{ 
                    padding: '4rem 2rem', 
                    maxWidth: '500px', 
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}>
                    <BarChart3 size={48} className="text-accent" style={{ marginBottom: '1.5rem', opacity: 0.8 }} />
                    <h2 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>Coming Soon</h2>
                    <p className="text-muted" style={{ lineHeight: '1.6', fontSize: '1.1rem' }}>
                        We are currently working on the advanced data analysis and script viewing dashboard. 
                        This feature will be back soon!
                    </p>
                </div>
            </div>
        </DashboardLayout>
    );
};

export default ViewResults;
