import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Loader2, Plus, Trash2, Upload, FileText } from 'lucide-react';
import { getToken } from '../utils/auth';
import { aiGenerationInputSchema } from '../utils/validation';

interface AIGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddQuestions: (questions: any[]) => void;
}

// Available reference categories (mapped to sections in the CSV dataset)
// const REFERENCE_CATEGORIES = [
//     { value: '', label: '--- None (AI generates freely) ---' },
//     { value: 'AI & ML', label: '🤖 AI & Machine Learning' },
//     { value: 'DevOps Engineer', label: '⚙️ DevOps Engineer' },
//     { value: 'React Engineer', label: '⚛️ React Engineer' },
//     { value: 'SAP Engineer', label: '🏢 SAP Engineer' },
//     { value: 'Computer Science', label: '💻 Computer Science' },
//     { value: 'Numerical Ability', label: '🔢 Numerical Ability' },
//     { value: 'Logical Reasoning', label: '🧩 Logical Reasoning' },
//     { value: 'Verbal Ability', label: '📝 Verbal Ability' },
//     { value: 'Quantitative Aptitude', label: '📊 Quantitative Aptitude' },
// ];

// const AI_PROVIDERS = [
//     { value: 'auto', label: 'Auto (fallback between Groq/Gemini/K2)' },
//     { value: 'groq', label: 'Groq only' },
//     { value: 'gemini', label: 'Gemini only' },
//     { value: 'k2', label: 'K2 Think only' },
// ];

const AIGeneratorModal: React.FC<AIGeneratorModalProps> = ({ isOpen, onClose, onAddQuestions }) => {
    const [context, setContext] = useState('');
    const [count, setCount] = useState(5);
    const [difficulty, setDifficulty] = useState('Medium');
    const [category] = useState('');
    const [provider] = useState('auto');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedQuestions, setGeneratedQuestions] = useState<any[]>([]);
    
    const [error, setError] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = originalBodyOverflow;
        };
    }, [isOpen]);

    const handleGenerate = async () => {
        const parsed = aiGenerationInputSchema.safeParse({
            context,
            hasFile: !!selectedFile,
            category,
            count,
            difficulty,
            provider,
        });

        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message || 'Please provide valid generation inputs.');
            return;
        }

        const validated = parsed.data;

        setError('');
        setIsGenerating(true);

        try {
            const formData = new FormData();
            formData.append('context', validated.context);
            formData.append('count', validated.count.toString());
            formData.append('difficulty', validated.difficulty);
            formData.append('category', validated.category);
            formData.append('provider', validated.provider);
            if (selectedFile) {
                formData.append('file', selectedFile);
            }

            const response = await fetch('/api/ai/generate-questions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken('teacher')}`
                },
                body: formData
            });

            const data = await response.json();

            if (response.ok && data.questions) {
                // Formatting for UI preview
                const formatted = data.questions.map((q: any) => ({
                    question: q.question,
                    options: q.options,
                    correct_answer: q.correct_answer, // This is now an index (0-3)
                    marks: q.marks || (validated.difficulty === 'Hard' ? 4 : validated.difficulty === 'Medium' ? 2 : 1),
                    topic: q.topic || validated.category || 'General'
                }));
                setGeneratedQuestions(formatted);
                // setProviderUsed(data.meta?.providerUsed ?? null);
            } else {
                setError(data.message || 'Failed to process file. Please ensure the file contains readable question data.');
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred while connecting to the AI.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRemoveQuestion = (index: number) => {
        setGeneratedQuestions(prev => prev.filter((_, i) => i !== index));
    };

    const handleAddAll = () => {
        if (generatedQuestions.length > 0) {
            // Map to the format expected by CreateExam.tsx
            const finalQuestions = generatedQuestions.map((q: any) => ({
                text: q.question,
                type: 'MCQ',
                options: q.options,
                correct: q.correct_answer, // use index directly
                marks: q.marks,
                topic: q.topic,
                difficulty: q.difficulty || difficulty
            }));
            
            onAddQuestions(finalQuestions);
            onClose();
            // Reset state
            setTimeout(() => {
                setContext('');
                setSelectedFile(null);
                setGeneratedQuestions([]);
                
                // setProviderUsed(null);
            }, 300);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            
            // Basic size check (5MB)
            if (file.size > 5 * 1024 * 1024) {
                setError('File is too large. Max size is 5MB.');
                return;
            }

            setSelectedFile(file);
            setError('');
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="modal-overlay ai-modal-overlay" onClick={onClose}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="modal-content ai-modal"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="modal-header">
                        <div className="header-title">
                            <Sparkles className="ai-icon" size={24} />
                            <h2>Smart Question Import</h2>
                        </div>
                        <button onClick={onClose} className="close-btn" aria-label="Close AI generator modal">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="modal-body">
                        {error && <div className="error-alert">{error}</div>}

                        {generatedQuestions.length === 0 ? (
                            <div className="generator-setup">
                                <section className="setup-section">
                                    <div className="section-meta">
                                        <div className="form-group">
                                            <label>Upload Question Paper / Syllabus</label>
                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                                Supported: PDF, Word (.docx), Excel (.xlsx), CSV or Images
                                            </p>
                                            <div 
                                                className={`upload-zone ${selectedFile ? 'has-file' : ''}`}
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                <input 
                                                    type="file" 
                                                    ref={fileInputRef} 
                                                    onChange={handleFileChange} 
                                                    accept=".pdf,.docx,.xlsx,.xls,.csv,image/*" 
                                                    style={{ display: 'none' }}
                                                />
                                                {selectedFile ? (
                                                    <div className="file-preview">
                                                        <FileText size={24} />
                                                        <div className="file-info">
                                                            <span className="file-name">{selectedFile.name}</span>
                                                            <span className="file-size">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                                                        </div>
                                                        <button 
                                                            className="remove-file" 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedFile(null);
                                                            }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="upload-placeholder">
                                                        <Upload size={32} className="upload-icon" />
                                                        <p>Select a file to parse</p>
                                                        <span>Drag and drop here</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <div className="form-group">
                                    <label>Add Additional Context (Optional)</label>
                                    <textarea
                                        className="neo-input"
                                        placeholder="Add specific instructions like 'Focus on Chapter 5' or paste extra text here..."
                                        value={context}
                                        onChange={(e) => setContext(e.target.value)}
                                        rows={3}
                                        disabled={isGenerating}
                                    />
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Number of Questions</label>
                                        <input
                                            type="number"
                                            className="neo-input"
                                            value={count}
                                            onChange={(e) => setCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                                            min={1}
                                            max={50}
                                            disabled={isGenerating}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Difficulty Level</label>
                                        <select
                                            className="neo-input"
                                            value={difficulty}
                                            onChange={(e) => setDifficulty(e.target.value)}
                                            disabled={isGenerating}
                                        >
                                            <option value="Easy">Easy</option>
                                            <option value="Medium">Medium</option>
                                            <option value="High">High</option>
                                        </select>
                                    </div>
                                </div>

                                <button
                                    className="neo-btn-primary full-width generate-btn"
                                    onClick={handleGenerate}
                                    disabled={isGenerating || (!selectedFile && !context.trim() && !category.trim())}
                                >
                                    {isGenerating ? (
                                        <><Loader2 className="animate-spin" size={20} /> Processing Content...</>
                                    ) : (
                                        <><Sparkles size={20} /> Start Smart Import</>
                                    )}
                                </button>
                            </div>
                        ) : (
                            <div className="review-section">
                                <div className="review-header">
                                    <h3 style={{ margin: 0 }}>Review Extracted Data ({generatedQuestions.length} Questions)</h3>
                                    <button
                                        className="retry-btn"
                                        onClick={() => { setGeneratedQuestions([]); setSelectedFile(null); }}
                                    >
                                        Clear and Retry
                                    </button>
                                </div>

                                <div className="generated-questions-list">
                                    {generatedQuestions.map((q, index) => (
                                        <div key={index} className="generated-q-card">
                                            <div className="q-card-header">
                                                <span className="q-num">#{index + 1} • {q.topic}</span>
                                                <button
                                                    className="action-btn delete-btn"
                                                    onClick={() => handleRemoveQuestion(index)}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                            <p className="q-text">{q.question}</p>
                                            <div className="q-options">
                                                {q.options.map((opt: string, i: number) => (
                                                    <div
                                                        key={i}
                                                        className={`q-opt ${q.correct_answer === i ? 'correct-opt' : ''}`}
                                                    >
                                                        {String.fromCharCode(65 + i)}. {opt}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="modal-actions">
                                    <button className="neo-btn-secondary" onClick={() => { setGeneratedQuestions([]); }}>Back to Setup</button>
                                    <button
                                        className="neo-btn-primary add-all-btn"
                                        onClick={handleAddAll}
                                    >
                                        <Plus size={20} /> Add to Assessment
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>


                <style>{`
                    .ai-modal-overlay {
                        position: fixed;
                        inset: 0;
                        width: 100vw;
                        height: 100dvh;
                        padding: clamp(0.75rem, 2vw, 1.5rem);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: rgba(0, 0, 0, 0.8);
                        backdrop-filter: blur(4px);
                        z-index: 9999;
                        overflow: hidden;
                    }

                    .ai-modal {
                        width: min(850px, 100%);
                        padding: 0;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                        max-height: calc(100dvh - 3rem);
                    }
                    .modal-header { padding: 1.5rem 2rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--surface-low); }
                    .header-title { display: flex; align-items: center; gap: 0.75rem; }
                    .header-title h2 { margin: 0; font-size: 1.25rem; }
                    .ai-icon { color: var(--accent); }
                    .close-btn {
                        width: 2.2rem;
                        height: 2.2rem;
                        border-radius: 999px;
                        border: 1px solid var(--border);
                        background: var(--surface-high);
                        color: var(--text-secondary);
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        flex-shrink: 0;
                    }
                    .close-btn:hover {
                        color: var(--text-primary);
                        border-color: var(--accent);
                        background: rgba(99, 102, 241, 0.12);
                        transform: translateY(-1px);
                    }
                    .close-btn:focus-visible {
                        outline: none;
                        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.35);
                    }
                    .close-btn:active { transform: translateY(0); }
                    .modal-body { padding: 2rem; overflow-y: auto; overscroll-behavior: contain; flex: 1; }
                    
                    .generator-setup { display: flex; flex-direction: column; gap: 1.5rem; }
                    .form-group label { margin-bottom: 0.5rem; display: block; font-weight: 500; font-size: 0.875rem; color: var(--text-secondary); }
                    .form-group textarea { resize: vertical; min-height: 100px; font-family: inherit; line-height: 1.5; }
                    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

                    .upload-zone { border: 2px dashed var(--border); border-radius: var(--radius-sm); padding: 1.5rem; text-align: center; cursor: pointer; transition: all 0.2s ease; background: var(--surface-low); }
                    .upload-zone:hover { border-color: var(--accent); background: rgba(99, 102, 241, 0.05); }
                    .upload-zone.has-file { border-style: solid; border-color: var(--accent); background: rgba(99, 102, 241, 0.05); }
                    .upload-placeholder { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; color: var(--text-muted); }
                    .upload-placeholder p { margin: 0; font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); }
                    .upload-placeholder span { font-size: 0.75rem; }
                    .upload-icon { color: var(--text-muted); margin-bottom: 0.25rem; }
                    
                    .file-preview { display: flex; align-items: center; gap: 1rem; text-align: left; }
                    .file-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
                    .file-name { font-weight: 500; font-size: 0.875rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .file-size { font-size: 0.75rem; color: var(--text-muted); }
                    .remove-file { background: none; border: none; color: #ef4444; padding: 0.5rem; border-radius: 50%; cursor: pointer; transition: all 0.2s ease; }
                    .remove-file:hover { background: rgba(239, 68, 68, 0.1); }
                    
                    .generate-btn { margin-top: 1rem; padding: 1rem; font-size: 1rem; background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%); border: none; }
                    .generate-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
                    
                    .error-alert { padding: 1rem; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-sm); margin-bottom: 1.5rem; font-size: 0.875rem; }
                    
                    .review-section { display: flex; flex-direction: column; gap: 1.5rem; height: 100%; }
                    .review-header { display: flex; justify-content: space-between; align-items: center; }
                    .review-header h3 { margin: 0; font-size: 1.125rem; }
                    .retry-btn { background: none; border: none; color: var(--text-muted); font-size: 0.875rem; cursor: pointer; text-decoration: underline; }
                    .retry-btn:hover { color: var(--text-primary); }
                    
                    .generated-questions-list { display: flex; flex-direction: column; gap: 1rem; }
                    .generated-q-card { background: var(--surface-high); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1.25rem; }
                    .q-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
                    .q-num { font-size: 0.75rem; font-weight: 700; background: var(--surface-low); padding: 0.25rem 0.5rem; border-radius: 4px; color: var(--text-secondary); }
                    .q-text { font-weight: 500; margin: 0 0 1rem 0; line-height: 1.5; }
                    .q-options { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
                    .q-opt { padding: 0.5rem 0.75rem; background: var(--surface-low); border: 1px solid var(--border); border-radius: 6px; font-size: 0.875rem; color: var(--text-secondary); }
                    .q-opt.correct-opt { background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3); color: #10b981; font-weight: 600; }
                    
                    .modal-actions { display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
                    .add-all-btn { background: #10b981; color: #fff; border: none; }
                    .add-all-btn:hover { background: #059669; }

                    @media (max-width: 768px) {
                        .ai-modal { max-height: calc(100dvh - 1.5rem); }
                        .modal-header { padding: 1rem 1.25rem; }
                        .modal-body { padding: 1.25rem; }
                        .header-title h2 { font-size: 1.05rem; }
                        .form-row, .q-options { grid-template-columns: 1fr; }
                    }
                `}</style>
            </div>
        </AnimatePresence>
    );
};

export default AIGeneratorModal;
