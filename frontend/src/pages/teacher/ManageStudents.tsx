import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
    UserPlus,
    Search,
    ShieldCheck,
    ShieldAlert,
    FileSpreadsheet,
    X,
    Loader2,
    Trash2,
    ChevronDown,
    Users,
    GraduationCap,
    Building2
} from 'lucide-react';
import DashboardLayout from '../../layouts/DashboardLayout';
import * as XLSX from 'xlsx';
import { TableRowSkeleton } from '../../components/Skeleton';

const DEPARTMENTS = [
    'Computer Science',
    'IT',
    'ALML'
];

const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];

const ManageStudents = () => {
    const [students, setStudents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [yearFilter, setYearFilter] = useState('All');
    const [deptFilter, setDeptFilter] = useState('All');
    const [showAddModal, setShowAddModal] = useState(false);
    const [newStudent, setNewStudent] = useState({ username: '', email: '', prn_number: '', password: 'Test@123', department: '', year: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [importSummary, setImportSummary] = useState<{ success: any[], failed: any[] } | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetchStudents();
    }, []);

    const fetchStudents = async () => {
        try {
            const response = await apiFetch('/api/auth/admin/students');
            const data = await response.json();
            if (!response.ok) {
                setFetchError(data.message || `Error ${response.status}`);
            } else if (data.students) {
                setStudents(data.students);
            }
        } catch (error: any) {
            setFetchError(error.message || 'Failed to connect to server.');
        } finally {
            setLoading(false);
        }
    };

    const handleAddStudent = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const response = await apiFetch('/api/auth/admin/create-student', {
                method: 'POST',
                body: JSON.stringify(newStudent)
            });
            if (response.ok) {
                setShowAddModal(false);
                setNewStudent({ username: '', email: '', prn_number: '', password: 'Test@123', department: '', year: '' });
                fetchStudents();
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to create student');
            }
        } catch (error: any) {
            alert(error.message || 'Error creating student');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws);

                if (data.length === 0) {
                    alert('The uploaded file is empty.');
                    return;
                }

                const firstRow: any = data[0];
                const hasName = 'Name' in firstRow || 'name' in firstRow || 'Username' in firstRow || 'username' in firstRow;
                const hasEmail = 'Email' in firstRow || 'email' in firstRow;
                const hasPRN = 'PRN' in firstRow || 'prn' in firstRow || 'prn_number' in firstRow;

                if (!hasName || !hasEmail || !hasPRN) {
                    alert('Invalid CSV format. Please ensure the file has at least Name, Email, and PRN columns.');
                    return;
                }

                const formattedStudents = data.map((row: any) => ({
                    username: row.Name || row.name || row.Username || row.username,
                    email: row.Email || row.email,
                    prn_number: row.PRN || row.prn || row.prn_number,
                    password: row.Password || row.password || 'Test@123',
                    department: row.Department || row.department || '',
                    year: row.Year || row.year || ''
                }));

                const response = await apiFetch('/api/auth/admin/bulk-students', {
                    method: 'POST',
                    body: JSON.stringify({ students: formattedStudents })
                });

                const resultData = await response.json();

                if (response.ok) {
                    setImportSummary(resultData.results);
                    fetchStudents();
                } else {
                    alert(resultData.message || 'Failed to import students');
                }
            } catch (error) {
                console.error('Error parsing file', error);
                alert('Error parsing file');
            }

            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsBinaryString(file);
    };

    const handleToggleBlock = async (studentId: string, currentStatus: boolean) => {
        try {
            const response = await apiFetch(`/api/auth/admin/user/student/${studentId}/toggle-block`, { method: 'PUT' });
            if (response.ok) {
                setStudents(prev => prev.map(s => s.id === studentId ? { ...s, is_blocked: !currentStatus } : s));
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to update student status');
            }
        } catch (error: any) {
            alert(error.message || 'Error updating student status');
        }
    };

    const handleDeleteStudent = (studentId: string, studentName: string) => {
        setDeleteConfirm({ id: studentId, name: studentName });
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        setIsDeleting(true);
        try {
            const response = await apiFetch(`/api/auth/admin/user/student/${deleteConfirm.id}`, { method: 'DELETE' });
            if (response.ok) {
                setStudents(prev => prev.filter(s => s.id !== deleteConfirm.id));
                setSelectedIds(prev => {
                    const next = new Set(prev);
                    next.delete(deleteConfirm.id);
                    return next;
                });
                setDeleteConfirm(null);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to delete student');
            }
        } catch (error: any) {
            alert(error.message || 'Error deleting student');
        } finally {
            setIsDeleting(false);
        }
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredStudents.length && filteredStudents.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredStudents.map(s => s.id)));
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleBulkDelete = async () => {
        setIsDeleting(true);
        try {
            const response = await apiFetch('/api/auth/admin/bulk-delete/student', {
                method: 'DELETE',
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });
            if (response.ok) {
                setStudents(prev => prev.filter(s => !selectedIds.has(s.id)));
                setSelectedIds(new Set());
                setShowBulkDeleteConfirm(false);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to delete selected students');
            }
        } catch (error: any) {
            alert(error.message || 'Error performing bulk deletion');
        } finally {
            setIsDeleting(false);
        }
    };

    // Derive unique departments and years from actual data for filter options
    const availableDepts = DEPARTMENTS;
    const availableYears = YEARS;

    const filteredStudents = students.filter(student => {
        const matchesSearch = student.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            student.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
            student.prn_number.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === 'All' ||
            (statusFilter === 'Active' && !student.is_blocked) ||
            (statusFilter === 'Blocked' && student.is_blocked);
        const matchesYear = yearFilter === 'All' || student.year === yearFilter;
        const matchesDept = deptFilter === 'All' || student.department === deptFilter;
        return matchesSearch && matchesStatus && matchesYear && matchesDept;
    });

    const totalActive = students.filter(s => !s.is_blocked).length;
    const totalBlocked = students.filter(s => s.is_blocked).length;

    return (
        <DashboardLayout userType="teacher">
            <div className="students-page">
                <header className="page-header">
                    <div>
                        <h1>Student Directory</h1>
                        <p className="text-secondary">Manage enrollment and academic access privileges.</p>
                    </div>
                    <div className="header-actions">
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept=".csv, .xlsx, .xls"
                            onChange={handleFileUpload}
                        />
                        <a href="/student_template.csv" download className="neo-btn-secondary" style={{ textDecoration: 'none' }}>
                            <FileSpreadsheet size={18} /> Template
                        </a>
                        <button className="neo-btn-secondary" onClick={() => fileInputRef.current?.click()}>
                            <FileSpreadsheet size={18} /> Import CSV/Excel
                        </button>
                        {selectedIds.size > 0 && (
                            <button className="neo-btn-delete shadow-sm" onClick={() => setShowBulkDeleteConfirm(true)}>
                                <Trash2 size={18} /> Delete Selected ({selectedIds.size})
                            </button>
                        )}
                        <button className="neo-btn-primary" onClick={() => setShowAddModal(true)}>
                            <UserPlus size={18} /> Add Student
                        </button>
                    </div>
                </header>

                {/* Summary Stats */}
                <div className="summary-row">
                    <div className="summary-chip">
                        <Users size={16} />
                        <span>Total: <strong>{students.length}</strong></span>
                    </div>
                    <div className="summary-chip active-chip">
                        <ShieldCheck size={16} />
                        <span>Active: <strong>{totalActive}</strong></span>
                    </div>
                    <div className="summary-chip blocked-chip">
                        <ShieldAlert size={16} />
                        <span>Blocked: <strong>{totalBlocked}</strong></span>
                    </div>
                </div>

                {/* Search + Filters */}
                <div className="controls-panel neo-card">
                    <div className="search-row">
                        <div className="search-bar">
                            <Search size={18} />
                            <input
                                type="text"
                                placeholder="Search by name, email or PRN..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="status-tabs">
                            {['All', 'Active', 'Blocked'].map(tab => (
                                <button
                                    key={tab}
                                    className={`filter-tab ${statusFilter === tab ? 'active' : ''}`}
                                    onClick={() => setStatusFilter(tab)}
                                >
                                    {tab === 'All' ? `All Students` : tab}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="filter-row">
                        <div className="filter-dropdown">
                            <Building2 size={15} />
                            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                                <option value="All">All Departments</option>
                                {availableDepts.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <ChevronDown size={14} className="dropdown-icon" />
                        </div>
                        <div className="filter-dropdown">
                            <GraduationCap size={15} />
                            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                                <option value="All">All Years</option>
                                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                            <ChevronDown size={14} className="dropdown-icon" />
                        </div>
                        {(deptFilter !== 'All' || yearFilter !== 'All') && (
                            <button className="clear-filters" onClick={() => { setDeptFilter('All'); setYearFilter('All'); }}>
                                <X size={14} /> Clear Filters
                            </button>
                        )}
                        <span className="result-count">{filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''} found</span>
                    </div>
                </div>

                {/* Student List */}
                <div className="student-list-container neo-card">
                    {/* List Header */}
                    <div className="list-header">
                        <span className="col-checkbox">
                            <input 
                                type="checkbox" 
                                checked={filteredStudents.length > 0 && selectedIds.size === filteredStudents.length}
                                onChange={toggleSelectAll}
                                className="neo-checkbox"
                            />
                        </span>
                        <span className="col-name">Student</span>
                        <span className="col-prn">PRN</span>
                        <span className="col-dept">Department</span>
                        <span className="col-year">Year</span>
                        <span className="col-status">Status</span>
                        <span className="col-joined">Joined</span>
                        <span className="col-actions">Actions</span>
                    </div>

                    <div className="list-body">
                        {loading ? (
                            <div className="loading-skeletons">
                                {[1, 2, 3, 4, 5].map(i => <TableRowSkeleton key={i} />)}
                            </div>
                        ) : fetchError ? (
                            <div className="empty-state" style={{ color: '#ef4444' }}>
                                <p>❌ Error loading students: {fetchError}</p>
                                <p style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>Check browser console (F12) for details.</p>
                            </div>
                        ) : filteredStudents.length === 0 ? (
                            <div className="empty-state">
                                <Users size={40} style={{ opacity: 0.3 }} />
                                <p>No students found matching your criteria.</p>
                            </div>
                        ) : (
                            filteredStudents.map((student, i) => (
                                <motion.div
                                    key={student.id}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.02 }}
                                    className={`list-row ${selectedIds.has(student.id) ? 'selected' : ''}`}
                                >
                                    <div className="col-checkbox">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedIds.has(student.id)}
                                            onChange={() => toggleSelect(student.id)}
                                            className="neo-checkbox"
                                        />
                                    </div>
                                    <div className="col-name">
                                        <div className="avatar-sm">{student.username.charAt(0).toUpperCase()}</div>
                                        <div className="name-email">
                                            <span className="student-name">{student.username}</span>
                                            <span className="student-email">{student.email}</span>
                                        </div>
                                    </div>
                                    <span className="col-prn">
                                        <code>{student.prn_number}</code>
                                    </span>
                                    <span className="col-dept">
                                        {student.department || <span className="text-muted">—</span>}
                                    </span>
                                    <span className="col-year">
                                        {student.year || <span className="text-muted">—</span>}
                                    </span>
                                    <span className="col-status">
                                        <span className={`status-pill ${!student.is_blocked ? 'active' : 'blocked'}`}>
                                            {!student.is_blocked ? 'Active' : 'Blocked'}
                                        </span>
                                    </span>
                                    <span className="col-joined">
                                        {new Date(student.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </span>
                                    <div className="col-actions">
                                        <button
                                            onClick={() => handleToggleBlock(student.id, student.is_blocked)}
                                            className={`action-btn ${!student.is_blocked ? 'block-btn' : 'unblock-btn'}`}
                                            title={!student.is_blocked ? 'Block Student' : 'Unblock Student'}
                                        >
                                            {!student.is_blocked ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                                        </button>
                                        <button
                                            onClick={() => handleDeleteStudent(student.id, student.username)}
                                            className="action-btn delete-btn"
                                            title="Delete Student"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </div>

                {/* Add Student Modal */}
                <AnimatePresence>
                    {showAddModal && (
                        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="modal-content"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="modal-header-simple">
                                    <h2>Add New Student</h2>
                                    <button onClick={() => setShowAddModal(false)} className="close-btn"><X size={20} /></button>
                                </div>
                                <form onSubmit={handleAddStudent} className="modal-form">
                                    <div className="form-group">
                                        <label>Full Name</label>
                                        <input type="text" required className="neo-input" value={newStudent.username}
                                            onChange={(e) => setNewStudent({ ...newStudent, username: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Email Address</label>
                                        <input type="email" required className="neo-input" value={newStudent.email}
                                            onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>PRN Number</label>
                                        <input type="text" required className="neo-input" value={newStudent.prn_number}
                                            onChange={(e) => setNewStudent({ ...newStudent, prn_number: e.target.value })} />
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Department</label>
                                            <select required className="neo-input" value={newStudent.department}
                                                onChange={(e) => setNewStudent({ ...newStudent, department: e.target.value })}>
                                                <option value="">Select Department</option>
                                                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Year</label>
                                            <select required className="neo-input" value={newStudent.year}
                                                onChange={(e) => setNewStudent({ ...newStudent, year: e.target.value })}>
                                                <option value="">Select Year</option>
                                                {YEARS.map(y => <option key={y}>{y}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <button type="submit" className="neo-btn-primary full-width" disabled={isSubmitting}>
                                        {isSubmitting ? 'Creating...' : 'Create Student Account'}
                                    </button>
                                </form>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                {/* Import Summary Modal */}
                <AnimatePresence>
                    {importSummary && (
                        <div className="modal-overlay" onClick={() => setImportSummary(null)}>
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="modal-content"
                                style={{ maxWidth: '600px' }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="modal-header-simple">
                                    <h2>Import Results</h2>
                                    <button onClick={() => setImportSummary(null)} className="close-btn"><X size={20} /></button>
                                </div>
                                <div className="import-stats">
                                    <div className="import-stat success">
                                        <h3>{importSummary.success.length}</h3>
                                        <span>Successfully Added</span>
                                    </div>
                                    <div className="import-stat error">
                                        <h3>{importSummary.failed.length}</h3>
                                        <span>Failed</span>
                                    </div>
                                </div>
                                <div className="import-details">
                                    {importSummary.failed.length > 0 && (
                                        <div className="failed-list">
                                            <h4><ShieldAlert size={16} /> Failed Rows</h4>
                                            <ul>
                                                {importSummary.failed.map((f: any, i: number) => (
                                                    <li key={i} className="failed-item">
                                                        <strong>{f.student.username || f.student.email || 'Unknown'}</strong>
                                                        <span>{f.reason}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {importSummary.success.length > 0 && (
                                        <div className="success-list">
                                            <h4><ShieldCheck size={16} /> Added Successfully</h4>
                                            <div className="success-chips">
                                                {importSummary.success.map((s: any, i: number) => (
                                                    <span key={i} className="success-chip">
                                                        {s.username} <span className="text-muted">({s.prn_number})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <button onClick={() => setImportSummary(null)} className="neo-btn-primary full-width" style={{ marginTop: '1.5rem' }}>
                                    Done
                                </button>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                {/* Delete Confirmation Modal */}
                <AnimatePresence>
                    {deleteConfirm && (
                        <div className="modal-overlay" onClick={() => !isDeleting && setDeleteConfirm(null)}>
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="delete-modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="delete-icon-wrapper">
                                    <Trash2 size={28} />
                                </div>
                                <h3>Delete Student</h3>
                                <p>Are you sure you want to permanently delete <strong>{deleteConfirm.name}</strong>? This action cannot be undone and all associated data (exam results, sessions) will be removed.</p>
                                <div className="delete-modal-actions">
                                    <button
                                        className="cancel-btn"
                                        onClick={() => setDeleteConfirm(null)}
                                        disabled={isDeleting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="confirm-delete-btn"
                                        onClick={confirmDelete}
                                        disabled={isDeleting}
                                    >
                                        {isDeleting ? <><Loader2 size={16} className="animate-spin" /> Deleting...</> : <><Trash2 size={16} /> Delete Student</>}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                {/* Bulk Delete Confirmation Modal */}
                <AnimatePresence>
                    {showBulkDeleteConfirm && (
                        <div className="modal-overlay" onClick={() => !isDeleting && setShowBulkDeleteConfirm(false)}>
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="delete-modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="delete-icon-wrapper bulk">
                                    <Trash2 size={28} />
                                </div>
                                <h3>Delete {selectedIds.size} Students</h3>
                                <p>Are you sure you want to permanently delete <strong>{selectedIds.size}</strong> selected students? This action cannot be undone and all associated data for ALL selected students will be removed.</p>
                                <div className="delete-modal-actions">
                                    <button
                                        className="cancel-btn"
                                        onClick={() => setShowBulkDeleteConfirm(false)}
                                        disabled={isDeleting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="confirm-delete-btn"
                                        onClick={handleBulkDelete}
                                        disabled={isDeleting}
                                    >
                                        {isDeleting ? <><Loader2 size={16} className="animate-spin" /> Deleting...</> : <><Trash2 size={16} /> Delete Selected Students</>}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                <style>{`
          .students-page { display: flex; flex-direction: column; gap: 1.5rem; }
          .page-header { display: flex; justify-content: space-between; align-items: center; }
          .page-header h1 { font-size: 2.25rem; margin-bottom: 0.5rem; font-family: var(--font-display); }

          .header-actions { display: flex; gap: 0.75rem; }
          .neo-btn-secondary { display: flex; align-items: center; gap: 0.6rem; padding: 0.65rem 1.1rem; background: var(--surface-low); border: 1px solid var(--border); color: var(--text-primary); font-weight: 600; font-size: 0.8125rem; border-radius: var(--radius-sm); transition: var(--transition-fast); cursor: pointer; }
          .neo-btn-secondary:hover { background: var(--surface-high); }

          /* Summary row */
          .summary-row { display: flex; gap: 1rem; }
          .summary-chip { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; background: var(--surface-low); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.8125rem; color: var(--text-secondary); }
          .summary-chip strong { color: var(--text-primary); }
          .summary-chip.active-chip { border-color: rgba(16, 185, 129, 0.3); }
          .summary-chip.active-chip svg { color: #10b981; }
          .summary-chip.blocked-chip { border-color: rgba(239, 68, 68, 0.3); }
          .summary-chip.blocked-chip svg { color: #ef4444; }

          /* Controls panel */
          .controls-panel { padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; background: var(--surface-low); border: 1px solid var(--border); border-radius: var(--radius-md); }
          .search-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
          .search-bar { display: flex; align-items: center; gap: 0.75rem; color: var(--text-muted); flex: 1; max-width: 400px; background: var(--surface); padding: 0.6rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border); transition: var(--transition-fast); }
          .search-bar:focus-within { border-color: var(--border-focus); box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.15); }
          .search-bar input { background: none; color: var(--text-primary); border: none; outline: none; width: 100%; font-size: 0.875rem; }
          .status-tabs { display: flex; gap: 0.25rem; background: var(--surface); padding: 0.25rem; border-radius: var(--radius-sm); border: 1px solid var(--border); }

          .filter-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
          .filter-dropdown { 
            display: flex; 
            align-items: center; 
            gap: 0.5rem; 
            background: var(--surface); 
            padding: 0.45rem 0.85rem; 
            border-radius: var(--radius-sm); 
            border: 1px solid var(--border); 
            position: relative; 
            color: var(--text-secondary); 
            transition: var(--transition-fast);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          }
          .filter-dropdown:hover {
            border-color: var(--border-focus);
            background: var(--surface-high);
          }
          .filter-dropdown:focus-within {
            border-color: var(--border-focus);
            box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.2);
          }
          .filter-dropdown svg:first-child { flex-shrink: 0; color: var(--accent); opacity: 0.85; }
          .filter-dropdown select { 
            background: transparent; 
            border: none; 
            outline: none; 
            color: var(--text-primary); 
            font-size: 0.8125rem; 
            font-weight: 500;
            appearance: none; 
            -webkit-appearance: none;
            -moz-appearance: none;
            padding-right: 1.5rem; 
            cursor: pointer; 
            min-width: 140px; 
            font-family: var(--font-body);
          }
          .filter-dropdown select option {
            background-color: #1d1912;
            color: #FDFBD4;
            padding: 8px;
          }
          :root[data-theme='light'] .filter-dropdown select option,
          [data-theme='light'] .filter-dropdown select option {
            background-color: #ffffff;
            color: #14120e;
          }
          .dropdown-icon { 
            position: absolute; 
            right: 0.65rem; 
            pointer-events: none; 
            color: var(--text-secondary);
            opacity: 0.6; 
            transition: var(--transition-fast);
          }
          .filter-dropdown:hover .dropdown-icon {
            opacity: 1;
            color: var(--accent);
          }
          .clear-filters { display: flex; align-items: center; gap: 0.35rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; padding: 0.4rem 0.75rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: var(--transition-fast); }
          .clear-filters:hover { background: rgba(239, 68, 68, 0.2); }
          .result-count { margin-left: auto; font-size: 0.8125rem; color: var(--text-muted); }

          .filter-tab { padding: 0.45rem 0.9rem; border: none; background: none; color: var(--text-muted); font-size: 0.8125rem; font-weight: 600; cursor: pointer; border-radius: calc(var(--radius-sm) - 2px); transition: var(--transition-fast); }
          .filter-tab:hover { color: var(--text-primary); }
          .filter-tab.active { background: var(--accent); color: #000; }

          /* Student list */
          .student-list-container { padding: 0; overflow: hidden; background: var(--surface-low); }
          .list-header { display: grid; grid-template-columns: 40px 2fr 1fr 1.5fr 1fr 0.8fr 1fr 0.7fr; padding: 0.9rem 1.5rem; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
          .list-body { max-height: 520px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--surface-high) transparent; }
          .list-body::-webkit-scrollbar { width: 6px; }
          .list-body::-webkit-scrollbar-track { background: transparent; }
          .list-body::-webkit-scrollbar-thumb { background: var(--surface-high); border-radius: 3px; }

          .list-row { display: grid; grid-template-columns: 40px 2fr 1fr 1.5fr 1fr 0.8fr 1fr 0.7fr; padding: 0.85rem 1.5rem; border-bottom: 1px solid var(--border); align-items: center; transition: background 0.15s ease; }
          .list-row:last-child { border-bottom: none; }
          .list-row:hover { background: rgba(255,255,255,0.02); }

          .col-name { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
          .avatar-sm { width: 36px; height: 36px; min-width: 36px; background: var(--surface-high); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.875rem; font-weight: 700; color: var(--accent); }
          .name-email { display: flex; flex-direction: column; min-width: 0; }
          .student-name { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .student-email { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

          .col-prn code { font-size: 0.8125rem; background: var(--surface-high); padding: 0.15rem 0.5rem; border-radius: 4px; color: var(--text-secondary); font-family: 'JetBrains Mono', monospace; }
          .col-dept, .col-year, .col-joined { font-size: 0.8125rem; color: var(--text-secondary); }
          .col-status { font-size: 0.8125rem; }
          .text-muted { color: var(--text-muted); }

          .status-pill { display: inline-flex; align-items: center; padding: 0.2rem 0.65rem; border-radius: 20px; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
          .status-pill.active { background: rgba(16, 185, 129, 0.1); color: #10b981; }
          .status-pill.blocked { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
 
          .neo-btn-delete { display: flex; align-items: center; gap: 0.6rem; padding: 0.65rem 1.1rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; font-weight: 600; font-size: 0.8125rem; border-radius: var(--radius-sm); transition: var(--transition-fast); cursor: pointer; }
          .neo-btn-delete:hover { background: rgba(239, 68, 68, 0.2); }
 
          .col-checkbox { display: flex; align-items: center; justify-content: center; width: 40px; }
          .neo-checkbox { width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface-high); cursor: pointer; accent-color: var(--accent); }
          .list-row.selected { background: rgba(255, 255, 255, 0.05); }
          .list-row.selected:hover { background: rgba(255, 255, 255, 0.08); }
 
          .col-actions { display: flex; gap: 0.35rem; }
          .action-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; background: var(--surface-high); color: var(--text-muted); }
          .action-btn:hover { color: var(--text-primary); }
          .block-btn:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
          .unblock-btn:hover { background: rgba(16, 185, 129, 0.15); color: #10b981; }
          .delete-btn:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

          .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem; color: var(--text-muted); gap: 0.75rem; text-align: center; }
          .empty-state p { font-size: 0.9375rem; margin: 0; }

          /* Modal */
          .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 1000; display: flex; justify-content: center; align-items: center; }
          .modal-content { background: var(--bg); border: 1px solid var(--border); width: 100%; max-width: 480px; border-radius: var(--radius-md); padding: 2rem; }
          .modal-header-simple { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
          .modal-header-simple h2 { margin: 0; font-size: 1.375rem; }
          .close-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0.25rem; }
          .close-btn:hover { color: var(--text-primary); }

          /* Delete Modal */
          .delete-modal { background: var(--bg); border: 1px solid var(--border); width: 100%; max-width: 420px; border-radius: var(--radius-md); padding: 2.5rem 2rem; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1rem; }
          .delete-icon-wrapper { width: 64px; height: 64px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center; margin-bottom: 0.5rem; }
          .delete-icon-wrapper.bulk { background: rgba(239, 68, 68, 0.2); }
          .delete-modal h3 { font-size: 1.5rem; margin: 0; color: var(--text-primary); }
          .delete-modal p { color: var(--text-secondary); font-size: 0.9375rem; line-height: 1.5; margin: 0; }
          .delete-modal-actions { display: flex; gap: 1rem; width: 100%; margin-top: 1.5rem; }
          .cancel-btn, .confirm-delete-btn { flex: 1; padding: 0.75rem; border-radius: var(--radius-sm); font-weight: 600; font-size: 0.875rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; cursor: pointer; transition: all 0.2s; border: none; }
          .cancel-btn { background: var(--surface-high); color: var(--text-primary); }
          .cancel-btn:hover { background: var(--border); }
          .confirm-delete-btn { background: #ef4444; color: white; }
          .confirm-delete-btn:hover { background: #dc2626; }
          .confirm-delete-btn:disabled { opacity: 0.7; cursor: not-allowed; }
          .modal-form { display: flex; flex-direction: column; gap: 1rem; }
          .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
          .form-group label { font-size: 0.8125rem; color: var(--text-secondary); font-weight: 600; }
          .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
          .neo-input { background: var(--surface-low); border: 1px solid var(--border); padding: 0.7rem 0.85rem; border-radius: var(--radius-sm); color: var(--text-primary); font-size: 0.875rem; }
          .neo-input:focus { border-color: var(--accent); outline: none; }
          .full-width { width: 100%; justify-content: center; margin-top: 0.5rem; }

          /* Import summary */
          .import-stats { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
          .import-stat { flex: 1; padding: 1.25rem; border-radius: 8px; }
          .import-stat.success { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); }
          .import-stat.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); }
          .import-stat h3 { font-size: 2rem; margin: 0; }
          .import-stat.success h3 { color: #10b981; }
          .import-stat.error h3 { color: #ef4444; }
          .import-stat span { font-size: 0.8125rem; color: var(--text-muted); }
          .import-details { max-height: 350px; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem; }
          .failed-list h4, .success-list h4 { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.875rem; }
          .failed-list h4 { color: #ef4444; }
          .success-list h4 { color: #10b981; }
          .failed-list ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
          .failed-item { padding: 0.75rem 1rem; background: var(--surface-high); border-radius: 6px; font-size: 0.8125rem; display: flex; flex-direction: column; gap: 0.25rem; border-left: 3px solid #ef4444; }
          .failed-item strong { color: var(--text-primary); }
          .failed-item span { color: var(--text-secondary); }
          .success-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
          .success-chip { padding: 0.4rem 0.7rem; background: var(--surface-high); border-radius: 20px; font-size: 0.75rem; border: 1px solid var(--border); }

          @media (max-width: 900px) {
            .page-header { flex-direction: column; align-items: flex-start; gap: 1.25rem; }
            .header-actions { width: 100%; flex-wrap: wrap; }
            .search-row { flex-direction: column; align-items: stretch; }
            .list-header, .list-row { grid-template-columns: 40px 2fr 1fr 1fr 0.7fr; }
            .col-dept, .col-joined, .col-year { display: none; }
          }
          @media (max-width: 600px) {
            .summary-row { flex-wrap: wrap; }
            .filter-row { flex-direction: column; align-items: stretch; }
            .result-count { margin-left: 0; }
          }
        `}</style>
            </div>
        </DashboardLayout>
    );
};

export default ManageStudents;
