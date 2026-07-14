import { useState, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  LogOut,
  Bell,
  ShieldAlert,
  TrendingUp,
  Settings,
  Sparkles,
  Briefcase
} from 'lucide-react';
import { getUser, clearAuth } from '../utils/auth';
import { apiFetch } from '../utils/api';
import ThemeToggle from '../components/ThemeToggle';



interface DashboardLayoutProps {
  children: ReactNode;
  userType: 'student' | 'teacher';
}



const DashboardLayout = ({ children, userType }: DashboardLayoutProps) => {
  const navigate = useNavigate();
  const [userName, setUserName] = useState(userType === 'student' ? 'Scholar Name' : 'Instructor Name');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const user = getUser(userType);
    if (user?.name) setUserName(user.name);
    else if (user?.username) setUserName(user.username);
    
    fetchNotifications();
    // Poll every 60 seconds
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [userType]);

  const fetchNotifications = async () => {
    try {
      const res = await apiFetch('/api/notifications');
      const data = await res.json();
      if (data.success) {
        setNotifications(data.notifications);
        setUnreadCount(data.notifications.filter((n: any) => !n.is_read).length);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  const markAsRead = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await apiFetch('/api/notifications/mark-all-read', { method: 'PUT' });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  const handleLogout = () => {
    clearAuth(userType);
    navigate('/login');
  };

  const user = getUser(userType);
  const isMainAdmin = user?.isMainAdmin;

  const teacherNavItems = [
    { icon: <LayoutDashboard size={20} />, label: 'Dashboard', path: '/teacher/dashboard' },
    { icon: <BookOpen size={20} />, label: 'Manage Exams', path: '/teacher/exams' },
    { icon: <ShieldAlert size={20} />, label: 'Live Proctoring', path: '/teacher/proctor' },
    { icon: <TrendingUp size={20} />, label: 'View Results', path: '/teacher/results' },
    { icon: <Users size={20} />, label: 'Students', path: '/teacher/students' },
    { icon: <Briefcase size={20} />, label: 'Placement Cell', path: '/teacher/jobs' }
  ];

  if (isMainAdmin) {
    teacherNavItems.push({ icon: <Users size={20} />, label: 'Manage Teachers', path: '/admin/teachers' });
  }

  const navItems = userType === 'student' ? [
    { icon: <LayoutDashboard size={20} />, label: 'Overview', path: '/student/dashboard' },
    { icon: <BookOpen size={20} />, label: 'Available Exams', path: '/student/exams' },
    { icon: <TrendingUp size={20} />, label: 'My Results', path: '/student/results' },
    { icon: <Sparkles size={20} />, label: 'Interview Prep', path: '/student/interview-prep' },
    { icon: <Briefcase size={20} />, label: 'Job Board', path: '/student/jobs' },
    { icon: <Settings size={20} />, label: 'Settings', path: '/student/settings' },
  ] : teacherNavItems;

  return (
    <div className="dashboard-root">

      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-dot"></div>
          <span>Online Examination</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.icon}
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <LogOut size={20} />
            <span className="nav-label">Logout</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="content-header">
          <div className="header-search">
            <span className="text-muted">Academic Session: {new Date().getFullYear()}-{String(new Date().getFullYear() + 1).slice(-2)}</span>
          </div>
          <div className="header-actions">
              <div className="dropdown-container">
                <button
                  className={`icon-btn ${showNotifications ? 'active' : ''}`}
                  onClick={() => { setShowNotifications(!showNotifications); setShowProfileMenu(false); }}
                  style={{ position: 'relative' }}
                >
                  <Bell size={20} />
                  {unreadCount > 0 && <span className="notification-dot">{unreadCount}</span>}
                </button>
                <AnimatePresence>
                  {showNotifications && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="header-dropdown notifications-dropdown"
                    >
                      <div className="dropdown-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4>Notifications</h4>
                        {unreadCount > 0 && (
                          <button onClick={markAllAsRead} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>Mark all read</button>
                        )}
                      </div>
                      <div className="dropdown-body">
                        {notifications.length > 0 ? (
                          <div className="notifications-list">
                            {notifications.map((n) => (
                              <div 
                                key={n.id} 
                                className={`notification-item ${!n.is_read ? 'unread' : ''}`}
                                onClick={() => {
                                  if (!n.is_read) markAsRead(n.id);
                                  if (n.link) navigate(n.link);
                                  setShowNotifications(false);
                                }}
                              >
                                <div className="notification-icon">
                                  <Bell size={16} />
                                </div>
                                <div className="notification-content">
                                  <p className="notification-title">{n.title}</p>
                                  <p className="notification-desc">{n.message}</p>
                                  <span className="notification-time">{new Date(n.created_at).toLocaleDateString()}</span>
                                </div>
                                {!n.is_read && <div className="unread-indicator"></div>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                            <Bell size={32} className="text-muted" style={{ margin: '0 auto 10px' }} />
                            <p>You're all caught up!</p>
                            <span className="text-muted" style={{ fontSize: '0.75rem' }}>No new alerts or warnings.</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

            <div className="theme-toggle-slot">
              <ThemeToggle variant="header" />
            </div>

            <div className="dropdown-container">
              <div
                className="user-profile-brief clickable"
                onClick={() => { setShowProfileMenu(!showProfileMenu); setShowNotifications(false); }}
              >
                <div className="avatar-placeholder">{userName.charAt(0).toUpperCase()}</div>
                <div className="profile-info">
                  <p className="profile-name">{userName}</p>
                  <p className="profile-role">{userType === 'student' ? 'Student' : 'Teacher'}</p>
                </div>
              </div>
              <AnimatePresence>
                {showProfileMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="header-dropdown profile-dropdown"
                  >
                    <div className="dropdown-header profile-dropdown-header">
                      <p className="profile-name">{userName}</p>
                      <p className="profile-role">{userType === 'student' ? 'Student Account' : 'Instructor Account'}</p>
                    </div>
                    <button className="dropdown-item" onClick={() => navigate(`/${userType}/settings`)}>
                      <Settings size={16} /> Account Settings
                    </button>
                    <div className="dropdown-divider"></div>
                    <button className="dropdown-item danger" onClick={handleLogout}>
                      <LogOut size={16} /> Sign Out Session
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <section className="page-body">
          {children}
        </section>
      </main>

      <style>{`
        .dashboard-root {
          display: flex;
          height: 100vh;
          background: var(--bg);
          position: relative;
          overflow: hidden;
        }

        .sidebar {
          width: 280px;
          background: var(--sidebar-bg);
          backdrop-filter: blur(20px);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          height: 100vh;
          flex-shrink: 0;
        }

        .sidebar-brand {
          padding: 2rem 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-family: var(--font-display);
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--accent);
        }

        .brand-dot {
          width: 12px;
          height: 12px;
          background: var(--accent);
          border-radius: 50%;
        }

        .sidebar-nav {
          flex: 1;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.875rem 1.25rem;
          color: var(--text-secondary);
          border-radius: var(--radius-sm);
          font-weight: 500;
          transition: var(--transition-fast);
        }

        .nav-item:hover {
          background: var(--surface);
          color: var(--text-primary);
        }

        .nav-item.active {
          background: var(--surface-high);
          color: var(--accent);
          border-left: 3px solid var(--accent);
        }

        .nav-label { font-size: 0.9375rem; }

        .sidebar-footer {
          padding: 1.5rem;
          border-top: 1px solid var(--border);
          background: transparent;
        }

        .logout-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.875rem 1.25rem;
          background: none;
          color: var(--text-muted);
          text-align: left;
        }

        .logout-btn:hover {
          color: var(--error);
        }

        .main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: transparent;
          position: relative;
          z-index: 1;
          height: 100vh;
          overflow-y: auto;
        }

        .content-header {
          height: 80px;
          padding: 0 5rem 0 2.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
          background: var(--header-bg);
          opacity: 0.95;
          backdrop-filter: blur(10px);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .theme-toggle-slot {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: 0.25rem;
        }

        .icon-btn {
          width: 36px;
          height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-secondary);
          position: relative;
          flex-shrink: 0;
        }

        .icon-btn:hover {
          color: var(--accent);
          background: var(--surface-high);
          border-color: var(--border);
        }

        .notification-dot {
          position: absolute;
          top: -5px;
          right: -5px;
          background: #ef4444;
          color: white;
          font-size: 0.65rem;
          font-weight: 700;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid var(--bg);
        }

        .notifications-list {
          display: flex;
          flex-direction: column;
        }

        .notification-item {
          display: flex;
          gap: 0.75rem;
          padding: 1rem;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
          transition: background 0.2s ease;
          position: relative;
        }

        .notification-item:hover {
          background: var(--surface);
        }

        .notification-item.unread {
          background: rgba(var(--accent-rgb), 0.05);
        }

        .notification-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--surface-high);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
          flex-shrink: 0;
        }

        .notification-content {
          flex: 1;
        }

        .notification-title {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--text-primary);
          margin-bottom: 2px;
        }

        .notification-desc {
          font-size: 0.8125rem;
          color: var(--text-secondary);
          line-height: 1.4;
          margin-bottom: 4px;
        }

        .notification-time {
          font-size: 0.7rem;
          color: var(--text-muted);
        }

        .unread-indicator {
          width: 6px;
          height: 6px;
          background: var(--accent);
          border-radius: 50%;
          position: absolute;
          top: 1rem;
          right: 1rem;
        }

        .user-profile-brief {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding-left: 1.5rem;
          border-left: 1px solid var(--border);
        }

        .avatar-placeholder {
          width: 36px;
          height: 36px;
          background: var(--surface-high);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: var(--accent);
        }

        .profile-name { font-weight: 600; font-size: 0.875rem; color: var(--text-primary); }
        .profile-role { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }

        .dropdown-container {
            position: relative;
          display: flex;
          align-items: center;
        }

        .icon-btn.active {
            color: var(--accent);
            background: var(--surface-high);
          border-color: var(--border);
        }

        .user-profile-brief.clickable {
            cursor: pointer;
            padding: 0.5rem 0.5rem 0.5rem 1.5rem;
            border-radius: var(--radius-sm);
            transition: background 0.2s ease;
        }

        .user-profile-brief.clickable:hover {
            background: var(--surface);
        }

        .header-dropdown {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            background: var(--surface-low);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
            z-index: 100;
            overflow: hidden;
            border-top: 2px solid var(--accent);
        }

        .notifications-dropdown {
            width: 320px;
        }

        .profile-dropdown {
            width: 240px;
        }

        .dropdown-header {
            padding: 1rem;
            border-bottom: 1px solid var(--border);
            background: var(--surface);
        }

        .dropdown-header h4 {
            margin: 0;
            font-size: 0.9375rem;
            color: var(--text-primary);
        }

        .profile-dropdown-header {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            padding: 1.25rem 1rem;
        }

        .dropdown-body {
            padding: 1rem;
            max-height: 300px;
            overflow-y: auto;
        }

        .dropdown-body.empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 3rem 1rem;
            text-align: center;
        }

        .dropdown-body.empty-state p {
            margin: 0;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .dropdown-item {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.875rem 1rem;
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 0.875rem;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s ease;
        }

        .dropdown-item:hover {
            background: var(--surface);
            color: var(--text-primary);
            padding-left: 1.5rem;
        }

        .dropdown-item.danger {
            color: var(--error);
        }

        .dropdown-item.danger:hover {
            background: rgba(239, 68, 68, 0.05);
            color: var(--error);
        }

        .dropdown-divider {
            height: 1px;
            background: var(--border);
            margin: 0;
        }

        .page-body {
          padding: 2.5rem;
          flex: 1;
        }

        @media (max-width: 1024px) {
          .sidebar { width: 80px; }
          .nav-label, .sidebar-brand span, .profile-info { display: none; }
          .sidebar-brand { padding: 1.5rem; justify-content: center; }
          .user-profile-brief { border: none; padding: 0; }
        }
      `}</style>
    </div>
  );
};

export default DashboardLayout;
