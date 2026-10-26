const express = require('express');
const { generateQuestions } = require('../controllers/aiController.js');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.js');

const path = require('path');
const multer = require('multer');

const allowedMimes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
];
const allowedExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt', '.png', '.jpg', '.jpeg', '.webp'];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type for question generation.'), false);
        }
    }
});

const router = express.Router();

// Only teachers and admins can generate questions
router.post('/generate-questions', authMiddleware, roleMiddleware(['teacher', 'admin']), upload.single('file'), generateQuestions);

module.exports = router;
