const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const path = require('path');
const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowedExts = ['.csv', '.xlsx', '.xls', '.json'];
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedMimes = [
            'text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/json'
        ];
        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only CSV, Excel, or JSON files are allowed.'), false);
        }
    }
});
const validate = require('../middleware/validate');
const examValidation = require('../validations/exam.validation');

// Teacher routes
router.post('/create', authMiddleware, roleMiddleware(['teacher']), validate(examValidation.createExam), examController.createExam);
router.post('/upload-bulk', authMiddleware, roleMiddleware(['teacher']), upload.single('file'), examController.uploadBulkQuestions);
router.get('/teacher/my-exams', authMiddleware, roleMiddleware(['teacher']), examController.getTeacherExams);
router.delete('/teacher/delete/:id', authMiddleware, roleMiddleware(['teacher']), examController.deleteExam);
router.get('/teacher/stats', authMiddleware, roleMiddleware(['teacher']), examController.getDashboardStats);
router.get('/teacher/analytics', authMiddleware, roleMiddleware(['teacher']), examController.getTeacherAnalytics);
router.get('/teacher/results', authMiddleware, roleMiddleware(['teacher']), examController.getTeacherResults);
router.get('/teacher/results/export', authMiddleware, roleMiddleware(['teacher']), examController.exportTeacherResults);
router.get('/teacher/result/:resultId/script', authMiddleware, roleMiddleware(['teacher']), examController.getResultScript);
router.get('/teacher/details/:id', authMiddleware, roleMiddleware(['teacher']), examController.getTeacherExamDetails);
router.put('/teacher/edit/:id', authMiddleware, roleMiddleware(['teacher']), validate(examValidation.updateExam), examController.updateExam);
router.put('/teacher/schedule/:id', authMiddleware, roleMiddleware(['teacher']), validate(examValidation.scheduleExam), examController.scheduleExam);
router.get('/teacher/active-sessions/:examId', authMiddleware, roleMiddleware(['teacher']), examController.getActiveSessions);
router.get('/teacher/proctoring/:examId/timeline', authMiddleware, roleMiddleware(['teacher']), examController.getProctoringTimeline);
router.get('/teacher/proctoring/session/:sessionId/log', authMiddleware, roleMiddleware(['teacher']), examController.getSessionAuditTrail);
router.post('/teacher/proctoring/session/:sessionId/action', authMiddleware, roleMiddleware(['teacher']), examController.applyProctorAction);
router.get('/teacher/exam-health/:examId', authMiddleware, roleMiddleware(['teacher']), examController.getExamItemAnalysis);

// Student routes
router.get('/student/available', authMiddleware, roleMiddleware(['student']), examController.getAvailableExams);
router.get('/student/results', authMiddleware, roleMiddleware(['student']), examController.getStudentResults);
router.get('/:id', authMiddleware, roleMiddleware(['student']), examController.getExamDetails);
router.post('/session/start', authMiddleware, roleMiddleware(['student']), examController.startExamSession);
router.post('/session/warning', authMiddleware, roleMiddleware(['student']), examController.logWarning);
router.post('/session/snapshot', authMiddleware, roleMiddleware(['student']), examController.saveExamSnapshot);
router.post('/session/response', authMiddleware, roleMiddleware(['student']), examController.updateResponse);
router.post('/submit', authMiddleware, roleMiddleware(['student']), examController.submitExam);

module.exports = router;
