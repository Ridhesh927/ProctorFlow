const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');

// Track pending terminations for disconnected student sessions: sessionId -> Timeout
const pendingTerminations = new Map();

// Helper to verify role
const verifyRole = (socket, allowedRoles) => {
    if (!socket.user || !allowedRoles.includes(socket.user.role)) {
        return false;
    }
    return true;
};

module.exports = (io) => {
    // 1. Socket Authentication Middleware
    io.use((socket, next) => {
        let token = socket.handshake.auth?.token;

        if (!token && socket.handshake.headers?.cookie) {
            const cookies = socket.handshake.headers.cookie.split(';');
            for (const cookie of cookies) {
                const [key, val] = cookie.trim().split('=');
                if (key === 'token') {
                    token = decodeURIComponent(val);
                    break;
                }
            }
        }

        if (!token && socket.handshake.headers?.authorization) {
            const parts = socket.handshake.headers.authorization.split(' ');
            if (parts.length === 2 && parts[0] === 'Bearer') {
                token = parts[1];
            }
        }

        if (!token) {
            return next(new Error('Authentication error: Token missing'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded; 
            next();
        } catch (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`Authenticated user ${socket.user.id} (${socket.user.role}) connected on socket ${socket.id}`);

        socket.on('join-room', async ({ examId, sessionId }) => {
            const userId = socket.user.id;
            const role = socket.user.role;
            const name = socket.user.name || socket.user.username || 'User';

            // Server-side Authorization Check
            if (role === 'student') {
                if (!sessionId) {
                    return socket.disconnect();
                }
                // Verify via DB if student is actually enrolled/has an active session
                try {
                    const [session] = await pool.query(
                        'SELECT id FROM exam_sessions WHERE id = ? AND student_id = ? AND exam_id = ?', 
                        [sessionId, userId, examId]
                    );
                    if (session.length === 0) {
                        return socket.disconnect();
                    }
                } catch (err) {
                    console.error('Error verifying exam session:', err);
                    return socket.disconnect();
                }

                // If reconnecting within grace period, cancel any pending termination
                if (pendingTerminations.has(sessionId)) {
                    clearTimeout(pendingTerminations.get(sessionId));
                    pendingTerminations.delete(sessionId);
                    console.log(`Student ${userId} reconnected to session ${sessionId}. Cancelled pending termination timer.`);
                }
            } else if (role === 'teacher') {
                // Verify teacher owns the exam or is authorized
                try {
                    const [examCheck] = await pool.query(
                        'SELECT id FROM exams WHERE id = ? AND created_by = ?',
                        [examId, userId]
                    );
                    if (examCheck.length === 0) {
                        if (socket.user.role !== 'admin') {
                            return socket.disconnect();
                        }
                    }
                } catch (err) {
                    console.error('Error verifying teacher exam ownership:', err);
                    return socket.disconnect();
                }
            } else if (role !== 'admin') {
                return socket.disconnect();
            }

            socket.join(`exam-${examId}`);
            socket.userId = userId;
            socket.role = role;
            socket.examId = examId;
            socket.sessionId = sessionId; // Store sessionId on socket

            console.log(`${name} (${role}) joined exam room: ${examId}`);

            if (role === 'student') {
                socket.to(`exam-${examId}`).emit('student-connected', { userId, name, socketId: socket.id, sessionId });
            } else if (role === 'teacher') {
                socket.to(`exam-${examId}`).emit('teacher-online', { teacherId: userId });
            }
        });

        // Explicit Leave Exam
        socket.on('leave-exam', async ({ examId, sessionId }) => {
            if (!verifyRole(socket, ['student'])) return;
            const userId = socket.user.id;
            const targetSessionId = sessionId || socket.sessionId;
            console.log(`Student ${userId} explicitly left exam ${examId}`);

            // Clear any pending grace period timer for this session
            if (pendingTerminations.has(targetSessionId)) {
                clearTimeout(pendingTerminations.get(targetSessionId));
                pendingTerminations.delete(targetSessionId);
            }

            try {
                await pool.query(
                    'UPDATE exam_sessions SET status = "terminated", end_time = CURRENT_TIMESTAMP WHERE id = ? AND student_id = ? AND status = "active"',
                    [targetSessionId, userId]
                );
            } catch (err) {
                console.error('Error terminating session on leave:', err);
            }

            socket.to(`exam-${examId}`).emit('student-left-exam', { userId, sessionId: targetSessionId });
            socket.leave(`exam-${examId}`);
        });

        // WebRTC Signaling
        socket.on('signal', ({ to, signal, from }) => {
            io.to(to).emit('signal', { signal, from });
        });

        // Proctoring Warnings
        socket.on('send-warning', ({ studentId, message, type }) => {
            if (!verifyRole(socket, ['teacher', 'admin'])) return;

            const sockets = io.sockets.adapter.rooms.get(`exam-${socket.examId}`);
            if (sockets) {
                for (const socketId of sockets) {
                    const s = io.sockets.sockets.get(socketId);
                    if (s && s.userId === studentId && s.role === 'student') {
                        io.to(socketId).emit('warning-received', { message, type });
                        break;
                    }
                }
            }
        });

        socket.on('student-warning-trigger', ({ examId, warningType }) => {
            if (!verifyRole(socket, ['student'])) return;
            if (socket.examId && String(socket.examId) !== String(examId)) return;
            const userId = socket.user.id;
            socket.to(`exam-${examId}`).emit('student-warning-alert', { userId, warningType });
        });

        // Face violation handler
        socket.on('face-violation', async ({ sessionId, faceCount, warningNumber, timestamp }) => {
            if (!verifyRole(socket, ['student'])) return;
            const studentId = socket.user.id;
            console.log(`Face violation: Session ${sessionId}, ${faceCount} faces detected, Warning ${warningNumber}/3`);

            try {
                const [session] = await pool.query('SELECT exam_id FROM exam_sessions WHERE id = ? AND student_id = ?', [sessionId, studentId]);
                if (session.length > 0) {
                    const examId = session[0].exam_id;
                    socket.to(`exam-${examId}`).emit('student-face-violation', {
                        sessionId,
                        studentId,
                        faceCount,
                        warningNumber,
                        timestamp
                    });
                }
            } catch (err) {
                console.error('Error broadcasting face violation:', err);
            }
        });

        // Rough Work Sync
        socket.on('rough-work-update', ({ examId, content }) => {
            if (!verifyRole(socket, ['student'])) return;
            if (socket.examId && String(socket.examId) !== String(examId)) return;
            const userId = socket.user.id;
            socket.to(`exam-${examId}`).emit('student-rough-work', { userId, content });
        });

        // Voice Intervention
        socket.on('voice-intervention', ({ studentId, message }) => {
            if (!verifyRole(socket, ['teacher', 'admin'])) return;

            const sockets = io.sockets.adapter.rooms.get(`exam-${socket.examId}`);
            if (sockets) {
                for (const socketId of sockets) {
                    const s = io.sockets.sockets.get(socketId);
                    if (s && s.userId === studentId && s.role === 'student') {
                        io.to(socketId).emit('voice-alert', { message });
                        break;
                    }
                }
            }
        });

        // Disconnect with Grace Period
        socket.on('disconnect', () => {
            if (socket.role === 'student' && socket.sessionId) {
                const studentId = socket.userId;
                const sessionId = socket.sessionId;
                const examId = socket.examId;

                console.log(`Student ${studentId} temporarily disconnected from session ${sessionId}. Starting 30s grace period.`);

                socket.to(`exam-${examId}`).emit('student-disconnected', { userId: studentId, sessionId });

                // Schedule grace period timer (30 seconds)
                if (pendingTerminations.has(sessionId)) {
                    clearTimeout(pendingTerminations.get(sessionId));
                }

                const timer = setTimeout(async () => {
                    try {
                        console.log(`Grace period expired for session ${sessionId}. Terminating exam session.`);
                        await pool.query(
                            'UPDATE exam_sessions SET status = "terminated", end_time = CURRENT_TIMESTAMP WHERE id = ? AND student_id = ? AND status = "active"',
                            [sessionId, studentId]
                        );
                    } catch (err) {
                        console.error('Error terminating session on disconnect expiry:', err);
                    } finally {
                        pendingTerminations.delete(sessionId);
                    }
                }, 30000);

                pendingTerminations.set(sessionId, timer);
            }
            console.log('User disconnected:', socket.id);
        });
    });
};
