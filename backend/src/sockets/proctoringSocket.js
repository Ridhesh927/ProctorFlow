const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');

module.exports = (io) => {
    // 1. Socket Authentication Middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;

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
            } else if (role !== 'teacher' && role !== 'admin') {
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
            const userId = socket.user.id;
            console.log(`Student ${userId} explicitly left exam ${examId}`);

            try {
                await pool.query(
                    'UPDATE exam_sessions SET status = "terminated", end_time = CURRENT_TIMESTAMP WHERE id = ? AND student_id = ? AND status = "active"',
                    [sessionId, userId]
                );
            } catch (err) {
                console.error('Error terminating session on leave:', err);
            }

            socket.to(`exam-${examId}`).emit('student-left-exam', { userId, sessionId });
            socket.leave(`exam-${examId}`);
        });

        // WebRTC Signaling
        socket.on('signal', ({ to, signal, from }) => {
            io.to(to).emit('signal', { signal, from });
        });

        // Proctoring Warnings
        socket.on('send-warning', ({ studentId, message, type }) => {
            if (socket.user.role !== 'teacher' && socket.user.role !== 'admin') return;

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
            if (socket.user.role !== 'student') return;
            const userId = socket.user.id;
            socket.to(`exam-${examId}`).emit('student-warning-alert', { userId, warningType });
        });

        // Face violation handler
        socket.on('face-violation', async ({ sessionId, faceCount, warningNumber, timestamp }) => {
            if (socket.user.role !== 'student') return;
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
            if (socket.user.role !== 'student') return;
            const userId = socket.user.id;
            socket.to(`exam-${examId}`).emit('student-rough-work', { userId, content });
        });

        // Voice Intervention
        socket.on('voice-intervention', ({ studentId, message }) => {
            if (socket.user.role !== 'teacher' && socket.user.role !== 'admin') return;

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

        socket.on('disconnect', async () => {
            if (socket.role === 'student' && socket.sessionId) {
                console.log(`Student ${socket.userId} disconnected from session ${socket.sessionId}`);

                try {
                    await pool.query(
                        'UPDATE exam_sessions SET status = "terminated", end_time = CURRENT_TIMESTAMP WHERE id = ? AND student_id = ? AND status = "active"',
                        [socket.sessionId, socket.userId]
                    );
                } catch (err) {
                    console.error('Error terminating session on disconnect:', err);
                }

                socket.to(`exam-${socket.examId}`).emit('student-disconnected', { userId: socket.userId, sessionId: socket.sessionId });
            }
            console.log('User disconnected:', socket.id);
        });
    });
};
