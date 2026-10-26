const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const resumeUpload = require('../middleware/resumeUpload');

// Student routes
router.get('/', authMiddleware, jobController.getAllJobs);
router.get('/my-applications', authMiddleware, roleMiddleware(['student']), jobController.getMyApplications);
router.post('/apply/:jobId', authMiddleware, roleMiddleware(['student']), resumeUpload.single('resume'), jobController.applyForJob);

// Teacher/Admin routes
router.post('/create', authMiddleware, roleMiddleware(['teacher', 'admin']), jobController.createJob);
router.get('/:jobId/applications', authMiddleware, roleMiddleware(['teacher', 'admin']), jobController.getJobApplications);
router.get('/applications/:appId/resume', authMiddleware, jobController.downloadResume);
router.delete('/:jobId', authMiddleware, roleMiddleware(['teacher', 'admin']), jobController.deleteJob);
router.delete('/applications/:appId', authMiddleware, jobController.deleteApplication);

module.exports = router;
