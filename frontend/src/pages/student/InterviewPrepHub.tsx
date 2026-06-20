import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, Loader2, Sparkles, CheckCircle, Clock, BarChart3, ArrowRight, Code2 } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { getToken } from '../../utils/auth';
import './InterviewPrepHub.css';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../layouts/DashboardLayout';

interface InterviewPrepHubProps {
    standalone?: boolean;
}

const MIN_QUESTION_COUNT = 10;
const MAX_QUESTION_COUNT = 25;

interface Interview {
    id: number;
    job_role_target: string;
    total_score: number;
    ai_feedback: string | null;
    created_at: string;
}

const InterviewPrepHub = ({ standalone = false }: InterviewPrepHubProps) => {
    const navigate = useNavigate();
    const [interviews, setInterviews] = useState<Interview[]>([]);
    const [hasResume, setHasResume] = useState(false);
    const [parsedSkills, setParsedSkills] = useState<string[]>([]);
    const [suggestedRoles, setSuggestedRoles] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Upload State

    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Generation State
    const [targetRole, setTargetRole] = useState('');
    const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
    const [questionCount, setQuestionCount] = useState<number>(10);
    const [questionCountInput, setQuestionCountInput] = useState<string>('10');
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState<'practice' | 'history' | 'analytics'>('practice');
    const [activePracticeTab, setActivePracticeTab] = useState<'resume' | 'interview' | 'coding'>('resume');
    const [expandedInterview, setExpandedInterview] = useState<number | null>(null);

    // Coding Round State
    const [includeHard, setIncludeHard] = useState(false);
    const [isStartingCoding, setIsStartingCoding] = useState(false);
    const [companyLibrary, setCompanyLibrary] = useState<string[]>(['General']);
    const [selectedCompany, setSelectedCompany] = useState('General');
    const [codingRoundType, setCodingRoundType] = useState<'coding' | 'aptitude' | 'mixed'>('coding');

    useEffect(() => {
        fetchDashboardData();
    }, []);

    useEffect(() => {
        const fetchCompanies = async () => {
            try {
                const response = await apiFetch('/api/coding/companies');
                const data = await response.json();
                if (response.ok && Array.isArray(data.companies) && data.companies.length) {
                    setCompanyLibrary(data.companies);
                }
            } catch (error) {
                console.error('Failed to load company library', error);
            }
        };

        fetchCompanies();
    }, []);

    // Re-fetch when switching to History or Analytics tab so new sessions always appear
    useEffect(() => {
        if (activeTab === 'history' || activeTab === 'analytics') {
            fetchDashboardData();
        }
    }, [activeTab]);

    const fetchDashboardData = async () => {
        setIsLoading(true);
        try {
            const response = await apiFetch('/api/interview/history', {
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });
            const data = await response.json();
            
            // Filter out in-progress (unsubmitted) interviews
            const completedInterviews = (data.interviews || []).filter((i: any) => i.ai_feedback !== null);
            setInterviews(completedInterviews);
            
            setHasResume(data.hasResume);
            setParsedSkills(data.parsedSkills || []);
            setSuggestedRoles(data.suggestedRoles || []);
        } catch (error) {
            console.error("Failed to load interview history", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
            
            if (!validTypes.includes(file.type)) {
                setUploadError('Invalid file type. Please upload a PDF or Image (JPG/PNG).');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                setUploadError('File too large. Max size is 5MB.');
                return;
            }
            
            setUploadError('');
            await uploadResume(file);
        }
    };

    const uploadResume = async (file: File) => {
        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const token = getToken();
            const response = await fetch('http://localhost:5000/api/interview/upload-resume', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Upload failed');

            setHasResume(true);
            setParsedSkills(data.skills || []);
            setSuggestedRoles(data.roles || []);
        } catch (error: any) {
            setUploadError(error.message);
        } finally {
            setIsUploading(false);
        }
    };

    const clampQuestionCount = (value: number) => Math.min(MAX_QUESTION_COUNT, Math.max(MIN_QUESTION_COUNT, value));

    const syncQuestionCount = (value: number) => {
        const normalized = clampQuestionCount(value);
        setQuestionCount(normalized);
        setQuestionCountInput(String(normalized));
    };

    const commitQuestionCountInput = () => {
        const parsed = parseInt(questionCountInput, 10);
        if (Number.isNaN(parsed)) {
            setQuestionCountInput(String(questionCount));
            return;
        }
        syncQuestionCount(parsed);
    };

    const handleGenerate = async () => {
        if (!targetRole.trim() || !hasResume) return;

        commitQuestionCountInput();
        const finalQuestionCount = clampQuestionCount(parseInt(questionCountInput, 10) || questionCount);
        
        setIsGenerating(true);
        try {
            const response = await apiFetch('/api/interview/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobRoleTarget: targetRole, difficulty, questionCount: finalQuestionCount })
            });
            const data = await response.json();
            
            // Navigate directly to the new interview, or refresh list
            if (data.interviewId) {
                 navigate(`/student/interview/${data.interviewId}`);
            } else {
                fetchDashboardData();
            }
        } catch (error: any) {
            alert(error.message || 'Failed to generate interview.');
        } finally {
            setIsGenerating(false);
            setTargetRole('');
        }
    };

    if (isLoading) {
        return <div className="loading-state"><Loader2 className="animate-spin" size={32} /></div>;
    }

    const personalizationHighlights = parsedSkills.slice(0, 4);

    const content = (
        <motion.div 
            className="interview-hub-container"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <div className="hub-header">
                <h1>Interview Preparation Hub</h1>
                <p>Master your interview skills with AI-powered personalized sessions.</p>
            </div>

            <div className="hub-tabs">
                <button 
                    className={`hub-tab ${activeTab === 'practice' ? 'active' : ''}`}
                    onClick={() => setActiveTab('practice')}
                >
                    <Sparkles size={18} /> Practice
                </button>
                <button 
                    className={`hub-tab ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                >
                    <Clock size={18} /> History
                </button>
                <button 
                    className={`hub-tab ${activeTab === 'analytics' ? 'active' : ''}`}
                    onClick={() => setActiveTab('analytics')}
                >
                    <BarChart3 size={18} /> Insights
                </button>
            </div>

            <div className="hub-content-area">
                {activeTab === 'practice' && (
                    <div className="practice-view-grid animate-fade-in">
                        <div className="hub-sidebar">
                            <div className="practice-sub-tabs">
                                <button 
                                    className={`sub-tab ${activePracticeTab === 'resume' ? 'active' : ''}`}
                                    onClick={() => setActivePracticeTab('resume')}
                                >
                                    Resume Profile
                                </button>
                                {hasResume && (
                                    <>
                                        <button 
                                            className={`sub-tab ${activePracticeTab === 'interview' ? 'active' : ''}`}
                                            onClick={() => setActivePracticeTab('interview')}
                                        >
                                            Mock Interview
                                        </button>
                                        <button 
                                            className={`sub-tab ${activePracticeTab === 'coding' ? 'active' : ''}`}
                                            onClick={() => setActivePracticeTab('coding')}
                                        >
                                            Coding Round
                                        </button>
                                    </>
                                )}
                            </div>

                            {activePracticeTab === 'resume' && (
                                <div className="card profile-card animate-fade-in">
                                    <h3>Your Resume Profile</h3>
                                    
                                    {hasResume ? (
                                        <div className="resume-active">
                                            <div className="status-badge success">
                                                <CheckCircle size={16} /> Resume Processed
                                            </div>
                                            
                                            {parsedSkills.length > 0 && (
                                                <div className="skills-container">
                                                    <h4>Detected Skills:</h4>
                                                    <div className="skills-tags">
                                                        {parsedSkills.map((skill, i) => (
                                                            <span key={i} className="skill-tag">{skill}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {suggestedRoles.length > 0 && (
                                                <div className="skills-container mt-4">
                                                    <h4>Suggested Career Paths:</h4>
                                                    <div className="skills-tags">
                                                        {suggestedRoles.map((role, i) => (
                                                            <span key={i} className="skill-tag role-tag">{role}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            <button 
                                                className="neo-btn-secondary text-sm mt-4"
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={isUploading}
                                            >
                                                {isUploading ? <Loader2 className="animate-spin" size={16} /> : 'Update Resume'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="resume-upload">
                                            <p>Upload your resume to enable Personalized Mode (resume + target role). The generated MCQs will adapt to your profile and role expectations.</p>
                                            <div 
                                                className="upload-zone"
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                {isUploading ? (
                                                    <Loader2 className="animate-spin" size={32} />
                                                ) : (
                                                    <>
                                                        <Upload size={32} />
                                                        <span>Click to upload PDF/Image</span>
                                                    </>
                                                )}
                                            </div>
                                            {uploadError && <p className="error-text">{uploadError}</p>}
                                        </div>
                                    )}

                                    <input 
                                        type="file" 
                                        ref={fileInputRef} 
                                        onChange={handleFileChange} 
                                        accept=".pdf,image/*" 
                                        style={{ display: 'none' }}
                                    />
                                </div>
                            )}

                            {activePracticeTab === 'interview' && hasResume && (
                                <div className="card generate-card animate-fade-in">
                                    <h3>Start New Mock Interview</h3>
                                    <div className="personalized-badge">
                                        <Sparkles size={14} /> Personalized Mode: Resume + Target Role
                                    </div>
                                    <p className="personalized-note">
                                        We use your resume to calibrate depth and skill coverage, then generate role-focused questions for <strong>{targetRole || 'your chosen role'}</strong>.
                                    </p>
                                    {personalizationHighlights.length > 0 && (
                                        <div className="personalized-skills">
                                            <span>Resume signals used:</span>
                                            <div className="skills-tags">
                                                {personalizationHighlights.map((skill, i) => (
                                                    <span key={i} className="skill-tag">{skill}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div className="form-group">
                                        <label>Target Job Role</label>
                                        <input 
                                            type="text" 
                                            className="neo-input"
                                            placeholder="e.g. Full Stack Developer"
                                            value={targetRole}
                                            onChange={(e) => setTargetRole(e.target.value)}
                                            disabled={isGenerating}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Difficulty Level</label>
                                        <div className="difficulty-selector">
                                            {(['easy', 'medium', 'hard'] as const).map(level => (
                                                <button
                                                    type="button"
                                                    key={level}
                                                    className={`diff-btn diff-btn--${level} ${difficulty === level ? 'active' : ''}`}
                                                    onClick={() => setDifficulty(level)}
                                                    disabled={isGenerating}
                                                >
                                                    {level === 'easy' && '🟢'}
                                                    {level === 'medium' && '🟡'}
                                                    {level === 'hard' && '🔴'}
                                                    {level.charAt(0).toUpperCase() + level.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Number of Questions (10 to 25)</label>
                                        <div className="question-count-control">
                                            <div className="question-count-top-row">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    className="neo-input question-count-text-input"
                                                    value={questionCountInput}
                                                    onChange={(e) => {
                                                        const raw = e.target.value.replace(/\s+/g, '');
                                                        if (raw === '') {
                                                            setQuestionCountInput('');
                                                            return;
                                                        }

                                                        if (!/^\d+$/.test(raw)) return;

                                                        setQuestionCountInput(raw);
                                                        const parsed = parseInt(raw, 10);
                                                        if (!Number.isNaN(parsed)) {
                                                            setQuestionCount(clampQuestionCount(parsed));
                                                        }
                                                    }}
                                                    onBlur={commitQuestionCountInput}
                                                    disabled={isGenerating}
                                                    aria-label="Question count"
                                                />
                                                <span className="question-count-current">Selected: {questionCount}</span>
                                            </div>

                                            <input
                                                type="range"
                                                min={MIN_QUESTION_COUNT}
                                                max={MAX_QUESTION_COUNT}
                                                step={1}
                                                value={questionCount}
                                                onChange={(e) => syncQuestionCount(parseInt(e.target.value, 10))}
                                                className="question-count-range"
                                                disabled={isGenerating}
                                                aria-label="Question count slider"
                                            />

                                            <div className="question-count-hints">
                                                <span>{MIN_QUESTION_COUNT}</span>
                                                <span>{MAX_QUESTION_COUNT}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button 
                                        className="neo-btn-primary full-width mt-4"
                                        onClick={handleGenerate}
                                        disabled={isGenerating || !targetRole.trim()}
                                    >
                                        {isGenerating ? (
                                            <><Loader2 className="animate-spin" size={18} /> Building your {difficulty} {questionCount}-question interview...</>
                                        ) : (
                                            <><Sparkles size={18} /> Generate {questionCount}-Question Session</>
                                        )}
                                    </button>
                                </div>
                            )}

                            {activePracticeTab === 'coding' && hasResume && (
                                <div className="card generate-card coding-round-card animate-fade-in">
                                    <div className="coding-card-header">
                                        <Code2 size={20} className="text-accent" />
                                        <h3>DSA Coding Round</h3>
                                    </div>
                                    <p className="coding-card-desc">Practice company-focused questions (coding or aptitude-style) inspired by real online assessments.</p>
                                    <div className="form-group mt-3">
                                        <label>Target Company Pattern</label>
                                        <select
                                            className="neo-input"
                                            value={selectedCompany}
                                            onChange={(e) => setSelectedCompany(e.target.value)}
                                            disabled={isStartingCoding}
                                        >
                                            {companyLibrary.map((company) => (
                                                <option key={company} value={company}>{company}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Round Focus</label>
                                        <div className="difficulty-selector">
                                            <button
                                                type="button"
                                                className={`diff-btn round-focus-btn ${codingRoundType === 'coding' ? 'active' : ''}`}
                                                onClick={() => setCodingRoundType('coding')}
                                                aria-pressed={codingRoundType === 'coding'}
                                                disabled={isStartingCoding}
                                            >
                                                Coding
                                            </button>
                                            <button
                                                type="button"
                                                className={`diff-btn round-focus-btn ${codingRoundType === 'aptitude' ? 'active' : ''}`}
                                                onClick={() => setCodingRoundType('aptitude')}
                                                aria-pressed={codingRoundType === 'aptitude'}
                                                disabled={isStartingCoding}
                                            >
                                                Aptitude Style
                                            </button>
                                            <button
                                                type="button"
                                                className={`diff-btn round-focus-btn ${codingRoundType === 'mixed' ? 'active' : ''}`}
                                                onClick={() => setCodingRoundType('mixed')}
                                                aria-pressed={codingRoundType === 'mixed'}
                                                disabled={isStartingCoding}
                                            >
                                                Mixed
                                            </button>
                                        </div>
                                    </div>
                                    <div className="include-hard-toggle">
                                        <input
                                            type="checkbox"
                                            id="includeHard"
                                            checked={includeHard}
                                            onChange={e => setIncludeHard(e.target.checked)}
                                            disabled={isStartingCoding}
                                        />
                                        <label htmlFor="includeHard">
                                            <span className="toggle-title">Include Hard Question</span>
                                            <span className="toggle-sub">{includeHard ? '1 Medium + 1 Hard 🔴' : 'Default: 1 Easy + 1 Medium 🟡'}</span>
                                        </label>
                                    </div>
                                    <button
                                        className="neo-btn-primary full-width mt-4"
                                        onClick={async () => {
                                            setIsStartingCoding(true);
                                            try {
                                                const res = await apiFetch('/api/coding/generate', {
                                                    method: 'POST',
                                                    body: JSON.stringify({
                                                        includeHard,
                                                        company: selectedCompany,
                                                        roundType: codingRoundType,
                                                    }),
                                                });
                                                const data = await res.json();
                                                if (!res.ok) throw new Error(data.message);
                                                navigate(`/student/coding/${data.codingId}`);
                                            } catch (e: any) {
                                                alert(e.message || 'Failed to start coding round.');
                                            } finally {
                                                setIsStartingCoding(false);
                                            }
                                        }}
                                        disabled={isStartingCoding}
                                    >
                                        {isStartingCoding ? (
                                            <><Loader2 size={18} className="animate-spin" /> Generating problems...</>
                                        ) : (
                                            <><Code2 size={18} /> Start Coding Round</>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="practice-info-panel card glass-card">
                            <h3>Preparation Insights</h3>
                            <div className="info-content">
                                <p>Welcome back! Our AI has analyzed your profile and detected <strong>{parsedSkills.length} core technical skills</strong>.</p>
                                <div className="tip-box">
                                    <Sparkles size={20} className="text-accent" />
                                    <div>
                                        <strong>Pro Tip:</strong>
                                        <p>Tailor your "Target Job Role" to the specific position you're applying for. Personalized Mode blends role expectations with resume evidence, then generates a balanced set of 10 to 25 custom questions across DSA, Logical, Verbal, and Technical sections.</p>
                                    </div>
                                </div>
                                <div className="session-summary mt-8">
                                    <h4>Your Last Session</h4>
                                    {interviews.length > 0 ? (
                                        <div className="mini-stat">
                                            <span>{interviews[0].job_role_target}</span>
                                            {interviews[0].ai_feedback ? (
                                                <span className="text-accent font-bold">{interviews[0].total_score}%</span>
                                            ) : (
                                                <span className="font-bold" style={{ color: '#eab308' }}>In Progress</span>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-muted italic">No sessions yet. Upload your CV to start!</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'history' && (
                    <div className="history-view animate-fade-in">
                        <div className="history-header">
                            <h2>Session History</h2>
                            <p>Review your past performances and AI feedback.</p>
                        </div>

                        {interviews.length === 0 ? (
                            <div className="empty-history card">
                                <Clock size={48} />
                                <p>No interview sessions found.</p>
                                <button className="neo-btn-primary mt-4" onClick={() => setActiveTab('practice')}>Start Your First Session</button>
                            </div>
                        ) : (
                            <div className="history-list">
                                {interviews.map(interview => (
                                    <div key={interview.id} className={`history-card card ${expandedInterview === interview.id ? 'expanded' : ''}`}>
                                        <div className="card-header" onClick={() => setExpandedInterview(expandedInterview === interview.id ? null : interview.id)}>
                                            <div className="interview-info">
                                                <div className="role-title">
                                                    <h4>{interview.job_role_target}</h4>
                                                    <span className="date">{new Date(interview.created_at).toLocaleDateString()}</span>
                                                </div>
                                                {interview.ai_feedback ? (
                                                    <div className={`score-stat ${interview.total_score >= 70 ? 'good' : 'warning'}`}>
                                                        <span className="score">{interview.total_score}%</span>
                                                        <span className="label">Score</span>
                                                    </div>
                                                ) : (
                                                    <div className="score-stat" style={{ color: '#eab308', borderColor: '#eab308' }}>
                                                        <span className="score" style={{ fontSize: '0.75rem' }}>In Progress</span>
                                                        <span className="label">Resume</span>
                                                    </div>
                                                )}
                                            </div>
                                            <button className="expand-toggle">
                                                {expandedInterview === interview.id ? '-' : '+'}
                                            </button>
                                        </div>

                                        {expandedInterview === interview.id && (
                                            <motion.div 
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                className="expanded-content"
                                            >
                                                <div className="feedback-preview">
                                                    <h5>AI Feedback Summary</h5>
                                                    <p>{interview.ai_feedback || "No feedback generated yet."}</p>
                                                </div>
                                                <div className="actions mt-4">
                                                    {interview.ai_feedback ? (
                                                        <button 
                                                            className="neo-btn-primary text-sm"
                                                            onClick={() => navigate(`/student/interview/result/${interview.id}`)}
                                                        >
                                                            View Full Performance Breakdown <ArrowRight size={16} />
                                                        </button>
                                                    ) : (
                                                        <button 
                                                            className="neo-btn-primary text-sm"
                                                            onClick={() => navigate(`/student/interview/${interview.id}`)}
                                                        >
                                                            Continue Session <ArrowRight size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <div className="analytics-view animate-fade-in card glass-card">
                        <div className="analytics-header">
                            <BarChart3 size={32} className="text-accent" />
                            <h2>Performance Insights</h2>
                        </div>
                        <div className="stats-summary-grid">
                            <div className="stat-box">
                                <span className="label">Cumulative Avg</span>
                                <span className="value">
                                    {interviews.length > 0 
                                        ? Math.round(interviews.reduce((acc, i) => acc + i.total_score, 0) / interviews.length)
                                        : 0}%
                                </span>
                            </div>
                            <div className="stat-box">
                                <span className="label">Sessions Taken</span>
                                <span className="value">{interviews.length}</span>
                            </div>
                            <div className="stat-box">
                                <span className="label">Top Performance</span>
                                <span className="value">
                                    {interviews.length > 0 ? Math.max(...interviews.map(i => i.total_score)) : 0}%
                                </span>
                            </div>
                        </div>
                        <div className="insight-message mt-8">
                            <Sparkles size={20} className="text-accent" />
                            <p>You've completed <strong>{interviews.length} practice sessions</strong>. Your strongest skills appear to be consistent with the <strong>{parsedSkills[0] || 'technical'}</strong> domain.</p>
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );

    return standalone ? (
        <DashboardLayout userType="student">{content}</DashboardLayout>
    ) : content;
};

export default InterviewPrepHub;
