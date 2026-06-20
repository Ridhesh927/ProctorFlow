const { pool } = require('../../src/config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const getTestTeacherToken = async (isMainAdmin = false) => {
    const email = `teacher_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
    const password = await bcrypt.hash('password123', 10);
    
    const [result] = await pool.query(
        'INSERT INTO teachers (username, email, password, is_main_admin) VALUES (?, ?, ?, ?)',
        [`Teacher ${Date.now()}`, email, password, isMainAdmin]
    );
    
    const token = jwt.sign({ id: result.insertId, role: 'teacher', isMainAdmin }, process.env.JWT_SECRET, { expiresIn: '24h' });
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    await pool.query('UPDATE teachers SET last_token = ? WHERE id = ?', [hashedToken, result.insertId]);
    
    return { token, id: result.insertId, email, password: 'password123' };
};

const getTestStudentToken = async () => {
    const email = `student_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
    const password = await bcrypt.hash('password123', 10);
    const prn = `PRN${Date.now()}${Math.random().toString(36).substring(7)}`;
    
    const [result] = await pool.query(
        'INSERT INTO students (username, email, password, prn_number) VALUES (?, ?, ?, ?)',
        [`Student ${Date.now()}`, email, password, prn]
    );
    
    const token = jwt.sign({ id: result.insertId, role: 'student', isMainAdmin: false }, process.env.JWT_SECRET, { expiresIn: '24h' });
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    await pool.query('UPDATE students SET last_token = ? WHERE id = ?', [hashedToken, result.insertId]);
    
    return { token, id: result.insertId, email, prn, password: 'password123' };
};

module.exports = { getTestTeacherToken, getTestStudentToken };
