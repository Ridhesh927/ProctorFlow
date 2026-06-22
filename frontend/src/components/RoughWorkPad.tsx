import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eraser, Maximize2, Minimize2, Move, X } from 'lucide-react';

interface RoughWorkPadProps {
    isOpen: boolean;
    onClose: () => void;
    onUpdate: (content: string) => void;
}

const RoughWorkPad = ({ isOpen, onClose, onUpdate }: RoughWorkPadProps) => {
    const [content, setContent] = useState('');
    const [isMinimized, setIsMinimized] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Initial load from local storage if any
    useEffect(() => {
        const saved = localStorage.getItem('roughWork');
        if (saved) setContent(saved);
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setContent(val);
        localStorage.setItem('roughWork', val);
    };

    // Debounced sync to socket
    useEffect(() => {
        const timer = setTimeout(() => {
            onUpdate(content);
        }, 800);
        return () => clearTimeout(timer);
    }, [content, onUpdate]);

    if (!isOpen) return null;

    return (
        <motion.div
            drag
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9, x: 100, y: 100 }}
            animate={{ 
                opacity: 1, 
                scale: 1,
                height: isMinimized ? '48px' : '360px',
                width: isMinimized ? '200px' : '320px'
            }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`rough-pad-container ${isMinimized ? 'minimized' : ''}`}
            style={{ 
                position: 'fixed', 
                bottom: '100px', 
                right: '40px', 
                zIndex: 1000,
                cursor: 'default'
            }}
        >
            <div className="pad-header" onPointerDown={e => e.stopPropagation()}>
                <div className="header-drag-area">
                    <Move size={14} className="drag-icon" />
                    <span>Rough WorkPad</span>
                </div>
                <div className="header-actions">
                    <button onClick={() => setIsMinimized(!isMinimized)} title={isMinimized ? 'Maximize' : 'Minimize'}>
                        {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                    </button>
                    <button onClick={onClose} title="Close Pad">
                        <X size={14} />
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {!isMinimized && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="pad-body"
                    >
                        <textarea
                            ref={textareaRef}
                            placeholder="Do your calculations, notes, or rough logic here. Your teacher can monitor this in real-time."
                            value={content}
                            onChange={handleChange}
                            spellCheck={false}
                        />
                        <div className="pad-footer">
                            <button className="clear-btn" onClick={() => { if(confirm('Clear all rough work?')) setContent(''); }}>
                                <Eraser size={12} /> Clear
                            </button>
                            <span className="sync-status">● Live Sync Active</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <style>{`
                .rough-pad-container {
                    background: rgba(26, 26, 28, 0.95);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    transition: width 0.3s, height 0.3s;
                }
                .pad-header {
                    padding: 0.75rem 1rem;
                    background: rgba(255, 255, 255, 0.03);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                }
                .header-drag-area { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
                .drag-icon { color: var(--accent); opacity: 0.7; }
                .header-actions { display: flex; gap: 0.5rem; }
                .header-actions button { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; transition: 0.2s; }
                .header-actions button:hover { background: rgba(255, 255, 255, 0.1); color: var(--text-primary); }
                
                .pad-body { flex: 1; display: flex; flex-direction: column; padding: 0.25rem; height: calc(100% - 48px); }
                .pad-body textarea {
                    flex: 1;
                    width: 100%;
                    background: transparent;
                    border: none;
                    outline: none;
                    color: #d1d5db;
                    font-family: 'JetBrains Mono', 'Fira Code', monospace;
                    font-size: 0.875rem;
                    line-height: 1.6;
                    padding: 0.75rem;
                    resize: none;
                }
                .pad-footer {
                    padding: 0.5rem 0.75rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-top: 1px solid rgba(255, 255, 255, 0.03);
                }
                .clear-btn { background: none; border: none; font-size: 0.65rem; color: #ef4444; font-weight: 700; text-transform: uppercase; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; opacity: 0.7; transition: 0.2s; }
                .clear-btn:hover { opacity: 1; }
                .sync-status { font-size: 0.65rem; color: #10b981; font-weight: 600; opacity: 0.8; }
                
                .minimized { height: 48px !important; }
                .minimized .pad-header { border-bottom: none; }
            `}</style>
        </motion.div>
    );
};

export default RoughWorkPad;
