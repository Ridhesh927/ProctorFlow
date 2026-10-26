const { pool } = require('../config/db');
const { generateText } = require('../utils/aiClient');
const path = require('path');
const fs = require('fs');

const RESUMES_UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/resumes');

const safeUnlinkResume = (filename) => {
    if (!filename) return;

    // Only allow simple filenames (no path segments)
    if (path.basename(filename) !== filename) return;

    const resolvedPath = path.resolve(RESUMES_UPLOAD_ROOT, filename);
    const isWithinRoot =
        resolvedPath === RESUMES_UPLOAD_ROOT ||
        resolvedPath.startsWith(RESUMES_UPLOAD_ROOT + path.sep);

    if (!isWithinRoot) return;

    fs.unlink(resolvedPath, () => {});
};

// Auto-add resume_filename column
if (process.env.NODE_ENV !== 'test') {
    (async () => {
        try {
            await pool.query(
                `ALTER TABLE job_applications ADD COLUMN resume_filename VARCHAR(255) NULL`
            );
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('Failed to add resume_filename column:', err.message);
            }
        }
        try {
            await pool.query(
                `ALTER TABLE jobs ADD COLUMN max_applications INT NULL`
            );
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('Failed to add max_applications column:', err.message);
            }
        }
        try {
            await pool.query(
                `ALTER TABLE jobs ADD COLUMN expires_at DATETIME NULL`
            );
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('Failed to add expires_at column:', err.message);
            }
        }
    })();
}

const jobController = {
    getAllJobs: async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT j.*, t.username as author, 
                        (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id AND ja.status = 'Applied') as pending_count,
                        (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) as total_count,
                        (SELECT AVG(ja.ai_match_score) FROM job_applications ja WHERE ja.job_id = j.id) as avg_match_score
                 FROM jobs j 
                 LEFT JOIN teachers t ON j.created_by = t.id 
                 WHERE j.status = "Open" 
                 ORDER BY j.created_at DESC`
            );
            res.json(rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    createJob: async (req, res) => {
        try {
            const { title, company, location, job_type, description, requirements, salary_range, max_applications, expires_at } = req.body;
            const teacher_id = req.user.id;
            const limit = max_applications ? parseInt(max_applications, 10) : null;
            const expireDate = expires_at ? new Date(expires_at) : null;

            const [result] = await pool.query(
                'INSERT INTO jobs (title, company, location, job_type, description, requirements, salary_range, created_by, max_applications, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [title, company, location, job_type, description, requirements, salary_range, teacher_id, limit, expireDate]
            );

            res.status(201).json({ message: 'Job posted successfully', jobId: result.insertId });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    applyForJob: async (req, res) => {
        try {
            const jobId = req.params.jobId;
            const student_id = req.user.id;
            const resume_filename = req.file ? req.file.filename : null;

            if (!resume_filename) {
                return res.status(400).json({ message: 'Resume upload is required' });
            }

            // Check capacity limit and expiry
            const [jobInfo] = await pool.query('SELECT max_applications, expires_at FROM jobs WHERE id = ?', [jobId]);
            if (jobInfo.length === 0) return res.status(404).json({ message: 'Job not found' });
            
            const maxApps = jobInfo[0].max_applications;
            const expiresAt = jobInfo[0].expires_at;
            
            if (expiresAt && new Date() > new Date(expiresAt)) {
                safeUnlinkResume(resume_filename);
                return res.status(400).json({ message: 'This job posting has expired.' });
            }

            if (maxApps !== null) {
                const [countInfo] = await pool.query("SELECT COUNT(*) as cnt FROM job_applications WHERE job_id = ? AND status = 'Applied'", [jobId]);
                if (countInfo[0].cnt >= maxApps) {
                    safeUnlinkResume(resume_filename);
                    return res.status(400).json({ message: 'Application limit reached for this position.' });
                }
            }

            const [existing] = await pool.query(
                'SELECT id FROM job_applications WHERE job_id = ? AND student_id = ?',
                [jobId, student_id]
            );

            if (existing.length > 0) {
                // Clean up uploaded file if already applied
                safeUnlinkResume(resume_filename);
                return res.status(400).json({ message: 'You have already applied for this position' });
            }

            await pool.query(
                'INSERT INTO job_applications (job_id, student_id, ai_match_score, resume_filename) VALUES (?, ?, ?, ?)',
                [jobId, student_id, 0, resume_filename]
            );

            res.status(201).json({ message: 'Application submitted successfully', hasResume: !!resume_filename });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    getMyApplications: async (req, res) => {
        try {
            const student_id = req.user.id;
            const [rows] = await pool.query(
                'SELECT job_id, resume_filename IS NOT NULL as has_resume FROM job_applications WHERE student_id = ?',
                [student_id]
            );
            res.json(rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    getJobApplications: async (req, res) => {
        try {
            const jobId = req.params.jobId;
            const userId = req.user.id;

            // Authorization check
            const [jobCheck] = await pool.query('SELECT created_by FROM jobs WHERE id = ?', [jobId]);
            if (jobCheck.length === 0) return res.status(404).json({ message: 'Job not found' });
            if (jobCheck[0].created_by !== userId && !req.user.isMainAdmin) {
                return res.status(403).json({ message: 'Unauthorized to view applications for this job' });
            }

            const [rows] = await pool.query(
                `SELECT ja.id, ja.status, ja.applied_at, ja.resume_filename, ja.ai_match_score,
                        s.username as student_name, s.email
                 FROM job_applications ja
                 JOIN students s ON ja.student_id = s.id
                 WHERE ja.job_id = ?
                 ORDER BY ja.applied_at DESC`,
                [jobId]
            );
            res.json(rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    downloadResume: async (req, res) => {
        try {
            const { appId } = req.params;
            const userId = req.user.id;

            // Fetch application and the job it belongs to
            const [rows] = await pool.query(
                `SELECT ja.resume_filename, ja.student_id, j.created_by as teacher_id 
                 FROM job_applications ja 
                 JOIN jobs j ON ja.job_id = j.id 
                 WHERE ja.id = ?`,
                [appId]
            );

            if (!rows.length || !rows[0].resume_filename) {
                return res.status(404).json({ message: 'No resume attached to this application' });
            }

            const isOwner = req.user.role === 'student' && rows[0].student_id === userId;
            const isJobCreator = req.user.role === 'teacher' && rows[0].teacher_id === userId;

            if (!isOwner && !isJobCreator && !req.user.isMainAdmin) {
                return res.status(403).json({ message: 'Unauthorized to view this resume' });
            }

            const filename = path.basename(rows[0].resume_filename);
            const filePath = path.resolve(RESUMES_UPLOAD_ROOT, filename);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: 'Resume file not found on server' });
            }

            res.sendFile(filePath);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    deleteJob: async (req, res) => {
        try {
            const jobId = req.params.jobId;
            const teacher_id = req.user.id;
            
            // Check auth (assuming only creator or admin can delete)
            const [job] = await pool.query('SELECT * FROM jobs WHERE id = ?', [jobId]);
            if (job.length === 0) return res.status(404).json({ message: 'Job not found' });
            if (job[0].created_by !== teacher_id && !req.user.isMainAdmin) {
                return res.status(403).json({ message: 'Not authorized to delete this job' });
            }
            
            await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
            await pool.query('DELETE FROM job_applications WHERE job_id = ?', [jobId]);
            
            res.json({ message: 'Job deleted successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    deleteApplication: async (req, res) => {
        try {
            const appId = req.params.appId;
            const userId = req.user.id;

            const [apps] = await pool.query(
                `SELECT ja.resume_filename, ja.student_id, j.created_by as teacher_id 
                 FROM job_applications ja 
                 JOIN jobs j ON ja.job_id = j.id 
                 WHERE ja.id = ?`,
                [appId]
            );

            if (apps.length === 0) {
                return res.status(404).json({ message: 'Application not found' });
            }

            const isOwner = req.user.role === 'student' && apps[0].student_id === userId;
            const isJobCreator = req.user.role === 'teacher' && apps[0].teacher_id === userId;

            if (!isOwner && !isJobCreator && !req.user.isMainAdmin) {
                return res.status(403).json({ message: 'Unauthorized to delete this application' });
            }

            if (apps[0].resume_filename) {
                safeUnlinkResume(apps[0].resume_filename);
            }

            await pool.query('DELETE FROM job_applications WHERE id = ?', [appId]);
            res.json({ message: 'Application deleted successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = jobController;
