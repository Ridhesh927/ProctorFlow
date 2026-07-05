import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';

import { setAuth } from '../../utils/auth';
import { getLoginSchema } from '../../utils/validation';



const Login = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const role = searchParams.get('role') || 'student';

  const [showPassword, setShowPassword] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isStudent = role === 'student';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const trimmedIdentifier = identifier.trim();
      const trimmedPassword = password.trim();

      const parsed = getLoginSchema(isStudent ? 'student' : 'teacher').safeParse({
        identifier: trimmedIdentifier,
        password: trimmedPassword,
      });

      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message || 'Please enter valid credentials.');
        setLoading(false);
        return;
      }

      const endpoint = isStudent
        ? `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'}/api/auth/student/login`
        : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'}/api/auth/teacher/login`;

      const body = isStudent
        ? { prn_number: parsed.data.identifier, password: parsed.data.password }
        : { email: parsed.data.identifier, password: parsed.data.password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Invalid credentials');
        setLoading(false);
        return;
      }

      // Store token and user data under role-specific keys
      const roleName = isStudent ? 'student' : 'teacher';
      setAuth(roleName, data.token, data.user);

      // Navigate to appropriate dashboard
      if (isStudent) {
        navigate('/student/dashboard');
      } else {
        navigate('/teacher/dashboard');
      }
    } catch (error) {
      console.error('Login error:', error);
      setError('Failed to connect to server. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">


      <div className="auth-form-container">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="auth-title"
        >
          <h1>Online Exam Portal</h1>
        </motion.div>

        <div className="auth-card-wrapper">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="neo-card auth-card"
          >
            <div className="auth-header">
              <h2>Sign In</h2>
              <p style={{ color: 'var(--text-secondary)' }}>Welcome back, {isStudent ? 'Student' : 'Teacher'}.</p>
            </div>

            <form className="auth-form" onSubmit={handleLogin}>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="auth-error"
                >
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </motion.div>
              )}

              <div className="form-group">
                <label>{isStudent ? 'PRN' : 'Institutional Email'}</label>
                <input
                  type="text"
                  className="neo-input"
                  placeholder={isStudent ? "e.g. STU001" : "e.g. instructor@academy.edu"}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="neo-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button type="submit" className="neo-btn-primary auth-submit" disabled={loading}>
                {loading ? 'Logging in...' : 'Access Dashboard'} <LogIn size={18} />
              </button>


            </form>

            <div className="auth-footer">
              <p>Credentials incorrect? <Link to="/">Return to Role Selection</Link></p>
            </div>
          </motion.div>
        </div>
      </div>

      <style>{`
        .auth-page {
          display: flex;
          min-height: 100vh;
          width: 100%;
          background: var(--bg);
          position: relative;
          overflow: hidden;
          align-items: center;
          justify-content: center;
        }

        .auth-form-container {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          width: 100%;
          gap: 2rem;
        }

        .auth-title {
          text-align: center;
          color: var(--text-primary);
        }

        .auth-title h1 {
          font-family: var(--font-display);
          font-size: clamp(2rem, 5vw, 3.5rem);
          margin-bottom: 0.5rem;
          letter-spacing: -0.02em;
        }

        .auth-title p {
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.2em;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .auth-card-wrapper {
          width: 100%;
          max-width: 480px;
        }

        .auth-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 480px;
          padding: 3rem;
          background: var(--surface) !important;
          backdrop-filter: blur(20px);
          border: 1px solid var(--border) !important;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
        }

        .auth-header {
          text-align: center;
          margin-top: 1rem;
          margin-bottom: 2rem;
        }

        .auth-header h2 {
          font-size: 2.5rem;
          margin-bottom: 0.5rem;
          color: var(--text-primary) !important;
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .auth-error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: #ef4444;
            padding: 0.75rem 1rem;
            border-radius: var(--radius-sm);
            font-size: 0.875rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-group label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-secondary) !important;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .password-input-wrapper {
          position: relative;
        }

        .password-toggle {
          position: absolute;
          right: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          color: var(--text-muted) !important;
          border: none;
          cursor: pointer;
        }

        .password-toggle:hover {
          color: var(--accent);
        }

        .auth-submit {
          margin-top: 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          width: 100%;
        }

        .auth-footer {
          margin-top: 2rem;
          text-align: center;
          font-size: 0.875rem;
          color: var(--text-muted);
        }

        .auth-footer a {
            color: var(--accent);
            font-weight: 600;
            text-decoration: none;
        }

        @media (max-width: 768px) {
          .auth-card {
            padding: 2rem;
          }
          .auth-header h2 {
            font-size: 2rem;
          }
        }
      `}</style>
    </div>
  );
};

export default Login;
