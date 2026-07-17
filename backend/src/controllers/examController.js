const { pool } = require('../config/db');
const xlsx = require('xlsx');
const logger = require('../utils/logger');
const { generateText } = require('../utils/aiClient');

const normalizeDifficulty = (value) => {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'easy') return 'Easy';
    if (v === 'high' || v === 'hard') return 'High';
    return 'Medium';
};

const normalizeTopic = (value, fallback = 'General') => {
    const topic = String(value ?? '').trim();
    return topic || fallback;
};

const safeJsonParse = (value, fallback = null) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
};

const buildWeakTopicInsights = (rows = []) =>
    rows
        .map(row => {
            const attempts = Number(row.attempts || 0);
            const correctAttempts = Number(row.correct_attempts || 0);
            const incorrectAttempts = Math.max(0, attempts - correctAttempts);
            const accuracy = attempts > 0
                ? Number(((correctAttempts / attempts) * 100).toFixed(2))
                : 0;
            const weaknessScore = Number((100 - accuracy).toFixed(2));
            return {
                topic: normalizeTopic(row.topic, 'General'),
                attempts,
                correctAttempts,
                incorrectAttempts,
                accuracy,
                weaknessScore
            };
        })
        .sort((a, b) => {
            if (a.weaknessScore === b.weaknessScore) return b.attempts - a.attempts;
            return b.weaknessScore - a.weaknessScore;
        });

const buildClassRemediationSuggestions = (topicWeakness = []) =>
    topicWeakness
        .filter(topic => topic.attempts > 0)
        .slice(0, 5)
        .map(topic => {
            const remediationPriority = topic.accuracy < 50
                ? 'high'
                : topic.accuracy < 70
                    ? 'medium'
                    : 'low';

            let recommendation = `Run a focused revision module on ${topic.topic}.`;
            if (topic.accuracy < 50) {
                recommendation = `Prioritize a re-teach session for ${topic.topic}, followed by a graded practice set.`;
            } else if (topic.accuracy < 70) {
                recommendation = `Introduce scaffolded practice on ${topic.topic} with concept recap and worked examples.`;
            }

            return {
                topic: topic.topic,
                attempts: topic.attempts,
                accuracy: topic.accuracy,
                priority: remediationPriority,
                recommendation
            };
        });

const escapeCsvCell = (value) => {
    const raw = String(value ?? '');
    if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
        return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
};

const escapePdfText = (value) =>
    String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

const wrapPdfText = (text, maxChars = 90) => {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];

    const lines = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > maxChars) {
            if (current) lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }

    if (current) lines.push(current);
    return lines;
};

const buildSimplePdfBuffer = (rawLines = []) => {
    const lines = rawLines.flatMap(line => wrapPdfText(line));
    const pageHeight = 792;
    const lineHeight = 14;
    const topMargin = 40;
    const bottomMargin = 40;
    let y = pageHeight - topMargin;

    const contentParts = [
        'BT',
        '/F1 10 Tf',
        `40 ${y} Td`
    ];

    lines.forEach((line, index) => {
        const safeLine = escapePdfText(line);
        if (index === 0) {
            contentParts.push(`(${safeLine}) Tj`);
            return;
        }

        y -= lineHeight;
        if (y <= bottomMargin) {
            return;
        }
        contentParts.push(`0 -${lineHeight} Td`);
        contentParts.push(`(${safeLine}) Tj`);
    });

    contentParts.push('ET');
    const stream = `${contentParts.join('\n')}\n`;

    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
        `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
        offsets.push(Buffer.byteLength(pdf, 'utf8'));
        pdf += object;
    }

    const xrefStart = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++) {
        const offset = String(offsets[i]).padStart(10, '0');
        pdf += `${offset} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
};

const getTeacherScope = (user) => ({
    sql: user.isMainAdmin ? '' : ' AND e.teacher_id = ?',
    params: user.isMainAdmin ? [] : [user.id]
});

const getSessionTeacherScope = (user) => ({
    sql: user.isMainAdmin ? '' : ' AND e.teacher_id = ?',
    params: user.isMainAdmin ? [] : [user.id]
});

const recordProctorAction = async ({
    sessionId,
    examId,
    studentId,
    actionType,
    reason,
    actionedBy,
    actionedByRole = 'teacher',
    metadata = null
}) => {
    await pool.query(
        `INSERT INTO exam_session_actions (
            session_id,
            exam_id,
            student_id,
            action_type,
            reason,
            actioned_by,
            actioned_by_role,
            metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            sessionId,
            examId,
            studentId,
            actionType,
            reason || null,
            actionedBy || null,
            actionedByRole,
            metadata ? JSON.stringify(metadata) : null
        ]
    );
};

const getDefaultProctorReason = (actionType) => {
    const defaults = {
        warn: 'Suspicious behavior observed during live proctoring.',
        suspend: 'Session suspended pending manual review.',
        terminate: 'Session terminated by invigilator due to repeated violations.'
    };
    return defaults[actionType] || 'Invigilation action applied.';
};

const emitToStudentSocket = (io, examId, studentId, eventName, payload) => {
    if (!io) return;
    const sockets = io.sockets.adapter.rooms.get(`exam-${examId}`);
    if (!sockets) return;

    for (const socketId of sockets) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.userId === Number(studentId) && socket.role === 'student') {
            io.to(socketId).emit(eventName, payload);
        }
    }
};

const mapWarningTimelineEntry = (warning) => ({
    id: `warning-${warning.id}`,
    sessionId: Number(warning.session_id),
    eventType: 'warning',
    actionType: 'warning',
    reason: warning.message || warning.warning_type || 'Violation detected',
    actorId: null,
    actorRole: 'system',
    actorName: 'Proctoring Engine',
    metadata: {
        warningType: warning.warning_type,
        snapshotData: warning.snapshot_data
    },
    occurredAt: warning.timestamp
});

const mapActionTimelineEntry = (action) => {
    const actorName = action.actioned_by_role === 'teacher'
        ? (action.teacher_name || `Teacher #${action.actioned_by}`)
        : action.actioned_by_role === 'student'
            ? `Student #${action.actioned_by}`
            : 'System';

    return {
        id: `action-${action.id}`,
        sessionId: Number(action.session_id),
        eventType: 'action',
        actionType: action.action_type,
        reason: action.reason || '',
        actorId: action.actioned_by,
        actorRole: action.actioned_by_role || 'system',
        actorName,
        metadata: safeJsonParse(action.metadata, {}),
        occurredAt: action.created_at
    };
};

const getAuthorizedExam = async (examId, user) => {
    const { sql: teacherScopeSql, params: teacherScopeParams } = getTeacherScope(user);
    const [rows] = await pool.query(
        `SELECT e.id, e.title
         FROM exams e
         WHERE e.id = ? AND e.is_deleted = FALSE${teacherScopeSql}
         LIMIT 1`,
        [examId, ...teacherScopeParams]
    );
    return rows[0] || null;
};

const getAuthorizedSession = async (sessionId, user) => {
    const { sql: teacherScopeSql, params: teacherScopeParams } = getSessionTeacherScope(user);
    const [rows] = await pool.query(
        `SELECT
            es.*,
            s.username as student_name,
            s.prn_number,
            e.title as exam_title
         FROM exam_sessions es
         JOIN exams e ON es.exam_id = e.id
         JOIN students s ON es.student_id = s.id
         WHERE es.id = ?${teacherScopeSql}
         LIMIT 1`,
        [sessionId, ...teacherScopeParams]
    );
    return rows[0] || null;
};

const buildAdaptiveRecommendations = async ({ examId, studentId, resultId, questionPerformance = [] }) => {
    const topicRows = [];
    const topicMap = new Map();

    questionPerformance.forEach((question) => {
        const topic = normalizeTopic(question.topic, 'General');
        if (!topicMap.has(topic)) {
            topicMap.set(topic, {
                topic,
                attempts: 0,
                correct_attempts: 0
            });
        }
        const aggregate = topicMap.get(topic);
        aggregate.attempts += 1;
        if (question.isCorrect) {
            aggregate.correct_attempts += 1;
        }
    });

    for (const value of topicMap.values()) {
        topicRows.push(value);
    }

    const weakTopics = buildWeakTopicInsights(topicRows);
    const weakTopicSet = new Set(weakTopics.slice(0, 3).map(topic => topic.topic));

    const [practiceBankRows] = await pool.query(
        `SELECT
            eq.id,
            eq.question,
            eq.options,
            eq.difficulty,
            COALESCE(NULLIF(eq.topic, ''), e.subject, 'General') as topic
         FROM exam_questions eq
         JOIN exams e ON eq.exam_id = e.id
         WHERE e.subject = (SELECT subject FROM exams WHERE id = ?)
         ORDER BY eq.id DESC
         LIMIT 150`,
        [examId]
    );

    const practiceQuiz = [];
    const seenQuestionIds = new Set();
    const incorrectQuestions = questionPerformance.filter(question => !question.isCorrect);

    incorrectQuestions.forEach((question) => {
        if (practiceQuiz.length >= 6 || seenQuestionIds.has(question.id)) return;
        seenQuestionIds.add(question.id);
        practiceQuiz.push({
            questionId: Number(question.id),
            topic: normalizeTopic(question.topic, 'General'),
            difficulty: normalizeDifficulty(question.difficulty),
            question: question.question,
            options: safeJsonParse(question.options, Array.isArray(question.options) ? question.options : []),
            focusReason: 'Previously attempted incorrectly in the exam.'
        });
    });

    practiceBankRows.forEach((question) => {
        if (practiceQuiz.length >= 6 || seenQuestionIds.has(question.id)) return;
        const topic = normalizeTopic(question.topic, 'General');
        if (!weakTopicSet.has(topic)) return;

        seenQuestionIds.add(question.id);
        practiceQuiz.push({
            questionId: Number(question.id),
            topic,
            difficulty: normalizeDifficulty(question.difficulty),
            question: question.question,
            options: safeJsonParse(question.options, []),
            focusReason: `Additional reinforcement for weak topic: ${topic}.`
        });
    });

    const [classTopicRows] = await pool.query(
        `SELECT
            COALESCE(NULLIF(eq.topic, ''), e.subject, 'General') as topic,
            COUNT(sr.id) as attempts,
            SUM(CASE WHEN sr.selected_option = eq.correct_answer THEN 1 ELSE 0 END) as correct_attempts
         FROM student_responses sr
         JOIN exam_sessions es ON sr.session_id = es.id
         JOIN exam_questions eq ON sr.question_id = eq.id
         JOIN exams e ON es.exam_id = e.id
         WHERE es.exam_id = ?
         GROUP BY topic
         HAVING attempts > 0
         ORDER BY attempts DESC`,
        [examId]
    );

    const classWeakness = buildWeakTopicInsights(classTopicRows);
    const classRemediation = buildClassRemediationSuggestions(classWeakness);

    await pool.query(
        `INSERT INTO exam_learning_recommendations (
            result_id,
            exam_id,
            student_id,
            weak_topics,
            practice_quiz,
            class_remediation
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            weak_topics = VALUES(weak_topics),
            practice_quiz = VALUES(practice_quiz),
            class_remediation = VALUES(class_remediation),
            updated_at = CURRENT_TIMESTAMP`,
        [
            resultId,
            examId,
            studentId,
            JSON.stringify(weakTopics),
            JSON.stringify(practiceQuiz),
            JSON.stringify(classRemediation)
        ]
    );

    return {
        weakTopics,
        practiceQuiz,
        classRemediation
    };
};

// Create Exam
exports.createExam = async (req, res) => {
    try {
        const { title, subject, duration, total_marks, passing_marks, instructions, questions, target_department, target_year, status, scheduled_start, expires_at } = req.body;
        const teacher_id = req.user.id;
        const createdByTeacherId = req.user.isMainAdmin ? null : teacher_id;

        // Main admin has id=0 and no teachers row, so skip FK by storing NULL.
        // For regular teachers, fail early with a clear auth/session message.
        if (!req.user.isMainAdmin) {
            const [teacherRows] = await pool.query('SELECT id FROM teachers WHERE id = ?', [teacher_id]);
            if (!teacherRows.length) {
                return res.status(401).json({
                    error: 'Teacher account not found for current session. Please log in again.'
                });
            }
        }

        if (!expires_at) {
            return res.status(400).json({ error: 'Expiration date (expires_at) is required.' });
        }

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Calculate total marks from questions if provided, otherwise use total_marks from body
            let finalTotalMarks = total_marks;
            if (questions && questions.length > 0) {
                finalTotalMarks = questions.reduce((sum, q) => sum + (q.marks || 5), 0);
            }

            const [examResult] = await connection.query(
                'INSERT INTO exams (title, subject, duration, total_marks, passing_marks, instructions, teacher_id, target_department, target_year, status, scheduled_start, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [title, subject, duration, finalTotalMarks, passing_marks, instructions, createdByTeacherId, target_department || null, target_year || null, status || 'Published', scheduled_start || null, expires_at]
            );

            const examId = examResult.insertId;

            if (questions && questions.length > 0) {
                const questionValues = questions.map(q => [
                    examId,
                    q.question,
                    JSON.stringify(q.options),
                    q.correct_answer,
                    q.marks,
                    normalizeDifficulty(q.difficulty),
                    normalizeTopic(q.topic, subject || 'General')
                ]);
                await connection.query(
                    'INSERT INTO exam_questions (exam_id, question, options, correct_answer, marks, difficulty, topic) VALUES ?',
                    [questionValues]
                );
            }

            await connection.commit();

            logger('CREATE_EXAM', `Teacher ID ${teacher_id} created exam: ${title}`, {
                examId,
                subject,
                createdByTeacherId,
                isMainAdmin: !!req.user.isMainAdmin
            });

            // Trigger Notifications for Students (Async)
            if (status === 'Published' || !status) {
                createExamNotifications(examId, title, target_department, target_year);
            }

            res.status(201).json({ message: 'Exam created successfully', examId });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        logger('CREATE_EXAM_ERROR', `Error creating exam`, { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// Get All Exams (for any Teacher - shared view originally, now restricted)
exports.getTeacherExams = async (req, res) => {
    try {
        let query = `SELECT e.*, t.username as created_by
             FROM exams e
             LEFT JOIN teachers t ON e.teacher_id = t.id
             WHERE e.is_deleted = FALSE`;
        const params = [];
        
        if (!req.user.isMainAdmin) {
            query += ` AND e.teacher_id = ?`;
            params.push(req.user.id);
        }
        
        query += ` ORDER BY e.created_at DESC`;

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Detailed Analytics for Teacher Results Dashboard
exports.getTeacherAnalytics = async (req, res) => {
    try {
        const { sql: teacherScopeSql, params: teacherScopeParams } = getTeacherScope(req.user);

        const [overviewRows] = await pool.query(
            `SELECT
                COUNT(DISTINCT e.id) as total_exams,
                COUNT(DISTINCT CASE WHEN es.status = 'active' THEN es.id END) as active_sessions,
                COUNT(DISTINCT CASE WHEN DATE(er.submitted_at) = CURDATE() THEN er.id END) as completed_today,
                COUNT(DISTINCT CASE WHEN (es.warnings_count > 0 OR COALESCE(es.is_suspended, FALSE) = TRUE) AND es.status IN ('completed', 'terminated', 'active') THEN es.id END) as pending_reviews,
                COUNT(DISTINCT es.id) as started_sessions,
                COUNT(DISTINCT CASE WHEN es.status = 'completed' THEN es.id END) as completed_sessions,
                COUNT(DISTINCT er.id) as evaluated_attempts,
                COUNT(DISTINCT CASE WHEN er.score >= e.passing_marks THEN er.id END) as passed_attempts,
                COUNT(DISTINCT CASE WHEN er.total_marks > 0 AND (er.score / er.total_marks) >= 0.75 THEN er.id END) as distinction_attempts,
                ROUND(AVG(CASE WHEN er.total_marks > 0 THEN (er.score / er.total_marks) * 100 END), 2) as avg_score
             FROM exams e
             LEFT JOIN exam_sessions es ON es.exam_id = e.id
             LEFT JOIN exam_results er ON er.exam_id = e.id
             WHERE e.is_deleted = FALSE${teacherScopeSql}`,
            teacherScopeParams
        );

        const [examTrends] = await pool.query(
            `SELECT
                e.id as exam_id,
                e.title,
                COUNT(er.id) as attempts,
                SUM(CASE WHEN er.score >= e.passing_marks THEN 1 ELSE 0 END) as pass_count,
                SUM(CASE WHEN er.score < e.passing_marks THEN 1 ELSE 0 END) as fail_count,
                ROUND(AVG(CASE WHEN er.total_marks > 0 THEN (er.score / er.total_marks) * 100 END), 2) as avg_percentage,
                ROUND(
                    (SUM(CASE WHEN er.score >= e.passing_marks THEN 1 ELSE 0 END) / NULLIF(COUNT(er.id), 0)) * 100,
                    2
                ) as pass_rate
             FROM exams e
             LEFT JOIN exam_results er ON er.exam_id = e.id
             WHERE e.is_deleted = FALSE${teacherScopeSql}
             GROUP BY e.id, e.title
             HAVING attempts > 0
             ORDER BY attempts DESC, avg_percentage DESC
             LIMIT 8`,
            teacherScopeParams
        );

        const [warningCorrelation] = await pool.query(
            `SELECT
                CASE
                    WHEN COALESCE(sw.warnings_count, 0) = 0 THEN 'No Warnings'
                    WHEN COALESCE(sw.warnings_count, 0) BETWEEN 1 AND 2 THEN '1-2 Warnings'
                    ELSE '3+ Warnings'
                END as warning_band,
                COUNT(er.id) as attempts,
                ROUND(AVG(CASE WHEN er.total_marks > 0 THEN (er.score / er.total_marks) * 100 END), 2) as avg_percentage
             FROM exam_results er
             JOIN exams e ON er.exam_id = e.id
             LEFT JOIN (
                SELECT exam_id, student_id, SUM(warnings_count) as warnings_count
                FROM exam_sessions
                GROUP BY exam_id, student_id
             ) sw ON sw.exam_id = er.exam_id AND sw.student_id = er.student_id
             WHERE e.is_deleted = FALSE${teacherScopeSql}
             GROUP BY CASE
                WHEN COALESCE(sw.warnings_count, 0) = 0 THEN 'No Warnings'
                WHEN COALESCE(sw.warnings_count, 0) BETWEEN 1 AND 2 THEN '1-2 Warnings'
                ELSE '3+ Warnings'
            END
             ORDER BY FIELD(warning_band, 'No Warnings', '1-2 Warnings', '3+ Warnings')`,
            teacherScopeParams
        );

        const [topicWeaknessRows] = await pool.query(
            `SELECT
                COALESCE(NULLIF(eq.topic, ''), e.subject, 'General') as topic,
                COUNT(sr.id) as attempts,
                SUM(CASE WHEN sr.selected_option = eq.correct_answer THEN 1 ELSE 0 END) as correct_attempts
             FROM student_responses sr
             JOIN exam_sessions es ON sr.session_id = es.id
             JOIN exam_questions eq ON sr.question_id = eq.id
             JOIN exams e ON es.exam_id = e.id
             WHERE e.is_deleted = FALSE${teacherScopeSql}
             GROUP BY COALESCE(NULLIF(eq.topic, ''), e.subject, 'General')
             HAVING attempts > 0
             ORDER BY attempts DESC`,
            teacherScopeParams
        );

        const [recentResults] = await pool.query(
            `SELECT
                er.id,
                er.score,
                er.total_marks,
                er.submitted_at,
                s.username as student_name,
                e.title as exam_title,
                COALESCE(sw.warnings_count, 0) as warnings_count,
                ROUND(CASE WHEN er.total_marks > 0 THEN (er.score / er.total_marks) * 100 ELSE 0 END, 2) as score_percentage
             FROM exam_results er
             JOIN students s ON er.student_id = s.id
             JOIN exams e ON er.exam_id = e.id
             LEFT JOIN (
                SELECT exam_id, student_id, SUM(warnings_count) as warnings_count
                FROM exam_sessions
                GROUP BY exam_id, student_id
             ) sw ON sw.exam_id = er.exam_id AND sw.student_id = er.student_id
             WHERE e.is_deleted = FALSE${teacherScopeSql}
             ORDER BY er.submitted_at DESC
             LIMIT 10`,
            teacherScopeParams
        );

        const overview = overviewRows[0] || {};
        const startedSessions = Number(overview.started_sessions || 0);
        const completedSessions = Number(overview.completed_sessions || 0);
        const evaluatedAttempts = Number(overview.evaluated_attempts || 0);
        const passedAttempts = Number(overview.passed_attempts || 0);
        const distinctionAttempts = Number(overview.distinction_attempts || 0);
        const topicWeakness = buildWeakTopicInsights(topicWeaknessRows);
        const classRemediationSuggestions = buildClassRemediationSuggestions(topicWeakness);

        res.json({
            totalExams: Number(overview.total_exams || 0),
            activeSessions: Number(overview.active_sessions || 0),
            completedToday: Number(overview.completed_today || 0),
            pendingReviews: Number(overview.pending_reviews || 0),
            startedSessions,
            completedSessions,
            completionRate: startedSessions > 0 ? Math.round((completedSessions / startedSessions) * 100) : 0,
            evaluatedAttempts,
            passRate: evaluatedAttempts > 0 ? Math.round((passedAttempts / evaluatedAttempts) * 100) : 0,
            distinctionRate: evaluatedAttempts > 0 ? Math.round((distinctionAttempts / evaluatedAttempts) * 100) : 0,
            avgScore: Number(overview.avg_score || 0),
            examTrends: examTrends.map(row => ({
                ...row,
                attempts: Number(row.attempts || 0),
                pass_count: Number(row.pass_count || 0),
                fail_count: Number(row.fail_count || 0),
                avg_percentage: Number(row.avg_percentage || 0),
                pass_rate: Number(row.pass_rate || 0)
            })),
            warningCorrelation: warningCorrelation.map(row => ({
                ...row,
                attempts: Number(row.attempts || 0),
                avg_percentage: Number(row.avg_percentage || 0)
            })),
            topicWeakness,
            classRemediationSuggestions,
            recentResults
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete Exam (restricted to owner or main admin)
exports.deleteExam = async (req, res) => {
    try {
        const { id } = req.params;
        let query = 'UPDATE exams SET is_deleted = TRUE WHERE id = ?';
        const params = [id];
        if (!req.user.isMainAdmin) {
            query += ' AND teacher_id = ?';
            params.push(req.user.id);
        }
        const [result] = await pool.query(query, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Exam not found' });
        }
        logger('DELETE_EXAM', `Exam ID ${id} soft-deleted by teacher ID ${req.user.id}`);
        res.json({ message: 'Exam deleted successfully (archived)' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Exam Details (For Teacher Edit Page - no restrictions originally, now restricted)
exports.getTeacherExamDetails = async (req, res) => {
    try {
        let query = 'SELECT * FROM exams WHERE id = ?';
        const params = [req.params.id];
        if (!req.user.isMainAdmin) {
            query += ' AND teacher_id = ?';
            params.push(req.user.id);
        }
        const [rows] = await pool.query(query, params);
        if (rows.length === 0) return res.status(404).json({ message: 'Exam not found or unauthorized' });

        const exam = rows[0];
        const [questions] = await pool.query('SELECT id, question, options, correct_answer as correct, marks, difficulty, topic FROM exam_questions WHERE exam_id = ?', [req.params.id]);

        // Parse options back to arrays for frontend
        const parsedQuestions = questions.map(q => ({
            ...q,
            options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
        }));

        res.json({ ...exam, questions: parsedQuestions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update Exam
exports.updateExam = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, subject, duration, passing_marks, target_department, target_year, status, questions, expires_at } = req.body;
        const teacher_id = req.user.id;

        if (!expires_at) {
            return res.status(400).json({ error: 'Expiration date (expires_at) is required.' });
        }

        // Verify ownership
        let authQuery = 'SELECT id FROM exams WHERE id = ?';
        const authParams = [id];
        if (!req.user.isMainAdmin) {
            authQuery += ' AND teacher_id = ?';
            authParams.push(teacher_id);
        }
        const [authCheck] = await pool.query(authQuery, authParams);
        if (authCheck.length === 0) return res.status(403).json({ message: 'Unauthorized or exam not found' });

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const calculatedTotalMarks = questions.reduce((sum, q) => sum + (q.marks !== undefined ? q.marks : 5), 0);

            await connection.query(
                'UPDATE exams SET title=?, subject=?, duration=?, total_marks=?, passing_marks=?, target_department=?, target_year=?, status=?, expires_at=? WHERE id=?',
                [title, subject, duration, calculatedTotalMarks, passing_marks, target_department || null, target_year || null, status || 'Draft', expires_at, id]
            );

            // For simplicity: clear student_responses first to avoid foreign key errors, then delete old questions and insert new ones
            await connection.query(
                'DELETE FROM student_responses WHERE question_id IN (SELECT id FROM exam_questions WHERE exam_id = ?)',
                [id]
            );

            await connection.query('DELETE FROM exam_questions WHERE exam_id = ?', [id]);

            if (questions && questions.length > 0) {
                const questionValues = questions.map(q => {
                    const questionText = q.question || q.text;
                    const optionsString = typeof q.options === 'string' ? q.options : JSON.stringify(q.options);
                    const correctAnswer = q.correct_answer !== undefined ? q.correct_answer : (q.correct !== undefined ? q.correct : 0);
                    const marks = q.marks !== undefined ? q.marks : 5;
                    const difficulty = normalizeDifficulty(q.difficulty);
                    const topic = normalizeTopic(q.topic, subject || 'General');
                    return [id, questionText, optionsString, correctAnswer, marks, difficulty, topic];
                });
                await connection.query(
                    'INSERT INTO exam_questions (exam_id, question, options, correct_answer, marks, difficulty, topic) VALUES ?',
                    [questionValues]
                );
            }

            await connection.commit();
            logger('UPDATE_EXAM', `Teacher ID ${teacher_id} updated exam: ${title}`, { examId: id });

            // Trigger Notifications if status changed to Published or updated while Published
            if (status === 'Published') {
                createExamNotifications(id, title, target_department, target_year);
            }

            res.json({ message: 'Exam updated successfully' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        logger('UPDATE_EXAM_ERROR', `Error updating exam`, { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// Schedule Exam
exports.scheduleExam = async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduled_start } = req.body;

        let status = 'Published';
        if (scheduled_start) {
            const start = new Date(scheduled_start);
            if (start > new Date()) {
                status = 'Scheduled';
            }
        }

        let query = 'UPDATE exams SET status = ?, scheduled_start = ? WHERE id = ?';
        const params = [status, scheduled_start || null, id];
        if (!req.user.isMainAdmin) {
            query += ' AND teacher_id = ?';
            params.push(req.user.id);
        }

        const [result] = await pool.query(query, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Exam not found or you are not authorized' });
        }
        res.json({ message: 'Exam scheduled successfully', status, scheduled_start });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Available Exams (for Student - filtered by their department and year)
exports.getAvailableExams = async (req, res) => {
    try {
        // Get the student's own department and year from the DB
        const [studentRows] = await pool.query(
            'SELECT department, year FROM students WHERE id = ?', [req.user.id]
        );
        const student = studentRows[0] || {};

        const studentDept = student.department || null;
        const studentYear = student.year || null;

        // Build dynamic WHERE clauses to handle NULL-safe comparisons properly.
        // In MySQL, `column = NULL` is always FALSE, so we must use IS NULL checks.
        // Logic:
        //   - If target_department IS NULL -> exam is for ALL departments -> always show
        //   - If student has a department set -> also show exams targeting that specific department
        //   - If student has NO department set (NULL) -> only show exams targeting ALL (NULL)
        // Same logic applies to year.
        let deptCondition, yearCondition;
        const params = [];

        if (studentDept) {
            deptCondition = '(e.target_department IS NULL OR e.target_department = ?)';
            params.push(studentDept);
        } else {
            deptCondition = 'e.target_department IS NULL';
        }

        if (studentYear) {
            yearCondition = '(e.target_year IS NULL OR e.target_year = ?)';
            params.push(studentYear);
        } else {
            yearCondition = 'e.target_year IS NULL';
        }

        const [rows] = await pool.query(
            `SELECT e.id, e.title, e.subject, e.duration, e.total_marks, e.passing_marks, e.instructions, e.status, e.scheduled_start, e.expires_at,
             e.target_department, e.target_year,
             (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) as question_count
             FROM exams e
             WHERE e.status IN ('Published', 'Scheduled')
             AND e.is_deleted = FALSE
             AND ${deptCondition}
             AND ${yearCondition}
             AND e.expires_at > NOW()
             AND NOT EXISTS (
                 SELECT 1 FROM exam_results er WHERE er.exam_id = e.id AND er.student_id = ?
             )
             ORDER BY e.created_at DESC`,
            [...params, req.user.id]
        );

        // Filter out scheduled exams that haven't started yet
        const availableExams = rows.filter(exam => {
            if (exam.status === 'Published') return true;
            if (exam.status === 'Scheduled' && exam.scheduled_start) {
                return new Date(exam.scheduled_start) <= new Date();
            }
            return false;
        });

        res.json({ exams: availableExams });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


// Get Exam Details (for Student)
exports.getExamDetails = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM exams WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Exam not found' });

        const exam = rows[0];

        // Security Checks
        if (exam.status !== 'Published' && exam.status !== 'Scheduled') {
            return res.status(403).json({ message: 'Exam is not available' });
        }

        if (exam.status === 'Scheduled' && exam.scheduled_start) {
            const now = new Date();
            const start = new Date(exam.scheduled_start);
            if (now < start) {
                return res.status(403).json({ message: `Exam is scheduled to start at ${exam.scheduled_start}` });
            }
        }

        if (exam.expires_at) {
            const now = new Date();
            const expiresAt = new Date(exam.expires_at);
            if (now >= expiresAt) {
                return res.status(403).json({ message: 'This exam has expired.' });
            }
        }

        const [questions] = await pool.query('SELECT id, question, options, marks, difficulty FROM exam_questions WHERE exam_id = ?', [req.params.id]);

        res.json({ ...exam, questions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Submit Exam
exports.submitExam = async (req, res) => {
    try {
        const { examId, answers, completionTime } = req.body;
        const studentId = req.user.id;

        console.log('[SUBMIT_EXAM] Received:', { examId, studentId, answers, completionTime });

        if (!examId) {
            return res.status(400).json({ error: 'examId is required' });
        }

        // Verify that the student has an active session for this exam
        const [activeSessionRows] = await pool.query(
            'SELECT id FROM exam_sessions WHERE exam_id = ? AND student_id = ? AND status = "active"',
            [examId, studentId]
        );

        if (activeSessionRows.length === 0) {
            return res.status(403).json({ error: 'No active session found for this exam. You cannot submit.' });
        }

        // Check if already submitted (prevent duplicates)
        const [existing] = await pool.query(
            'SELECT id FROM exam_results WHERE exam_id = ? AND student_id = ?',
            [examId, studentId]
        );
        if (existing.length > 0) {
            console.log('[SUBMIT_EXAM] Already submitted, returning existing result');
            const [existingRecommendationRows] = await pool.query(
                `SELECT weak_topics, practice_quiz, class_remediation
                 FROM exam_learning_recommendations
                 WHERE result_id = ?
                 LIMIT 1`,
                [existing[0].id]
            );

            const existingRecommendations = existingRecommendationRows[0]
                ? {
                    weakTopics: safeJsonParse(existingRecommendationRows[0].weak_topics, []),
                    practiceQuiz: safeJsonParse(existingRecommendationRows[0].practice_quiz, []),
                    classRemediation: safeJsonParse(existingRecommendationRows[0].class_remediation, [])
                }
                : null;

            return res.json({
                message: 'Exam already submitted',
                resultId: existing[0].id,
                recommendations: existingRecommendations
            });
        }

        const [questions] = await pool.query(
            `SELECT
                eq.id,
                eq.question,
                eq.options,
                eq.correct_answer,
                eq.marks,
                eq.difficulty,
                COALESCE(NULLIF(eq.topic, ''), e.subject, 'General') as topic
             FROM exam_questions eq
             JOIN exams e ON eq.exam_id = e.id
             WHERE eq.exam_id = ?`,
            [examId]
        );

        console.log(`[SUBMIT_EXAM] Found ${questions.length} questions for exam ${examId}`);

        let score = 0;
        let correctCount = 0;
        let examTotalMarks = 0;
        const safeAnswers = answers || {};
        const questionPerformance = [];

        questions.forEach(q => {
            const marks = Number(q.marks || 0);
            examTotalMarks += marks;
            // answers keys may be strings (from JSON), q.id is a number
            const studentAnswer = safeAnswers[q.id] !== undefined ? safeAnswers[q.id] : safeAnswers[String(q.id)];
            const isCorrect = studentAnswer !== undefined && Number(studentAnswer) === Number(q.correct_answer);
            if (isCorrect) {
                score += marks;
                correctCount++;
            }

            questionPerformance.push({
                id: q.id,
                question: q.question,
                options: q.options,
                difficulty: q.difficulty,
                topic: q.topic,
                selectedOption: studentAnswer !== undefined ? Number(studentAnswer) : null,
                correctAnswer: Number(q.correct_answer),
                isCorrect
            });
        });

        // Fallback to exam table total_marks if no questions found (unlikely)
        if (examTotalMarks === 0) {
            const [examData] = await pool.query('SELECT total_marks FROM exams WHERE id = ?', [examId]);
            examTotalMarks = examData[0]?.total_marks || 0;
        }

        const safeCompletionTime = completionTime || 0;

        console.log(`[SUBMIT_EXAM] Score: ${score}, Correct: ${correctCount}, Total Marks: ${examTotalMarks}, Time: ${safeCompletionTime}`);

        const [result] = await pool.query(
            'INSERT INTO exam_results (exam_id, student_id, score, total_questions, correct_answers, total_marks, completion_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [examId, studentId, score, questions.length, correctCount, examTotalMarks, safeCompletionTime]
        );

        // Mark session as completed
        await pool.query(
            'UPDATE exam_sessions SET status = \"completed\", is_suspended = FALSE, end_time = CURRENT_TIMESTAMP WHERE student_id = ? AND exam_id = ? AND status = \"active\"',
            [studentId, examId]
        );
        const [latestSessionRows] = await pool.query(
            `SELECT id
             FROM exam_sessions
             WHERE student_id = ? AND exam_id = ?
             ORDER BY start_time DESC
             LIMIT 1`,
            [studentId, examId]
        );

        if (latestSessionRows.length > 0) {
            try {
                await recordProctorAction({
                    sessionId: latestSessionRows[0].id,
                    examId: Number(examId),
                    studentId,
                    actionType: 'exam-submitted',
                    reason: 'Student submitted exam.',
                    actionedBy: studentId,
                    actionedByRole: 'student',
                    metadata: {
                        score,
                        totalMarks: examTotalMarks
                    }
                });
            } catch (auditError) {
                console.error('[SUBMIT_EXAM_AUDIT_LOG_ERROR]', auditError);
            }
        }

        let recommendations = {
            weakTopics: [],
            practiceQuiz: [],
            classRemediation: []
        };
        try {
            recommendations = await buildAdaptiveRecommendations({
                examId: Number(examId),
                studentId,
                resultId: result.insertId,
                questionPerformance
            });
        } catch (recommendationError) {
            console.error('[SUBMIT_EXAM_RECOMMENDATION_ERROR]', recommendationError);
        }

        logger('SUBMIT_EXAM', `Student ID ${studentId} submitted exam ID ${examId}`, { score, resultId: result.insertId });
        res.json({
            message: 'Exam submitted successfully',
            score,
            resultId: result.insertId,
            recommendations
        });
    } catch (error) {
        console.error('[SUBMIT_EXAM_ERROR]', error);
        logger('SUBMIT_EXAM_ERROR', `Error submitting exam ID ${req.body?.examId}`, { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// Start Exam Session
exports.startExamSession = async (req, res) => {
    try {
        const { examId } = req.body;
        const studentId = req.user.id;

        // Fetch student details
        const [studentRows] = await pool.query('SELECT department, year FROM students WHERE id = ?', [studentId]);
        const student = studentRows[0] || {};
        const studentDept = student.department || null;
        const studentYear = student.year || null;

        let deptCondition, yearCondition;
        const params = [];

        if (studentDept) {
            deptCondition = '(target_department IS NULL OR target_department = ?)';
            params.push(studentDept);
        } else {
            deptCondition = 'target_department IS NULL';
        }

        if (studentYear) {
            yearCondition = '(target_year IS NULL OR target_year = ?)';
            params.push(studentYear);
        } else {
            yearCondition = 'target_year IS NULL';
        }

        params.push(examId);

        // Verify exam availability
        const [examRows] = await pool.query(
            `SELECT id FROM exams 
             WHERE status IN ('Published', 'Scheduled') 
             AND is_deleted = FALSE 
             AND expires_at > NOW() 
             AND ${deptCondition} 
             AND ${yearCondition} 
             AND id = ?`,
            params
        );

        if (examRows.length === 0) {
            return res.status(403).json({ message: 'Exam is not available or unauthorized' });
        }

        // Check for existing active session
        const [active] = await pool.query(
            'SELECT * FROM exam_sessions WHERE student_id = ? AND exam_id = ? AND status = "active"',
            [studentId, examId]
        );

        if (active.length > 0) {
            return res.json({ message: 'Session already active', sessionId: active[0].id });
        }

        const [result] = await pool.query(
            'INSERT INTO exam_sessions (student_id, exam_id) VALUES (?, ?)',
            [studentId, examId]
        );

        logger('START_EXAM_SESSION', `Student ID ${studentId} started exam ID ${examId}`, { sessionId: result.insertId });

        res.status(201).json({ message: 'Session started', sessionId: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Log Warning
exports.logWarning = async (req, res) => {
    try {
        const { sessionId, warningType, message } = req.body;
        const studentId = req.user.id;

        const [sessionCheck] = await pool.query(
            'SELECT id FROM exam_sessions WHERE id = ? AND student_id = ? AND status = "active"',
            [sessionId, studentId]
        );

        if (sessionCheck.length === 0) {
            return res.status(403).json({ error: 'Unauthorized: Invalid or inactive session.' });
        }

        await pool.query(
            'INSERT INTO exam_warnings (session_id, warning_type, message) VALUES (?, ?, ?)',
            [sessionId, warningType, message]
        );

        await pool.query(
            'UPDATE exam_sessions SET warnings_count = warnings_count + 1 WHERE id = ?',
            [sessionId]
        );
        const [sessionRows] = await pool.query(
            'SELECT exam_id, student_id FROM exam_sessions WHERE id = ? LIMIT 1',
            [sessionId]
        );
        const session = sessionRows[0];

        if (session) {
            await recordProctorAction({
                sessionId,
                examId: session.exam_id,
                studentId: session.student_id,
                actionType: 'auto-warning',
                reason: message || warningType || 'Automated proctoring warning detected.',
                actionedBy: null,
                actionedByRole: 'system',
                metadata: {
                    warningType
                }
            });
        }

        res.json({ message: 'Warning logged' });

        // Emit real-time warning to teacher
        const io = req.app.get('socketio');
        if (io) {
            if (session) {
                io.to(`exam-${session.exam_id}`).emit('student-warning-alert', {
                    userId: session.student_id,
                    sessionId,
                    warningType,
                    message
                });
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update Student Response
exports.updateResponse = async (req, res) => {
    try {
        const { sessionId, questionId, selectedOption, timeSpent } = req.body;
        const studentId = req.user.id;

        const [sessionCheck] = await pool.query(
            'SELECT id FROM exam_sessions WHERE id = ? AND student_id = ? AND status = "active"',
            [sessionId, studentId]
        );

        if (sessionCheck.length === 0) {
            return res.status(403).json({ error: 'Unauthorized: Invalid or inactive session.' });
        }

        // Upsert response
        const [existing] = await pool.query(
            'SELECT * FROM student_responses WHERE session_id = ? AND question_id = ?',
            [sessionId, questionId]
        );

        if (existing.length > 0) {
            await pool.query(
                'UPDATE student_responses SET selected_option = ?, time_spent = time_spent + ? WHERE id = ?',
                [selectedOption, timeSpent, existing[0].id]
            );
        } else {
            await pool.query(
                'INSERT INTO student_responses (session_id, question_id, selected_option, time_spent) VALUES (?, ?, ?, ?)',
                [sessionId, questionId, selectedOption, timeSpent]
            );
        }

        res.json({ message: 'Response updated' });

        // Emit real-time update to teacher
        const io = req.app.get('socketio');
        if (io) {
            const [session] = await pool.query('SELECT exam_id FROM exam_sessions WHERE id = ?', [sessionId]);
            if (session.length > 0) {
                io.to(`exam-${session[0].exam_id}`).emit('student-progress-update', {
                    sessionId,
                    questionId,
                    selectedOption,
                    timeSpent,
                    studentId: req.user.id
                });
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Active Sessions for an Exam (for Proctoring)
exports.getActiveSessions = async (req, res) => {
    try {
        const { examId } = req.params;
        const authorizedExam = await getAuthorizedExam(Number(examId), req.user);
        if (!authorizedExam) {
            return res.status(404).json({ message: 'Exam not found or unauthorized' });
        }

        const { sql: teacherScopeSql, params: teacherScopeParams } = getSessionTeacherScope(req.user);
        const [rows] = await pool.query(`
            SELECT
                es.id,
                es.exam_id,
                es.student_id,
                es.start_time,
                es.end_time,
                es.status,
                es.warnings_count,
                COALESCE(es.is_suspended, FALSE) as is_suspended,
                s.username as student_name,
                s.prn_number,
                (SELECT esa.action_type FROM exam_session_actions esa WHERE esa.session_id = es.id ORDER BY esa.created_at DESC LIMIT 1) as last_action,
                (SELECT esa.created_at FROM exam_session_actions esa WHERE esa.session_id = es.id ORDER BY esa.created_at DESC LIMIT 1) as last_update
            FROM exam_sessions es
            JOIN exams e ON es.exam_id = e.id
            JOIN students s ON es.student_id = s.id
            WHERE es.exam_id = ? AND es.status = 'active'${teacherScopeSql}
            ORDER BY es.start_time DESC
        `, [examId, ...teacherScopeParams]);

        res.json(rows.map(row => ({
            ...row,
            is_suspended: !!row.is_suspended
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Live Violation Timeline for an Exam
exports.getProctoringTimeline = async (req, res) => {
    try {
        const examId = Number(req.params.examId);
        const authorizedExam = await getAuthorizedExam(examId, req.user);
        if (!authorizedExam) {
            return res.status(404).json({ message: 'Exam not found or unauthorized' });
        }

        const { sql: teacherScopeSql, params: teacherScopeParams } = getSessionTeacherScope(req.user);
        const [sessions] = await pool.query(
            `SELECT
                es.id,
                es.exam_id,
                es.student_id,
                es.start_time,
                es.end_time,
                es.status,
                es.warnings_count,
                COALESCE(es.is_suspended, FALSE) as is_suspended,
                s.username as student_name,
                s.prn_number
             FROM exam_sessions es
             JOIN exams e ON es.exam_id = e.id
             JOIN students s ON es.student_id = s.id
             WHERE es.exam_id = ? AND es.status = 'active'${teacherScopeSql}
             ORDER BY es.start_time DESC`,
            [examId, ...teacherScopeParams]
        );

        if (!sessions.length) {
            return res.json({ sessions: [] });
        }

        const sessionIds = sessions.map(session => session.id);
        const [warningRows] = await pool.query(
            `SELECT id, session_id, warning_type, message, timestamp
             FROM exam_warnings
             WHERE session_id IN (?)
             ORDER BY timestamp DESC
             LIMIT 500`,
            [sessionIds]
        );
        const [actionRows] = await pool.query(
            `SELECT
                esa.id,
                esa.session_id,
                esa.action_type,
                esa.reason,
                esa.actioned_by,
                esa.actioned_by_role,
                esa.metadata,
                esa.created_at,
                t.username as teacher_name
             FROM exam_session_actions esa
             LEFT JOIN teachers t ON esa.actioned_by = t.id AND esa.actioned_by_role = 'teacher'
             WHERE esa.session_id IN (?)
             ORDER BY esa.created_at DESC
             LIMIT 500`,
            [sessionIds]
        );

        const timelineBySession = {};
        sessionIds.forEach(sessionId => {
            timelineBySession[sessionId] = [];
        });

        warningRows.forEach(warning => {
            if (timelineBySession[warning.session_id]) {
                timelineBySession[warning.session_id].push(mapWarningTimelineEntry(warning));
            }
        });
        actionRows.forEach(action => {
            if (timelineBySession[action.session_id]) {
                timelineBySession[action.session_id].push(mapActionTimelineEntry(action));
            }
        });

        const mergedSessions = sessions.map(session => {
            const timeline = (timelineBySession[session.id] || [])
                .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
                .slice(0, 20);
            return {
                ...session,
                is_suspended: !!session.is_suspended,
                timeline
            };
        });

        res.json({ sessions: mergedSessions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Full Session Audit Trail
exports.getSessionAuditTrail = async (req, res) => {
    try {
        const sessionId = Number(req.params.sessionId);
        const session = await getAuthorizedSession(sessionId, req.user);
        if (!session) {
            return res.status(404).json({ message: 'Session not found or unauthorized' });
        }

        const [warningRows] = await pool.query(
            `SELECT id, session_id, warning_type, message, snapshot_data, timestamp
             FROM exam_warnings
             WHERE session_id = ?
             ORDER BY timestamp DESC
             LIMIT 500`,
            [sessionId]
        );
        const [actionRows] = await pool.query(
            `SELECT
                esa.id,
                esa.session_id,
                esa.action_type,
                esa.reason,
                esa.actioned_by,
                esa.actioned_by_role,
                esa.metadata,
                esa.created_at,
                t.username as teacher_name
             FROM exam_session_actions esa
             LEFT JOIN teachers t ON esa.actioned_by = t.id AND esa.actioned_by_role = 'teacher'
             WHERE esa.session_id = ?
             ORDER BY esa.created_at DESC
             LIMIT 500`,
            [sessionId]
        );

        const timeline = [
            ...warningRows.map(mapWarningTimelineEntry),
            ...actionRows.map(mapActionTimelineEntry)
        ].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

        // ── GENERATE AI MONITORING SUMMARY ──────────────────────────────────
        let aiProctorAnalysis = 'No suspicious activity requiring deep analysis.';
        if (warningRows.length > 0) {
            try {
                const warningCounts = warningRows.reduce((acc, w) => {
                    const wt = w.warning_type || 'unclassified';
                    acc[wt] = (acc[wt] || 0) + 1;
                    return acc;
                }, {});
                
                const prompt = `
                Evaluate student integrity for this exam session.
                Student: ${session.student_name}
                Total Warnings: ${warningRows.length}
                Warning Types: ${JSON.stringify(warningCounts)}
                Recent Log Summary: ${warningRows.slice(0, 5).map(w => w.message).join(' | ')}
                
                Provide a 1-2 sentence integrity risk assessment. Be objective.
                `;
                const { content } = await generateText({
                    taskType: 'monitoring',
                    prompt,
                    temperature: 0.3,
                    groqModel: 'llama-3.1-8b-instant'
                });
                aiProctorAnalysis = content;
            } catch (aiErr) {
                console.warn('[AI] Proctor analysis failed:', aiErr.message);
            }
        }
        // ──────────────────────────────────────────────────────────────────

        res.json({
            session: {
                ...session,
                is_suspended: !!session.is_suspended,
                aiProctorAnalysis
            },
            timeline,
            auditTrail: timeline.filter(entry => entry.eventType === 'action')
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Apply Proctor Action (Warn/Suspend/Terminate)
exports.applyProctorAction = async (req, res) => {
    try {
        const sessionId = Number(req.params.sessionId);
        const requestedActionType = String(req.body?.actionType || '').trim().toLowerCase();
        const reasonInput = String(req.body?.reason || '').trim();

        if (!['warn', 'suspend', 'terminate'].includes(requestedActionType)) {
            return res.status(400).json({ message: 'Invalid actionType. Use warn, suspend, or terminate.' });
        }

        const session = await getAuthorizedSession(sessionId, req.user);
        if (!session) {
            return res.status(404).json({ message: 'Session not found or unauthorized' });
        }

        const reason = reasonInput || getDefaultProctorReason(requestedActionType);

        if (requestedActionType === 'warn') {
            await pool.query(
                'INSERT INTO exam_warnings (session_id, warning_type, message) VALUES (?, ?, ?)',
                [sessionId, 'teacher-warning', reason]
            );
            await pool.query(
                'UPDATE exam_sessions SET warnings_count = warnings_count + 1 WHERE id = ?',
                [sessionId]
            );
        } else if (requestedActionType === 'suspend') {
            await pool.query(
                'UPDATE exam_sessions SET is_suspended = TRUE WHERE id = ?',
                [sessionId]
            );
        } else if (requestedActionType === 'terminate') {
            await pool.query(
                'UPDATE exam_sessions SET status = \"terminated\", is_suspended = TRUE, end_time = CURRENT_TIMESTAMP WHERE id = ?',
                [sessionId]
            );
        }

        await recordProctorAction({
            sessionId,
            examId: session.exam_id,
            studentId: session.student_id,
            actionType: requestedActionType,
            reason,
            actionedBy: req.user.id,
            actionedByRole: 'teacher',
            metadata: {
                source: 'teacher-action-center'
            }
        });

        const [teacherRows] = await pool.query('SELECT username FROM teachers WHERE id = ? LIMIT 1', [req.user.id]);
        const actionedByName = teacherRows[0]?.username || `Teacher #${req.user.id}`;
        const [updatedSessionRows] = await pool.query(
            `SELECT
                id,
                exam_id,
                student_id,
                status,
                warnings_count,
                COALESCE(is_suspended, FALSE) as is_suspended
             FROM exam_sessions
             WHERE id = ?
             LIMIT 1`,
            [sessionId]
        );
        const updatedSession = updatedSessionRows[0] || null;

        const io = req.app.get('socketio');
        const actionPayload = {
            sessionId,
            examId: session.exam_id,
            studentId: session.student_id,
            actionType: requestedActionType,
            reason,
            actionedBy: req.user.id,
            actionedByName,
            actionedAt: new Date().toISOString()
        };

        if (io) {
            io.to(`exam-${session.exam_id}`).emit('teacher-proctor-action', actionPayload);

            if (requestedActionType === 'warn') {
                emitToStudentSocket(io, session.exam_id, session.student_id, 'warning-received', {
                    message: reason,
                    type: 'teacher-warning'
                });
            } else {
                emitToStudentSocket(io, session.exam_id, session.student_id, 'student-session-action', {
                    actionType: requestedActionType,
                    reason
                });
            }
        }

        res.json({
            message: `Session ${requestedActionType} action applied successfully.`,
            session: updatedSession ? {
                ...updatedSession,
                is_suspended: !!updatedSession.is_suspended
            } : null,
            action: actionPayload
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Dashboard Stats (for Teacher)
exports.getDashboardStats = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const teacherScopeSql = req.user.isMainAdmin ? '' : ' AND e.teacher_id = ?';
        const teacherScopeParams = req.user.isMainAdmin ? [] : [teacherId];

        const [examCountRows] = await pool.query(
            `SELECT COUNT(*) as total
             FROM exams e
             WHERE e.is_deleted = FALSE${teacherScopeSql}`,
            teacherScopeParams
        );

        const [sessionStatsRows] = await pool.query(
            `SELECT 
                COUNT(*) as started_sessions,
                SUM(CASE WHEN es.status = 'active' THEN 1 ELSE 0 END) as active_sessions,
                SUM(CASE WHEN es.status = 'completed' THEN 1 ELSE 0 END) as completed_sessions,
                SUM(CASE WHEN (es.warnings_count > 0 OR COALESCE(es.is_suspended, FALSE) = TRUE) AND es.status IN ('completed', 'terminated', 'active') THEN 1 ELSE 0 END) as pending_reviews
             FROM exam_sessions es
             JOIN exams e ON es.exam_id = e.id
             WHERE e.is_deleted = FALSE${teacherScopeSql}`,
            teacherScopeParams
        );

        const [resultStatsRows] = await pool.query(
            `SELECT
                COUNT(*) as evaluated_attempts,
                SUM(CASE WHEN DATE(er.submitted_at) = CURDATE() THEN 1 ELSE 0 END) as completed_today
             FROM exam_results er
             JOIN exams e ON er.exam_id = e.id
             WHERE e.is_deleted = FALSE${teacherScopeSql}`,
            teacherScopeParams
        );

        const [recentResults] = await pool.query(
            `SELECT
                er.*,
                s.username as student_name,
                e.title as exam_title,
                COALESCE(sw.warnings_count, 0) as warnings_count,
                ROUND(CASE WHEN er.total_marks > 0 THEN (er.score / er.total_marks) * 100 ELSE 0 END, 2) as score_percentage
             FROM exam_results er
             JOIN students s ON er.student_id = s.id
             JOIN exams e ON er.exam_id = e.id
             LEFT JOIN (
                SELECT exam_id, student_id, SUM(warnings_count) as warnings_count
                FROM exam_sessions
                GROUP BY exam_id, student_id
             ) sw ON sw.exam_id = er.exam_id AND sw.student_id = er.student_id
             WHERE e.is_deleted = FALSE${teacherScopeSql}
             ORDER BY er.submitted_at DESC
             LIMIT 5`,
            teacherScopeParams
        );

        const totalExams = Number(examCountRows[0]?.total || 0);
        const activeSessions = Number(sessionStatsRows[0]?.active_sessions || 0);
        const completedSessions = Number(sessionStatsRows[0]?.completed_sessions || 0);
        const startedSessions = Number(sessionStatsRows[0]?.started_sessions || 0);
        const completionRate = startedSessions > 0 ? Math.round((completedSessions / startedSessions) * 100) : 0;

        res.json({
            totalExams,
            activeSessions,
            completedToday: Number(resultStatsRows[0]?.completed_today || 0),
            pendingReviews: Number(sessionStatsRows[0]?.pending_reviews || 0),
            completionRate,
            recentResults
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Bulk Upload Questions
exports.uploadBulkQuestions = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
        const { examId } = req.body;

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        const questions = data.map(row => ({
            question: row.question,
            options: [row.option1, row.option2, row.option3, row.option4],
            correct_answer: parseInt(row.correct_answer) - 1, // assuming 1-based in excel
            marks: row.marks || 1,
            difficulty: row.difficulty || 'Medium',
            topic: normalizeTopic(row.topic)
        }));

        if (examId) {
            const questionValues = questions.map(q => [
                examId, q.question, JSON.stringify(q.options), q.correct_answer, q.marks, normalizeDifficulty(q.difficulty), normalizeTopic(q.topic)
            ]);
            await pool.query(
                'INSERT INTO exam_questions (exam_id, question, options, correct_answer, marks, difficulty, topic) VALUES ?',
                [questionValues]
            );

            // Also update total_marks for the exam
            const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0);
            await pool.query(
                'UPDATE exams SET total_marks = (SELECT SUM(marks) FROM exam_questions WHERE exam_id = ?) WHERE id = ?',
                [examId, examId]
            );

            return res.json({ message: 'Questions uploaded and saved successfully', count: questions.length });
        }

        res.json({ message: 'Questions parsed successfully', questions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get All Results for Teacher
exports.getTeacherResults = async (req, res) => {
    try {
        const { sql: teacherScopeSql, params: teacherScopeParams } = getTeacherScope(req.user);
        const [results] = await pool.query(
            `
            SELECT 
                er.id,
                er.exam_id,
                er.score,
                er.total_questions,
                er.correct_answers,
                er.total_marks,
                er.submitted_at,
                s.username as student_name,
                s.email as student_email,
                e.title as exam_title,
                e.passing_marks,
                COALESCE(sw.warnings_count, 0) as warnings_count,
                ROUND(CASE WHEN er.total_marks > 0 THEN (er.score / er.total_marks) * 100 ELSE 0 END, 2) as score_percentage
            FROM exam_results er
            JOIN exams e ON er.exam_id = e.id
            JOIN students s ON er.student_id = s.id
            LEFT JOIN (
                SELECT exam_id, student_id, SUM(warnings_count) as warnings_count
                FROM exam_sessions
                GROUP BY exam_id, student_id
            ) sw ON sw.exam_id = er.exam_id AND sw.student_id = er.student_id
            WHERE e.is_deleted = FALSE${teacherScopeSql}
            ORDER BY er.submitted_at DESC
        `,
            teacherScopeParams
        );

        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Export Teacher Results (CSV/PDF)
exports.exportTeacherResults = async (req, res) => {
    try {
        const format = String(req.query.format || 'csv').trim().toLowerCase();
        if (!['csv', 'pdf'].includes(format)) {
            return res.status(400).json({ message: 'Invalid export format. Use csv or pdf.' });
        }

        const { sql: teacherScopeSql, params: teacherScopeParams } = getTeacherScope(req.user);
        const [rows] = await pool.query(
            `
            SELECT
                er.id,
                er.score,
                er.total_marks,
                er.submitted_at,
                s.username as student_name,
                s.email as student_email,
                e.title as exam_title,
                e.passing_marks,
                COALESCE(sw.warnings_count, 0) as warnings_count,
                ROUND(CASE WHEN er.total_marks > 0 THEN (er.score / er.total_marks) * 100 ELSE 0 END, 2) as score_percentage
            FROM exam_results er
            JOIN exams e ON er.exam_id = e.id
            JOIN students s ON er.student_id = s.id
            LEFT JOIN (
                SELECT exam_id, student_id, SUM(warnings_count) as warnings_count
                FROM exam_sessions
                GROUP BY exam_id, student_id
            ) sw ON sw.exam_id = er.exam_id AND sw.student_id = er.student_id
            WHERE e.is_deleted = FALSE${teacherScopeSql}
            ORDER BY er.submitted_at DESC
        `,
            teacherScopeParams
        );

        const now = new Date();
        const fileStamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');

        if (format === 'csv') {
            const headers = [
                'Student Name',
                'Student Email',
                'Exam',
                'Score',
                'Total Marks',
                'Percentage',
                'Status',
                'Warnings',
                'Submitted At'
            ];
            const lines = [headers.join(',')];

            rows.forEach((row) => {
                const score = Number(row.score || 0);
                const totalMarks = Number(row.total_marks || 0);
                const percentage = Number(row.score_percentage || 0);
                const status = score >= Number(row.passing_marks || 0) ? 'Pass' : 'Fail';
                lines.push([
                    escapeCsvCell(row.student_name),
                    escapeCsvCell(row.student_email),
                    escapeCsvCell(row.exam_title),
                    score,
                    totalMarks,
                    percentage,
                    status,
                    Number(row.warnings_count || 0),
                    escapeCsvCell(new Date(row.submitted_at).toISOString())
                ].join(','));
            });

            const csvContent = `${lines.join('\n')}\n`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=\"teacher-results-${fileStamp}.csv\"`);
            return res.send(csvContent);
        }

        const totalRecords = rows.length;
        const passCount = rows.filter(row => Number(row.score || 0) >= Number(row.passing_marks || 0)).length;
        const avgPercentage = totalRecords > 0
            ? Number((rows.reduce((acc, row) => acc + Number(row.score_percentage || 0), 0) / totalRecords).toFixed(2))
            : 0;

        const pdfLines = [
            'Teacher Results Export',
            `Generated At: ${now.toISOString()}`,
            `Total Records: ${totalRecords}`,
            `Pass Count: ${passCount}`,
            `Average Percentage: ${avgPercentage}%`,
            ''
        ];

        rows.forEach((row, index) => {
            const status = Number(row.score || 0) >= Number(row.passing_marks || 0) ? 'Pass' : 'Fail';
            pdfLines.push(
                `${index + 1}. ${row.student_name} (${row.student_email}) | ${row.exam_title} | ${row.score}/${row.total_marks} (${row.score_percentage}%) | ${status} | Warnings: ${row.warnings_count} | Submitted: ${new Date(row.submitted_at).toISOString()}`
            );
        });

        const pdfBuffer = buildSimplePdfBuffer(pdfLines);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=\"teacher-results-${fileStamp}.pdf\"`);
        return res.send(pdfBuffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get Results for Student (their own results)
exports.getStudentResults = async (req, res) => {
    try {
        const studentId = req.user.id;

        const [results] = await pool.query(`
            SELECT 
                er.id,
                er.exam_id,
                er.score,
                er.total_questions,
                er.correct_answers,
                er.total_marks,
                er.completion_time,
                er.submitted_at,
                e.title as exam_title,
                e.subject as exam_subject,
                e.passing_marks,
                elr.weak_topics,
                elr.practice_quiz,
                elr.class_remediation
            FROM exam_results er
            JOIN exams e ON er.exam_id = e.id
            LEFT JOIN exam_learning_recommendations elr ON er.id = elr.result_id
            WHERE er.student_id = ?
            ORDER BY er.submitted_at DESC
        `, [studentId]);

        const parsedResults = results.map(result => ({
            ...result,
            weak_topics: safeJsonParse(result.weak_topics, []),
            practice_quiz: safeJsonParse(result.practice_quiz, []),
            class_remediation: safeJsonParse(result.class_remediation, [])
        }));

        res.json({ results: parsedResults });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
// Helper: Create Notifications for target students when an exam is published
async function createExamNotifications(examId, title, dept, year) {
    try {
        let query = 'SELECT id FROM students WHERE 1=1';
        const params = [];

        if (dept) {
            query += ' AND department = ?';
            params.push(dept);
        }
        if (year) {
            query += ' AND year = ?';
            params.push(year);
        }

        const [students] = await pool.query(query, params);

        if (students.length > 0) {
            const notificationValues = students.map(s => [
                s.id,
                'student',
                'New Exam Assigned',
                `A new exam "${title}" has been assigned to your department/year.`,
                `/student/exams`
            ]);

            await pool.query(
                'INSERT INTO notifications (user_id, user_type, title, message, link) VALUES ?',
                [notificationValues]
            );
        }
    } catch (error) {
        console.error('Error creating exam notifications:', error);
    }
}
// Get Detailed Item Analysis (Exam Health)
exports.getExamItemAnalysis = async (req, res) => {
    try {
        const { examId } = req.params;
        const exam = await getAuthorizedExam(Number(examId), req.user);
        if (!exam) return res.status(404).json({ message: 'Exam not found or unauthorized' });

        const [rows] = await pool.query(
            `SELECT 
                eq.id,
                eq.question,
                eq.options,
                eq.correct_answer,
                eq.difficulty,
                eq.topic,
                COUNT(sr.id) as attempts,
                SUM(CASE WHEN sr.selected_option = eq.correct_answer THEN 1 ELSE 0 END) as correct_responses,
                AVG(sr.time_spent) as avg_time_seconds,
                SUM(CASE WHEN sr.selected_option = 0 THEN 1 ELSE 0 END) as opt0_count,
                SUM(CASE WHEN sr.selected_option = 1 THEN 1 ELSE 0 END) as opt1_count,
                SUM(CASE WHEN sr.selected_option = 2 THEN 1 ELSE 0 END) as opt2_count,
                SUM(CASE WHEN sr.selected_option = 3 THEN 1 ELSE 0 END) as opt3_count,
                SUM(CASE WHEN sr.selected_option IS NULL THEN 1 ELSE 0 END) as skipped_count
             FROM exam_questions eq
             LEFT JOIN student_responses sr ON eq.id = sr.question_id
             WHERE eq.exam_id = ?
             GROUP BY eq.id`,
            [examId]
        );

        const analyzedQuestions = rows.map(q => {
            const attempts = Number(q.attempts || 0);
            const corrects = Number(q.correct_responses || 0);
            const successRate = attempts > 0 ? (corrects / attempts) * 100 : 0;
            
            // Ambiguity detection (Simple: if standard deviation of option selection is low, it's mixed)
            const optCounts = [Number(q.opt0_count), Number(q.opt1_count), Number(q.opt2_count), Number(q.opt3_count)];
            const nonZeroOpts = optCounts.filter(c => c > 0).length;
            
            // Ambiguity threshold: If students are split significantly across 3 or more options
            const isAmbiguous = attempts > 5 && nonZeroOpts >= 3 && (corrects / attempts) < 0.4;
            const isHard = attempts > 5 && successRate < 30;

            return {
                id: q.id,
                question: q.question,
                topic: q.topic,
                difficulty: q.difficulty,
                correct_answer: q.correct_answer,
                attempts,
                successRate: Number(successRate.toFixed(2)),
                avgTime: Number(Number(q.avg_time_seconds || 0).toFixed(1)),
                optionDistribution: optCounts,
                skippedCount: Number(q.skipped_count || 0),
                healthTags: [
                    ...(isAmbiguous ? ['Ambiguous'] : []),
                    ...(isHard ? ['High Difficulty'] : []),
                    ...(attempts > 0 && successRate > 85 ? ['Concept Mastered'] : [])
                ]
            };
        });

        // Overall Exam Health Metrics
        const overallSuccessRate = analyzedQuestions.length > 0 
            ? analyzedQuestions.reduce((sum, q) => sum + q.successRate, 0) / analyzedQuestions.length 
            : 0;

        // ── GENREATE AI HEALTH INSIGHTS ────────────────────────────────────
        let aiSummary = '';
        try {
            const prompt = `
            Analyze this exam performance data and provide a professional 2-sentence summary for the teacher.
            Exam: ${exam.title}
            Overall Success Rate: ${overallSuccessRate.toFixed(2)}%
            Total Questions Analyzed: ${analyzedQuestions.length}
            Hardest Topics: ${[...new Set(analyzedQuestions.filter(q => q.successRate < 50).map(q => q.topic))].join(', ') || 'None'}
            Ambiguous Questions Found: ${analyzedQuestions.filter(q => q.healthTags.includes('Ambiguous')).length}
            
            Identify if the exam was too hard, well-balanced, or too easy, and provide one actionable recommendation.
            `;
            const { content } = await generateText({
                taskType: 'reporting',
                prompt,
                temperature: 0.5,
                groqModel: 'llama-3.1-8b-instant'
            });
            aiSummary = content;
        } catch (aiErr) {
            console.warn('[AI] Health Summary failed:', aiErr.message);
        }
        // ──────────────────────────────────────────────────────────────────

        res.json({
            examTitle: exam.title,
            aiSummary,
            metrics: {
                overallSuccessRate: Number(overallSuccessRate.toFixed(2)),
                hardestQuestions: analyzedQuestions.filter(q => q.successRate < 40).sort((a,b) => a.successRate - b.successRate).slice(0, 5),
                longestQuestions: [...analyzedQuestions].sort((a,b) => b.avgTime - a.avgTime).slice(0, 5),
                ambiguousQuestions: analyzedQuestions.filter(q => q.healthTags.includes('Ambiguous'))
            },
            allQuestions: analyzedQuestions
        });

    } catch (error) {
        console.error('ITEM_ANALYSIS_ERROR', error);
        res.status(500).json({ error: error.message });
    }
};

exports.saveExamSnapshot = async (req, res) => {
    try {
        const { sessionId, snapshotData } = req.body;
        if (!sessionId || !snapshotData) {
            return res.status(400).json({ message: 'Missing sessionId or snapshotData' });
        }

        const studentId = req.user.id;

        const [sessionCheck] = await pool.query(
            'SELECT id FROM exam_sessions WHERE id = ? AND student_id = ? AND status = "active"',
            [sessionId, studentId]
        );

        if (sessionCheck.length === 0) {
            return res.status(403).json({ error: 'Unauthorized: Invalid or inactive session.' });
        }

        await pool.query(
            'INSERT INTO exam_warnings (session_id, warning_type, message, snapshot_data) VALUES (?, ?, ?, ?)',
            [sessionId, 'periodic-snapshot', 'Automated security snapshot', snapshotData]
        );

        res.json({ message: 'Snapshot saved successfully' });
    } catch (error) {
        console.error('Error saving snapshot:', error);
        res.status(500).json({ error: error.message });
    }
};

exports.getResultScript = async (req, res) => {
    try {
        const { resultId } = req.params;
        
        // 1. Get the result details with student info
        const [results] = await pool.query(
            `SELECT er.*, u.username, u.email, e.title as exam_title 
             FROM exam_results er
             JOIN users u ON er.student_id = u.id
             JOIN exams e ON er.exam_id = e.id
             WHERE er.id = ?`,
            [resultId]
        );

        if (results.length === 0) {
            return res.status(404).json({ error: "Result not found" });
        }

        const resultRecord = results[0];

        // 2. Get the student responses joined with questions
        const [responses] = await pool.query(
            `SELECT sr.*, q.question, q.options, q.correct_answer, q.topic, q.marks
             FROM student_responses sr
             JOIN exam_questions q ON sr.question_id = q.id
             WHERE sr.result_id = ?
             ORDER BY q.id ASC`,
            [resultId]
        );

        res.json({
            result: resultRecord,
            questions: responses.map(r => ({
                ...r,
                options: JSON.parse(r.options)
            }))
        });
    } catch (error) {
        console.error("GET_SCRIPT_ERROR", error);
        res.status(500).json({ error: "Failed to fetch exam script" });
    }
};
