const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

const { authMiddleware, roleMiddleware, mainAdminMiddleware } = require('../middleware/auth');
const validate = require('../middleware/validate');
const authValidation = require('../validations/auth.validation');

// Public routes - Login only
router.post('/teacher/login', validate(authValidation.teacherLogin), authController.loginTeacher);
router.post('/student/login', validate(authValidation.studentLogin), authController.loginStudent);

// Public registration disabled - only admins can create accounts
// router.post('/teacher/register', authController.registerTeacher);
// router.post('/student/register', authController.registerStudent);

// Protected routes
router.post('/logout', authMiddleware, authController.logout);
router.put('/change-password', authMiddleware, validate(authValidation.changePassword), authController.changePassword);

// Admin-only routes (main admin only for teachers)
router.post('/admin/create-teacher', authMiddleware, mainAdminMiddleware, validate(authValidation.createTeacher), authController.adminCreateTeacher);
router.post('/admin/bulk-teachers', authMiddleware, mainAdminMiddleware, authController.adminCreateBulkTeachers);
router.get('/admin/teachers', authMiddleware, mainAdminMiddleware, authController.getAllTeachers);

// Teacher routes (all teachers can manage students)
router.post('/admin/create-student', authMiddleware, roleMiddleware(['teacher']), validate(authValidation.createStudent), authController.adminCreateStudent);
router.post('/admin/bulk-students', authMiddleware, roleMiddleware(['teacher']), authController.adminCreateBulkStudents);
router.get('/admin/students', authMiddleware, roleMiddleware(['teacher']), authController.getAllStudents);
router.delete('/admin/user/:role/:id', authMiddleware, (req, res, next) => {
    if (req.params.role === 'teacher') return mainAdminMiddleware(req, res, next);
    return roleMiddleware(['teacher'])(req, res, next);
}, authController.deleteUser);

router.delete('/admin/bulk-delete/:role', authMiddleware, (req, res, next) => {
    if (req.params.role === 'teacher') return mainAdminMiddleware(req, res, next);
    return roleMiddleware(['teacher'])(req, res, next);
}, authController.bulkDeleteUsers);

router.put('/admin/user/:role/:id/toggle-block', authMiddleware, (req, res, next) => {
    if (req.params.role === 'teacher') return mainAdminMiddleware(req, res, next);
    return roleMiddleware(['teacher'])(req, res, next);
}, authController.toggleBlockUser);

module.exports = router;
