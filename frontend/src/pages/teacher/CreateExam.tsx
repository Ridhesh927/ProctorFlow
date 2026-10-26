import { useState } from 'react';
import { getToken } from '../../utils/auth';
import { motion, AnimatePresence } from 'framer-motion';
import {
    HelpCircle,
    Settings,
    CheckCircle,
    AlertTriangle,
    Plus,
    Trash2,
    Upload,
    ChevronRight,
    ChevronLeft,
    Download,
    Rocket,
    Sparkles
} from 'lucide-react';
import * as XLSX from 'xlsx';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../layouts/DashboardLayout';
import AIGeneratorModal from '../../components/AIGeneratorModal';

const CreateExam = () => {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishSuccess, setPublishSuccess] = useState(false);
    const [lastPublishedStatus, setLastPublishedStatus] = useState<'Draft' | 'Published'>('Published');
    const [showAIModal, setShowAIModal] = useState(false);
    const [popupAlert, setPopupAlert] = useState<{ title: string; message: string; type: 'warning' | 'error' } | null>(null);
    const [examData, setExamData] = useState({
        title: '',
        subject: '',
        duration: 60,
        passingMarks: 40,
        target_department: '',
        target_year: '',
        expires_at: '',
        questions: [] as any[]
    });

    const nextStep = () => {
        if (step === 1) {
            if (!examData.title || !examData.subject || !examData.duration || !examData.expires_at) {
                setPopupAlert({
                    title: 'Missing Required Details',
                    message: 'Please fill out all mandatory fields: Title, Subject, Duration, and Expiration Date.',
                    type: 'warning'
                });
                return;
            }
        }
        setStep(s => s + 1);
    };
    const prevStep = () => setStep(s => s - 1);

    const addQuestion = () => {
        setExamData({
            ...examData,
            questions: [...examData.questions, { text: '', type: 'MCQ', options: ['', '', '', ''], correct: 0 }]
        });
    };

    const updateQuestion = (index: number, field: string, value: any) => {
        const updatedQuestions = [...examData.questions];
        updatedQuestions[index] = { ...updatedQuestions[index], [field]: value };
        setExamData({ ...examData, questions: updatedQuestions });
    };

    const updateOption = (qIndex: number, oIndex: number, value: string) => {
        const updatedQuestions = [...examData.questions];
        const updatedOptions = [...updatedQuestions[qIndex].options];
        updatedOptions[oIndex] = value;
        updatedQuestions[qIndex] = { ...updatedQuestions[qIndex], options: updatedOptions };
        setExamData({ ...examData, questions: updatedQuestions });
    };

    const deleteQuestion = (index: number) => {
        setExamData({
            ...examData,
            questions: examData.questions.filter((_, i) => i !== index)
        });
    };

    const handlePublish = async (status: string = 'Published') => {
        setIsPublishing(true);
        try {
            const token = getToken('teacher');

            // Map frontend data to backend format
            const backendData = {
                title: examData.title,
                subject: examData.subject,
                duration: examData.duration,
                total_marks: examData.questions.length * 5,
                passing_marks: examData.passingMarks,
                instructions: 'Please read all questions carefully before answering.',
                target_department: examData.target_department || null,
                target_year: examData.target_year || null,
                expires_at: examData.expires_at,
                questions: examData.questions.map(q => ({
                    question: q.text || 'New Question',
                    options: Array.isArray(q.options) ? q.options : ['', '', '', ''],
                    correct_answer: typeof q.correct === 'number' ? q.correct : 0,
                    marks: q.marks || 5,
                    difficulty: q.difficulty || 'Medium',
                    topic: q.topic || examData.subject || 'General'
                })),
                status: status
            };

            await axios.post('/api/exams/create', backendData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setLastPublishedStatus(status as any);
            setPublishSuccess(true);
            setTimeout(() => {
                navigate('/teacher/exams');
            }, 2000);
        } catch (err) {
            console.error('Failed to publish exam:', err);
            setPopupAlert({
                title: 'Publish Failed',
                message: 'Failed to publish exam. Please try again.',
                type: 'error'
            });
        } finally {
            setIsPublishing(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws) as any[];

            const importedQuestions = data.map((row: any) => ({
                text: row.question || '',
                type: 'MCQ',
                options: [row.option1 || '', row.option2 || '', row.option3 || '', row.option4 || ''],
                correct: (parseInt(row.correct_answer) - 1) || 0
            }));

            setExamData({
                ...examData,
                questions: [...examData.questions, ...importedQuestions]
            });
        };
        reader.readAsBinaryString(file);
    };

    const handleAddAIQuestions = (newQuestions: any[]) => {
        setExamData({
            ...examData,
            questions: [...examData.questions, ...newQuestions.map((q: any) => ({
                text: q.text || q.question || 'New Question',
                type: 'MCQ',
                options: q.options || ['', '', '', ''],
                correct: typeof q.correct === 'number' ? q.correct :
                         typeof q.correct_answer === 'number' ? q.correct_answer :
                         q.correct_answer === q.options?.[0] ? 0 :
                         q.correct_answer === q.options?.[1] ? 1 :
                         q.correct_answer === q.options?.[2] ? 2 : 3
            }))]
        });
    };

    return (
        <DashboardLayout userType="teacher">
            <div className="create-exam-page">
                <header className="page-header">
                    <div>
                        <h1>Drafting New Assessment</h1>
                        <p className="text-secondary">Structure your inquiry with precision and clarity.</p>
                    </div>
                    <div className="step-indicator">
                        {[1, 2, 3].map(i => (
                            <div key={i} className={`step-dot ${step >= i ? 'active' : ''}`}>
                                <span className="step-num">{i}</span>
                                <span className="step-label">{i === 1 ? 'Foundations' : i === 2 ? 'Inquiry' : 'Finalize'}</span>
                            </div>
                        ))}
                    </div>
                </header>

                <main className="wizard-container neo-card">
                    <AnimatePresence mode="wait">
                        {step === 1 && (
                            <motion.div
                                key="step1"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="wizard-step"
                            >
                                <div className="section-title">
                                    <Settings className="text-accent" />
                                    <h2>Exam Foundations</h2>
                                </div>

                                <div className="form-grid">
                                    <div className="form-group span-2">
                                        <label>Title of Assessment</label>
                                        <input
                                            type="text"
                                            className="neo-input"
                                            placeholder="e.g. Quantum Mechanics Midterm"
                                            value={examData.title}
                                            onChange={(e) => setExamData({ ...examData, title: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Discipline / Subject</label>
                                        <input
                                            type="text"
                                            className="neo-input"
                                            placeholder="Physics"
                                            value={examData.subject}
                                            onChange={(e) => setExamData({ ...examData, subject: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Duration (Minutes)</label>
                                        <input
                                            type="number"
                                            className="neo-input"
                                            value={examData.duration}
                                            onChange={(e) => setExamData({ ...examData, duration: parseInt(e.target.value) })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Target Department <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Optional — leave blank for all)</span></label>
                                        <select
                                            className="neo-input"
                                            value={examData.target_department}
                                            onChange={(e) => setExamData({ ...examData, target_department: e.target.value })}
                                        >
                                            <option value="">All Departments</option>
                                            <option>Computer Science</option>
                                            <option>IT</option>
                                            <option>ALML</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Target Year <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Optional — leave blank for all)</span></label>
                                        <select
                                            className="neo-input"
                                            value={examData.target_year}
                                            onChange={(e) => setExamData({ ...examData, target_year: e.target.value })}
                                        >
                                            <option value="">All Years</option>
                                            <option>First Year</option>
                                            <option>Second Year</option>
                                            <option>Third Year</option>
                                            <option>Fourth Year</option>
                                        </select>
                                    </div>
                                    <div className="form-group span-2">
                                        <label>Expiration Date & Time <span style={{ color: '#ef4444' }}>*</span></label>
                                        <input
                                            type="datetime-local"
                                            className="neo-input"
                                            required
                                            value={examData.expires_at}
                                            onChange={(e) => setExamData({ ...examData, expires_at: e.target.value })}
                                        />
                                        <small style={{ color: 'var(--text-muted)' }}>Students will not be able to access the exam after this time.</small>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {step === 2 && (
                            <motion.div
                                key="step2"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="wizard-step"
                            >
                                <div className="section-title">
                                    <HelpCircle className="text-accent" />
                                    <h2>Inquiry Design</h2>
                                </div>

                                <div className="questions-list">
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <button className="add-q-btn" onClick={addQuestion}>
                                            <Plus size={20} /> Add New Inquiry
                                        </button>
                                        <button
                                            className="add-q-btn"
                                            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                                            onClick={() => setShowAIModal(true)}
                                        >
                                            <Sparkles size={20} /> Generate with AI
                                        </button>
                                    </div>

                                    <div className="bulk-import-container">
                                        <div className="bulk-import-lite">
                                            <Upload size={18} />
                                            <span>Import questions from CSV/Excel</span>
                                            <input
                                                type="file"
                                                accept=".csv, .xlsx, .xls"
                                                onChange={handleFileUpload}
                                                style={{ opacity: 0, position: 'absolute', width: '100%', cursor: 'pointer' }}
                                            />
                                        </div>
                                        <a
                                            href="/question_template.csv"
                                            download
                                            className="template-link"
                                        >
                                            <Download size={14} /> Download Template
                                        </a>
                                    </div>

                                    {examData.questions.map((q, i) => (
                                        <div key={i} className="question-editor neo-card">
                                            <div className="q-edit-header">
                                                <span>Question {i + 1}</span>
                                                <button onClick={() => deleteQuestion(i)} className="text-btn danger"><Trash2 size={16} /></button>
                                            </div>
                                            <textarea
                                                className="neo-input q-text-area"
                                                placeholder="Enter question text..."
                                                value={q.text}
                                                onChange={(e) => updateQuestion(i, 'text', e.target.value)}
                                            ></textarea>

                                            <div className="options-grid">
                                                {q.options.map((opt: string, oIdx: number) => (
                                                    <div
                                                        key={oIdx}
                                                        className={`option-row ${q.correct === oIdx ? 'correct' : ''}`}
                                                    >
                                                        <button
                                                            className="correct-toggle"
                                                            onClick={() => updateQuestion(i, 'correct', oIdx)}
                                                        >
                                                            <CheckCircle size={16} />
                                                        </button>
                                                        <input
                                                            type="text"
                                                            className="neo-input-compact"
                                                            placeholder={`Option ${String.fromCharCode(65 + oIdx)}`}
                                                            value={opt}
                                                            onChange={(e) => updateOption(i, oIdx, e.target.value)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}

                        {step === 3 && (
                            <motion.div
                                key="step3"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="wizard-step finalize-step"
                            >
                                <CheckCircle size={64} className="text-success" />
                                <h2>Validation Complete</h2>
                                <p className="text-secondary text-center">Your assessment is structured and ready for enrollment. Perform a final review before publication.</p>

                                <div className="review-summary neo-card">
                                    <div className="r-item"><span>Title</span> <strong>{examData.title || 'Untitled'}</strong></div>
                                    <div className="r-item"><span>Subject</span> <strong>{examData.subject || 'Not specified'}</strong></div>
                                    <div className="r-item"><span>Questions</span> <strong>{examData.questions.length}</strong></div>
                                    <div className="r-item"><span>Target Dept.</span> <strong>{examData.target_department || 'All Departments'}</strong></div>
                                    <div className="r-item"><span>Target Year</span> <strong>{examData.target_year || 'All Years'}</strong></div>
                                    <div className="r-item"><span>Security</span> <strong className="text-success">AI Proctoring Enabled</strong></div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <footer className="wizard-footer">
                        <button
                            disabled={step === 1}
                            onClick={prevStep}
                            className="nav-btn nav-btn-back"
                        >
                            <ChevronLeft size={18} /> Back
                        </button>

                        {step === 3 && (
                            <button
                                onClick={() => handlePublish('Draft')}
                                disabled={isPublishing || publishSuccess}
                                className="nav-btn nav-btn-back"
                                style={{ marginLeft: '1rem', marginRight: 'auto' }}
                            >
                                Save as Draft
                            </button>
                        )}

                        <button
                            onClick={step === 3 ? () => handlePublish('Published') : nextStep}
                            disabled={isPublishing || publishSuccess || (step === 2 && examData.questions.length === 0)}
                            className={step === 3 ? 'nav-btn nav-btn-publish' : 'nav-btn nav-btn-continue'}
                            title={step === 2 && examData.questions.length === 0 ? 'Add at least one question to continue' : ''}
                        >
                            {publishSuccess ? (
                                <><CheckCircle size={18} /> {lastPublishedStatus === 'Draft' ? 'Saved!' : 'Published!'}</>
                            ) : isPublishing ? (
                                <><Rocket size={18} className="publishing-icon" /> Processing...</>
                            ) : (
                                <>{step === 3 ? <><Rocket size={18} /> Publish Assessment</> : <>Continue to Review <ChevronRight size={18} /></>}</>
                            )}
                        </button>
                    </footer>
                </main>

                <AIGeneratorModal
                    isOpen={showAIModal}
                    onClose={() => setShowAIModal(false)}
                    onAddQuestions={handleAddAIQuestions}
                />

                <AnimatePresence>
                    {popupAlert && (
                        <motion.div
                            className="exam-alert-overlay"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setPopupAlert(null)}
                        >
                            <motion.div
                                className="exam-alert-card"
                                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 14, scale: 0.97 }}
                                transition={{ duration: 0.2 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className={`exam-alert-icon ${popupAlert.type}`}>
                                    <AlertTriangle size={20} />
                                </div>
                                <h3>{popupAlert.title}</h3>
                                <p>{popupAlert.message}</p>
                                <div className="exam-alert-actions">
                                    <button className="neo-btn-primary" onClick={() => setPopupAlert(null)}>
                                        OK
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <style>{`
          .create-exam-page { display: flex; flex-direction: column; gap: 2.5rem; max-width: 1000px; margin: 0 auto; }
          .page-header { display: flex; align-items: center; justify-content: space-between; }
          .page-header h1 { font-size: 2.25rem; font-family: var(--font-display); }
          .step-indicator { display: flex; gap: 2rem; }
          .step-dot { display: flex; align-items: center; gap: 0.75rem; opacity: 0.3; transition: var(--transition-normal); }
          .step-dot.active { opacity: 1; color: var(--accent); }
          .step-num { width: 24px; height: 24px; border-radius: 50%; border: 2px solid currentColor; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800; }
          .step-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
          
          .wizard-container { padding: 3rem; display: flex; flex-direction: column; gap: 2rem; min-height: 500px; background: var(--surface-low); }
          .section-title { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; }
          .section-title h2 { font-size: 1.5rem; }
          
          .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
          .span-2 { grid-column: span 2; }
          
          .questions-list { display: flex; flex-direction: column; gap: 2rem; }
          .question-editor { padding: 2rem; background: var(--surface); display: flex; flex-direction: column; gap: 1.5rem; }
          .q-edit-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); }
          .q-edit-header .text-btn.danger {
            background: rgba(239, 68, 68, 0.12);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #ef4444;
            border-radius: var(--radius-sm);
            width: 32px;
            height: 32px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .q-edit-header .text-btn.danger:hover {
            background: rgba(239, 68, 68, 0.25);
            border-color: rgba(239, 68, 68, 0.6);
            color: #f87171;
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
          }
          .q-text-area { min-height: 80px; resize: vertical; margin-bottom: 1rem; }
          
          .options-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
          .option-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); transition: var(--transition-fast); }
          .option-row.correct { border-color: var(--success); background: rgba(16, 185, 129, 0.05); }
          
          .correct-toggle { background: none; color: var(--text-muted); transition: var(--transition-fast); }
          .option-row.correct .correct-toggle { color: var(--success); }
          .neo-input-compact { background: none; border: none; outline: none; color: var(--text-primary); font-size: 0.875rem; width: 100%; }
          
          .add-q-btn { width: 100%; padding: 1.25rem; border: 1px dashed var(--border); background: var(--surface-low); color: var(--text-secondary); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; gap: 1rem; font-weight: 700; font-size: 0.875rem; transition: var(--transition-fast); }
          .add-q-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--surface); }
          
          .bulk-import-container { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; margin-top: 1rem; }
          .bulk-import-lite { position: relative; display: flex; align-items: center; justify-content: center; gap: 0.75rem; color: var(--text-muted); font-size: 0.8125rem; padding: 0.75rem 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); transition: var(--transition-fast); width: 100%; }
          .bulk-import-lite:hover { background: var(--surface-low); color: var(--text-primary); }
          .template-link { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--accent); font-weight: 600; text-decoration: underline; }
          .template-link:hover { opacity: 0.8; }
          
          .finalize-step { display: flex; flex-direction: column; align-items: center; gap: 2rem; text-align: center; }
          .review-summary { width: 100%; max-width: 450px; padding: 2rem; display: flex; flex-direction: column; gap: 1.25rem; background: var(--surface); }
          .r-item { display: flex; justify-content: space-between; font-size: 0.9375rem; }
          .r-item span { color: var(--text-muted); }
          
          .wizard-footer { margin-top: auto; padding-top: 2rem; border-top: 1px solid var(--border); display: flex; justify-content: space-between; }
          .danger { color: var(--error); }
          .text-center { text-align: center; }
          
          /* Enhanced Navigation Buttons */
          .nav-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            padding: 0.875rem 2.25rem;
            min-width: 140px;
            border-radius: 12px;
            font-size: 0.95rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            border: none;
            letter-spacing: 0.02em;
          }
          
          .nav-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            transition: opacity 0.3s ease;
          }
          
          .nav-btn:hover:not(:disabled)::before {
            opacity: 1;
          }
          
          .nav-btn svg {
            position: relative;
            z-index: 1;
            transition: transform 0.3s ease;
          }
          
          .nav-btn span {
            position: relative;
            z-index: 1;
          }
          
          /* Back Button */
          .nav-btn-back {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
            border: 1px solid rgba(99, 102, 241, 0.3);
            color: var(--text-primary);
          }
          
          .nav-btn-back::before {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
          }
          
          .nav-btn-back:hover:not(:disabled) {
            border-color: rgba(99, 102, 241, 0.6);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
            transform: translateY(-2px);
          }
          
          .nav-btn-back:hover:not(:disabled) svg {
            transform: translateX(-3px);
          }
          
          .nav-btn-back:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            background: rgba(255, 255, 255, 0.03);
            border-color: rgba(255, 255, 255, 0.05);
          }
          
          /* Continue Button */
          .nav-btn-continue {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
            animation: pulse-glow 3s infinite;
          }
          
          @keyframes pulse-glow {
            0% { box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4); }
            50% { box-shadow: 0 8px 25px rgba(139, 92, 246, 0.6); }
            100% { box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4); }
          }
          
          .nav-btn-continue:hover:not(:disabled) {
            transform: translateY(-3px) scale(1.02);
            box-shadow: 0 12px 30px rgba(99, 102, 241, 0.5);
          }
          
          .nav-btn-continue::before {
            background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
          }
          
          .nav-btn-continue:hover:not(:disabled) {
            box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
            transform: translateY(-2px);
          }
          
          .nav-btn-continue:hover:not(:disabled) svg:last-child {
            transform: translateX(3px);
          }
          
          .nav-btn-continue:disabled {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.1);
            color: var(--text-muted);
            box-shadow: none;
            cursor: not-allowed;
            opacity: 0.6;
          }
          
          .nav-btn-publish {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
            color: white;
          }
          
          /* Publish Button */
          .nav-btn-publish {
            background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
            border: 1px solid rgba(249, 115, 22, 0.3);
            color: white;
            box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
          }
          
          .nav-btn-publish::before {
            background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
          }
          
          .nav-btn-publish:hover:not(:disabled) {
            box-shadow: 0 6px 20px rgba(249, 115, 22, 0.5);
            transform: translateY(-2px);
          }
          
          .nav-btn-publish:hover:not(:disabled) svg {
            transform: translateY(-2px) rotate(-5deg);
          }
          
          .nav-btn-publish:disabled {
            opacity: 0.7;
            cursor: not-allowed;
          }
          
          .publishing-icon {
            animation: rocket-launch 1s infinite;
          }

                    .exam-alert-overlay {
                        position: fixed;
                        inset: 0;
                        background: rgba(0, 0, 0, 0.65);
                        backdrop-filter: blur(3px);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10001;
                        padding: 1rem;
                    }

                    .exam-alert-card {
                        width: min(460px, 100%);
                        background: linear-gradient(180deg, var(--surface) 0%, var(--surface-low) 100%);
                        border: 1px solid var(--border);
                        border-radius: var(--radius-md);
                        box-shadow: 0 22px 40px rgba(0, 0, 0, 0.5);
                        padding: 1.25rem 1.25rem 1rem;
                    }

                    .exam-alert-icon {
                        width: 2.25rem;
                        height: 2.25rem;
                        border-radius: 999px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin-bottom: 0.85rem;
                    }

                    .exam-alert-icon.warning {
                        background: rgba(245, 158, 11, 0.18);
                        border: 1px solid rgba(245, 158, 11, 0.45);
                        color: #f59e0b;
                    }

                    .exam-alert-icon.error {
                        background: rgba(239, 68, 68, 0.18);
                        border: 1px solid rgba(239, 68, 68, 0.45);
                        color: #ef4444;
                    }

                    .exam-alert-card h3 {
                        margin: 0 0 0.45rem;
                        font-size: 1.1rem;
                    }

                    .exam-alert-card p {
                        margin: 0;
                        color: var(--text-secondary);
                        line-height: 1.55;
                        font-size: 0.95rem;
                    }

                    .exam-alert-actions {
                        display: flex;
                        justify-content: flex-end;
                        margin-top: 1rem;
                    }

                    .exam-alert-actions .neo-btn-primary {
                        min-width: 84px;
                        justify-content: center;
                    }
          
          @keyframes rocket-launch {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-4px); }
          }
        `}</style>
            </div>
        </DashboardLayout>
    );
};

export default CreateExam;
