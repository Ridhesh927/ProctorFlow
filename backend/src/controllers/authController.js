const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const logger = require('../utils/logger');

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in environment variables.');
}

const secureCookies = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

const getCookieOptions = () => ({
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/'
});

const setAuthCookie = (res, token) => {
    res.cookie('auth_token', token, getCookieOptions());
};

const sendInternalError = (res, message = 'Internal server error') => {
    res.status(500).json({ message });
};

const generateToken = (id, role, isMainAdmin = false) => {
    return jwt.sign({ id, role, isMainAdmin }, process.env.JWT_SECRET, {
        expiresIn: '24h'
    });
};

// Teacher Register
exports.registerTeacher = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO teachers (username, email, password) VALUES (?, ?, ?)',
            [username, email, hashedPassword]
        );

        logger('REGISTER_TEACHER', `New teacher registered: ${username} (${email})`, { id: result.insertId });

        res.status(201).json({ message: 'Teacher registered successfully', id: result.insertId });
    } catch (error) {
        logger('REGISTER_TEACHER_ERROR', `Failed to register teacher: ${req.body.email}`, { error: error.message });
        sendInternalError(res);
    }
};

// Teacher Login
exports.loginTeacher = async (req, res) => {
    try {
        const { email, password } = req.body;

        const [rows] = await pool.query('SELECT * FROM teachers WHERE email = ?', [email]);

        if (rows.length === 0) {
            logger('LOGIN_TEACHER_FAIL', `Invalid email: ${email}`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const teacher = rows[0];

        if (teacher.is_blocked) {
            logger('LOGIN_TEACHER_FAIL', `Blocked teacher attempted login: ${email}`);
            return res.status(403).json({ message: 'Your account has been suspended. Please contact the administrator.' });
        }

        const isMatch = await bcrypt.compare(password, teacher.password);

        if (!isMatch) {
            logger('LOGIN_TEACHER_FAIL', `Invalid password for: ${email}`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = generateToken(teacher.id, 'teacher', !!teacher.is_main_admin);

        // Store hashed token securely
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        await pool.query('UPDATE teachers SET last_token = ? WHERE id = ?', [hashedToken, teacher.id]);
        setAuthCookie(res, token);

        logger('LOGIN_TEACHER', `Teacher logged in: ${teacher.username} (${email})`, { id: teacher.id });

        res.json({ token, user: { id: teacher.id, username: teacher.username, email: teacher.email, role: 'teacher', isMainAdmin: !!teacher.is_main_admin } });
    } catch (error) {
        logger('LOGIN_TEACHER_ERROR', `Login error for: ${req.body.email}`, { error: error.message });
        sendInternalError(res, 'Login failed. Please try again.');
    }
};

// Student Register (PRN verification is implicit here, usually would check against a pre-registered list)
exports.registerStudent = async (req, res) => {
    try {
        const { username, email, password, prn_number } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO students (username, email, password, prn_number) VALUES (?, ?, ?, ?)',
            [username, email, hashedPassword, prn_number]
        );

        logger('REGISTER_STUDENT', `New student registered: ${username} (${email})`, { id: result.insertId, prn: prn_number });

        res.status(201).json({ message: 'Student registered successfully', id: result.insertId });
    } catch (error) {
        logger('REGISTER_STUDENT_ERROR', `Failed to register student: ${req.body.email}`, { error: error.message });
        sendInternalError(res);
    }
};

// Student Login
exports.loginStudent = async (req, res) => {
    try {
        const { prn_number, password } = req.body;

        const [rows] = await pool.query('SELECT * FROM students WHERE prn_number = ?', [prn_number]);

        if (rows.length === 0) {
            logger('LOGIN_STUDENT_FAIL', `Invalid PRN: ${prn_number}`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const student = rows[0];

        if (student.is_blocked) {
            logger('LOGIN_STUDENT_FAIL', `Blocked student attempted login: PRN ${prn_number}`);
            return res.status(403).json({ message: 'Your account has been suspended. Please contact your instructor.' });
        }

        const isMatch = await bcrypt.compare(password, student.password);

        if (!isMatch) {
            logger('LOGIN_STUDENT_FAIL', `Invalid password for PRN: ${prn_number}`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = generateToken(student.id, 'student');

        // Store hashed token securely
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        await pool.query('UPDATE students SET last_token = ? WHERE id = ?', [hashedToken, student.id]);
        setAuthCookie(res, token);

        logger('LOGIN_STUDENT', `Student logged in: ${student.username} (${student.email})`, { id: student.id, prn: student.prn_number });

        res.json({
            token,
            user: { id: student.id, username: student.username, email: student.email, role: 'student', prn: student.prn_number },
            message: 'Authenticated successfully'
        });
    } catch (error) {
        logger('LOGIN_STUDENT_ERROR', `Login error for PRN: ${req.body.prn_number}`, { error: error.message });
        sendInternalError(res, 'Login failed. Please try again.');
    }
};

exports.logout = async (req, res) => {
    try {
        const { id, role } = req.user;
        const table = role === 'teacher' ? 'teachers' : 'students';
        
        // Invalidate token in DB
        await pool.query(`UPDATE ${table} SET last_token = NULL WHERE id = ?`, [id]);
        
        // Clear cookie
        res.clearCookie('auth_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });

        logger('LOGOUT', `User ID: ${id} (${role}) logged out`);
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        logger('LOGOUT_ERROR', `Error during logout for user ID: ${req.user?.id}`, { error: error.message });
        sendInternalError(res, 'Logout failed');
    }
};

exports.changePassword = async (req, res) => {
    try {
        if (req.user.isMainAdmin) {
            return res.status(400).json({ message: 'Main Admin password cannot be changed.' });
        }
        const { oldPassword, newPassword } = req.body;
        const { id, role } = req.user;
        const table = role === 'teacher' ? 'teachers' : 'students';

        // Get current user
        const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

        const user = rows[0];

        // Block password changes for demo accounts
        if (user.email === 'teacher@test.com' || user.email === 'student@test.com') {
            return res.status(403).json({ message: 'Demo accounts cannot change their passwords.' });
        }

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            logger('CHANGE_PASSWORD_FAIL', `Incorrect old password for user ID: ${id} (${role})`);
            return res.status(401).json({ message: 'Incorrect old password' });
        }

        // Hash and update
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query(`UPDATE ${table} SET password = ? WHERE id = ?`, [hashedPassword, id]);

        logger('CHANGE_PASSWORD', `Password updated for user ID: ${id} (${role})`);

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        logger('CHANGE_PASSWORD_ERROR', `Error changing password for user ID: ${req.user.id}`, { error: error.message });
        sendInternalError(res);
    }
};

// ============ ADMIN ENDPOINTS ============

// Admin: Create Teacher
exports.adminCreateTeacher = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO teachers (username, email, password) VALUES (?, ?, ?)',
            [username, email, hashedPassword]
        );

        logger('ADMIN_CREATE_TEACHER', `Admin created teacher: ${username} (${email})`, { id: result.insertId });

        res.status(201).json({
            message: 'Teacher created successfully',
            teacher: { id: result.insertId, username, email }
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email already exists' });
        }
        sendInternalError(res);
    }
};

// Admin: Create Student
exports.adminCreateStudent = async (req, res) => {
    try {
        const { username, email, password, prn_number, department, year } = req.body;

        if (!username || !email || !password || !prn_number) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        let isDemoCreated = false;
        if (req.user && req.user.role === 'teacher') {
            const [teacherRows] = await pool.query('SELECT email FROM teachers WHERE id = ?', [req.user.id]);
            if (teacherRows.length > 0 && teacherRows[0].email === 'teacher@test.com') {
                const [countRows] = await pool.query('SELECT COUNT(*) as count FROM students WHERE created_by_demo = TRUE');
                if (countRows[0].count >= 3) {
                    return res.status(403).json({ message: 'Demo teacher can only create up to 3 student accounts.' });
                }
                isDemoCreated = true;
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO students (username, email, password, prn_number, department, year, created_by_demo) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, hashedPassword, prn_number, department || null, year || null, isDemoCreated]
        );

        logger('ADMIN_CREATE_STUDENT', `Admin created student: ${username} (${email})`, { id: result.insertId, prn: prn_number });

        res.status(201).json({
            message: 'Student created successfully',
            student: { id: result.insertId, username, email, prn_number, department, year }
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email or PRN already exists' });
        }
        sendInternalError(res);
    }
};

// Admin: Bulk Create Students
exports.adminCreateBulkStudents = async (req, res) => {
    try {
        const { students } = req.body; // Array of {username, email, password, prn_number}

        if (!Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ message: 'Students array is required' });
        }

        let isDemoCreated = false;
        if (req.user && req.user.role === 'teacher') {
            const [teacherRows] = await pool.query('SELECT email FROM teachers WHERE id = ?', [req.user.id]);
            if (teacherRows.length > 0 && teacherRows[0].email === 'teacher@test.com') {
                const [countRows] = await pool.query('SELECT COUNT(*) as count FROM students WHERE created_by_demo = TRUE');
                if (countRows[0].count + students.length > 3) {
                    return res.status(403).json({ message: `Demo teacher can only create up to 3 student accounts total. Current count: ${countRows[0].count}.` });
                }
                isDemoCreated = true;
            }
        }

        const results = { success: [], failed: [] };

        for (const student of students) {
            try {
                const { username, email, password, prn_number, department, year } = student;

                if (!username || !email || !password || !prn_number) {
                    results.failed.push({ student, reason: 'Missing required fields' });
                    continue;
                }

                const hashedPassword = await bcrypt.hash(password, 10);
                const [result] = await pool.query(
                    'INSERT INTO students (username, email, password, prn_number, department, year, created_by_demo) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [username, email, hashedPassword, prn_number, department || null, year || null, isDemoCreated]
                );

                results.success.push({ id: result.insertId, username, email, prn_number });
            } catch (error) {
                results.failed.push({ student, reason: error.message });
            }
        }

        logger('ADMIN_BULK_STUDENTS', `Bulk student creation: ${results.success.length} success, ${results.failed.length} failed`);

        res.status(201).json({
            message: `Created ${results.success.length} students, ${results.failed.length} failed`,
            results
        });
    } catch (error) {
        sendInternalError(res);
    }
};

// Admin: Bulk Create Teachers
exports.adminCreateBulkTeachers = async (req, res) => {
    try {
        const { teachers } = req.body; // Array of {username, email, password}

        if (!Array.isArray(teachers) || teachers.length === 0) {
            return res.status(400).json({ message: 'Teachers array is required' });
        }

        const results = { success: [], failed: [] };

        for (const teacher of teachers) {
            try {
                const { username, email, password } = teacher;

                if (!username || !email || !password) {
                    results.failed.push({ teacher, reason: 'Missing required fields' });
                    continue;
                }

                const hashedPassword = await bcrypt.hash(password, 10);
                const [result] = await pool.query(
                    'INSERT INTO teachers (username, email, password) VALUES (?, ?, ?)',
                    [username, email, hashedPassword]
                );

                results.success.push({ id: result.insertId, username, email });
            } catch (error) {
                results.failed.push({ teacher, reason: error.message });
            }
        }

        logger('ADMIN_BULK_TEACHERS', `Bulk teacher creation: ${results.success.length} success, ${results.failed.length} failed`);

        res.status(201).json({
            message: `Created ${results.success.length} teachers, ${results.failed.length} failed`,
            results
        });
    } catch (error) {
        sendInternalError(res);
    }
};

// Admin: Get All Teachers
exports.getAllTeachers = async (req, res) => {
    try {
        const [teachers] = await pool.query(
            'SELECT id, username, email, is_blocked, is_main_admin, created_at FROM teachers ORDER BY created_at DESC'
        );
        res.json({ teachers });
    } catch (error) {
        sendInternalError(res);
    }
};

// Admin: Get All Students
exports.getAllStudents = async (req, res) => {
    try {
        const [students] = await pool.query(
            'SELECT id, username, email, prn_number, department, year, is_blocked, created_at FROM students ORDER BY created_at DESC'
        );
        res.json({ students });
    } catch (error) {
        sendInternalError(res);
    }
};

// Admin: Delete User
exports.deleteUser = async (req, res) => {
    try {
        const { role, id } = req.params;

        if (role !== 'teacher' && role !== 'student') {
            return res.status(400).json({ message: 'Invalid role' });
        }

        if (role === 'teacher') {
            const [teacherRows] = await pool.query('SELECT is_main_admin, email FROM teachers WHERE id = ?', [id]);
            if (!teacherRows.length) return res.status(404).json({ message: 'User not found' });
            if (teacherRows[0].is_main_admin) {
                return res.status(403).json({ message: 'Main admin account cannot be deleted.' });
            }
            if (teacherRows[0].email === 'teacher@test.com') {
                return res.status(403).json({ message: 'Demo teacher account cannot be deleted.' });
            }
        } else if (role === 'student') {
            const [studentRows] = await pool.query('SELECT email FROM students WHERE id = ?', [id]);
            if (!studentRows.length) return res.status(404).json({ message: 'User not found' });
            if (studentRows[0].email === 'student@test.com') {
                return res.status(403).json({ message: 'Demo student account cannot be deleted.' });
            }
        }

        const table = role === 'teacher' ? 'teachers' : 'students';
        
        // Ensure cascading notification deletion
        await pool.query('DELETE FROM notifications WHERE user_id = ? AND user_type = ?', [id, role]);

        const [result] = await pool.query(`DELETE FROM ${table} WHERE id = ?`, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        logger('ADMIN_DELETE_USER', `Admin deleted ${role}: ID ${id}`);

        res.json({ message: `${role.charAt(0).toUpperCase() + role.slice(1)} deleted successfully` });
    } catch (error) {
        sendInternalError(res);
    }
};

// Admin: Bulk Delete Users
exports.bulkDeleteUsers = async (req, res) => {
    try {
        const { role } = req.params;
        const { ids } = req.body;

        if (role !== 'teacher' && role !== 'student') {
            return res.status(400).json({ message: 'Invalid role' });
        }

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'User IDs array is required' });
        }

        if (role === 'teacher') {
            const [protectedAdmins] = await pool.query(
                'SELECT id FROM teachers WHERE id IN (?) AND (is_main_admin = TRUE OR email = "teacher@test.com")',
                [ids]
            );
            if (protectedAdmins.length > 0) {
                return res.status(403).json({ message: 'Protected accounts (Main admin or Demo teacher) cannot be deleted.' });
            }
        } else if (role === 'student') {
            const [protectedStudents] = await pool.query(
                'SELECT id FROM students WHERE id IN (?) AND email = "student@test.com"',
                [ids]
            );
            if (protectedStudents.length > 0) {
                return res.status(403).json({ message: 'Demo student account cannot be deleted.' });
            }
        }

        const table = role === 'teacher' ? 'teachers' : 'students';
        
        // Ensure cascading notification deletion
        await pool.query('DELETE FROM notifications WHERE user_id IN (?) AND user_type = ?', [ids, role]);

        const [result] = await pool.query(`DELETE FROM ${table} WHERE id IN (?)`, [ids]);

        logger('ADMIN_BULK_DELETE', `Admin bulk deleted ${result.affectedRows} ${role}s`);

        res.json({ 
            message: `${result.affectedRows} ${role}s deleted successfully`,
            affectedRows: result.affectedRows 
        });
    } catch (error) {
        logger('ADMIN_BULK_DELETE_ERROR', `Failed bulk delete for ${req.params.role}`, { error: error.message });
        sendInternalError(res);
    }
};

// Admin: Toggle Block User
exports.toggleBlockUser = async (req, res) => {
    try {
        const { role, id } = req.params;

        if (role !== 'student' && role !== 'teacher') {
            return res.status(400).json({ message: 'Invalid role' });
        }

        const table = role === 'student' ? 'students' : 'teachers';
        const [rows] = await pool.query(
            role === 'teacher'
                ? 'SELECT is_blocked, is_main_admin FROM teachers WHERE id = ?'
                : 'SELECT is_blocked, FALSE as is_main_admin FROM students WHERE id = ?',
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

        if (role === 'teacher' && rows[0].is_main_admin) {
            return res.status(403).json({ message: 'Main admin account cannot be blocked.' });
        }

        const newStatus = !rows[0].is_blocked;
        await pool.query(`UPDATE ${table} SET is_blocked = ? WHERE id = ?`, [newStatus, id]);

        logger('ADMIN_TOGGLE_BLOCK', `Admin ${newStatus ? 'blocked' : 'unblocked'} ${role} ID ${id}`);

        res.json({ message: `${role.charAt(0).toUpperCase() + role.slice(1)} ${newStatus ? 'blocked' : 'unblocked'} successfully`, is_blocked: newStatus });
    } catch (error) {
        sendInternalError(res);
    }
};

