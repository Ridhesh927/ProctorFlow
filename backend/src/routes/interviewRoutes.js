const express = require('express');
const router = express.Router();
const interviewController = require('../controllers/interviewController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const path = require('path');
const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/') || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid resume file type. Only PDF and images are allowed.'), false);
        }
    }
});

// All these routes are strictly for students preparing for interviews
router.use(authMiddleware);
router.use(roleMiddleware(['student']));

// 1. Upload Resume (PDF/Image)
router.post('/upload-resume', upload.single('file'), interviewController.uploadResume);

// 2. Generate new tailored interview
router.post('/generate', interviewController.generateInterview);

// 3. Get history of interviews and resume status
router.get('/history', interviewController.getInterviews);

// 4. Get specific interview (questions for taking the test, or review)
router.get('/:id', interviewController.getInterviewDetails);

// 5. Submit interview for grading and AI feedback
router.post('/:id/submit', interviewController.submitInterview);

module.exports = router;
