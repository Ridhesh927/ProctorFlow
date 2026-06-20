const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in environment variables.');
}

const authMiddleware = async (req, res, next) => {
    const authHeaderToken = req.header('Authorization')?.replace('Bearer ', '');
    const cookieToken = req.cookies?.auth_token;
    const token = authHeaderToken || cookieToken;

    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;

        const table = decoded.role === 'teacher' ? 'teachers' : 'students';
        const query = decoded.role === 'teacher'
            ? 'SELECT last_token, is_main_admin FROM teachers WHERE id = ?'
            : 'SELECT last_token, FALSE as is_main_admin FROM students WHERE id = ?';
        const [rows] = await pool.query(query, [decoded.id]);

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        if (rows.length === 0 || rows[0].last_token !== hashedToken) {
            return res.status(401).json({ message: 'Session expired or logged in on another device' });
        }

        req.user.isMainAdmin = !!rows[0].is_main_admin;

        next();
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

const roleMiddleware = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
        }
        next();
    };
};

const mainAdminMiddleware = (req, res, next) => {
    if (!req.user.isMainAdmin) {
        return res.status(403).json({ message: 'Access denied: Main Admin privileges required' });
    }
    next();
};

module.exports = { authMiddleware, roleMiddleware, mainAdminMiddleware };
