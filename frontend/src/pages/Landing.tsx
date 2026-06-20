import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, ChevronRight, ShieldCheck, Zap, Globe } from 'lucide-react';
import GlareHover from '../components/GlareHover/GlareHover';


const Landing = () => {
    const navigate = useNavigate();
    const [clickedId, setClickedId] = useState<string | null>(null);

    const handleCardClick = (role: { id: string; path: string; color: string }) => {
        setClickedId(role.id);
        setTimeout(() => navigate(role.path), 350);
    };

    const roles = [
        {
            id: 'student',
            title: 'Student',
            description: "Your gateway to DES Pune University's online examinations. Stay organized and perform your best in every assessment.",
            icon: <GraduationCap size={40} />,
            color: 'var(--accent)',
            path: '/login?role=student'
        },
        {
            id: 'teacher',
            title: 'Teacher',
            description: "Empower the academic journey with advanced tools for secure assessment design, live monitoring, and insightful evaluation.",
            icon: <ShieldCheck size={40} />,
            color: 'var(--success)',
            path: '/login?role=teacher'
        }
    ];

    return (
        <div className="landing-root">
            <header className="landing-header">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="brand"
                >
                </motion.div>
            </header>

            <main className="landing-hero">
                <section className="hero-content">
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                    >
                        Online Exam
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="hero-subtitle"
                    >
                    </motion.p>
                </section>

                <div className="role-selection">
                    {roles.map((role, i) => (
                        <motion.div
                            key={role.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={clickedId === role.id
                                ? { opacity: 1, scale: [1, 1.06, 0.98, 1] }
                                : { opacity: 1, scale: 1 }
                            }
                            transition={{ delay: clickedId === role.id ? 0 : 0.2 + (i * 0.2), duration: 0.35 }}
                            className="role-card-wrapper"
                            onClick={() => handleCardClick(role)}
                            style={{
                                boxShadow: clickedId === role.id
                                    ? `0 0 32px 8px ${role.color}55, 0 0 0 2px ${role.color}`
                                    : undefined,
                                transition: 'box-shadow 0.2s ease'
                            }}
                        >
                            <div
                                className="role-card-border-anim"
                                style={{
                                    background: `conic-gradient(transparent, ${role.color}, transparent 30%)`
                                }}
                            ></div>
                            <GlareHover
                                className="role-card neo-card"
                                width="100%"
                                height="100%"
                                background="var(--surface-low)"
                                borderRadius="0"
                                borderColor="transparent"
                                glareColor={role.color}
                                glareOpacity={0.4}
                                glareSize={170}
                            >
                                <div className="role-icon" style={{ color: role.color, transition: 'transform 0.2s', transform: clickedId === role.id ? 'scale(1.2)' : 'scale(1)' }}>
                                    {role.icon}
                                </div>
                                <h3 style={{ color: clickedId === role.id ? role.color : undefined, transition: 'color 0.2s' }}>{role.title}</h3>
                                <p>{role.description}</p>
                                <button className="role-btn">
                                    Login <ChevronRight size={18} />
                                </button>
                            </GlareHover>
                        </motion.div>
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6, duration: 0.5 }}
                    className="demo-credentials"
                >
                    <p className="demo-title">Demo Testing Credentials</p>
                    <div className="cred-box">
                        <div className="cred-item">
                            <span className="cred-role">Student</span>
                            <span className="cred-detail">student@test.com</span>
                            <span className="cred-pass">password123</span>
                        </div>
                        <div className="cred-item">
                            <span className="cred-role">Teacher</span>
                            <span className="cred-detail">teacher@test.com</span>
                            <span className="cred-pass">password123</span>
                        </div>
                    </div>
                </motion.div>
            </main>

            <footer className="landing-footer">
                <div className="footer-stats">
                    <div className="stat">
                        <Zap size={16} className="text-accent" />
                        <span>Real-time Monitoring</span>
                    </div>
                    <div className="stat">
                        <Globe size={16} className="text-accent" />
                        <span>Global Accessibility</span>
                    </div>
                </div>
                <p className="copyright">© 2026 Academic Integrity Systems. All rights reserved.</p>
            </footer>

            <style>{`
                .landing-root {
                    height: 100vh;
                    background: var(--bg);
                    display: flex;
                    flex-direction: column;
                    padding: 0 4rem;
                    overflow: hidden;
                    position: relative;
                }

                .landing-header {
                    height: 80px;
                    display: flex;
                    align-items: center;
                }

                .brand {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    font-weight: 800;
                    letter-spacing: 0.2rem;
                    font-size: 1.1rem;
                }

                .brand-dot {
                    width: 10px;
                    height: 10px;
                    background: var(--accent);
                    border-radius: 50%;
                }

                .landing-hero {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    text-align: center;
                    gap: 2rem;
                    padding-bottom: 2rem;
                    margin-top: -2rem;
                }

                .hero-content h1 {
                    font-size: clamp(2.5rem, 6vw, 4.5rem);
                    line-height: 1.1;
                    margin-bottom: 1.5rem;
                    font-family: var(--font-display);
                }

                .hero-subtitle {
                    font-size: 1.125rem;
                    color: var(--text-muted);
                    max-width: 500px;
                    margin: 0 auto;
                }

                .role-selection {
                    display: flex;
                    gap: 2rem;
                    width: 100%;
                    max-width: 900px;
                    justify-content: center;
                }

                .demo-credentials {
                    margin-top: 1rem;
                    background: var(--surface-low);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-md);
                    padding: 1.25rem 2rem;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
                }

                .demo-title {
                    font-size: 0.85rem;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    margin-bottom: 1rem;
                    font-weight: 600;
                }

                .cred-box {
                    display: flex;
                    gap: 3rem;
                    justify-content: center;
                }

                .cred-item {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.25rem;
                }

                .cred-role {
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                }

                .cred-detail {
                    font-size: 0.95rem;
                    color: var(--text-primary);
                    font-family: monospace;
                    background: var(--surface);
                    padding: 0.25rem 0.5rem;
                    border-radius: var(--radius-sm);
                }

                .cred-pass {
                    font-size: 0.85rem;
                    color: var(--text-muted);
                }

                .role-card-wrapper {
                    position: relative;
                    padding: 4px;
                    border-radius: var(--radius-sm);
                    overflow: hidden;
                    cursor: pointer;
                    flex: 1;
                    max-width: 400px;
                    transition: transform 0.3s;
                }

                .role-card-wrapper:hover {
                    transform: translateY(-5px);
                }

                .role-card-border-anim {
                    position: absolute;
                    top: -50%;
                    left: -50%;
                    width: 200%;
                    height: 200%;
                    animation: rotate 4s linear infinite;
                    opacity: 0.8;
                    transition: opacity 0.3s;
                }

                .role-card-wrapper:hover .role-card-border-anim {
                    opacity: 1;
                }

                .role-card {
                    position: relative;
                    z-index: 1;
                    padding: 2.5rem;
                    background: var(--surface-low);
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                    border: none !important;
                }

                @keyframes rotate {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                .role-icon {
                    margin-bottom: 0.5rem;
                }

                .role-card h3 {
                    font-size: 1.75rem;
                    font-family: var(--font-display);
                }

                .role-card p {
                    color: var(--text-muted);
                    line-height: 1.5;
                    font-size: 0.9375rem;
                }

                .role-btn {
                    margin-top: auto;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-weight: 700;
                    background: none;
                    color: var(--accent);
                    padding: 0;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    font-size: 0.8125rem;
                }

                .landing-footer {
                    height: 80px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-top: 1px solid var(--border);
                }

                .footer-stats {
                    display: flex;
                    gap: 2.5rem;
                }

                .stat {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                }

                .copyright {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                }

                @media (max-width: 768px) {
                    .landing-root { padding: 0 2rem; overflow-y: auto; height: auto; min-height: 100vh; }
                    .landing-hero { gap: 2rem; padding: 4rem 0; }
                    .role-selection { flex-direction: column; align-items: center; }
                    .role-card-wrapper { width: 100%; }
                }
            `}</style>
        </div>
    );
};

export default Landing;
