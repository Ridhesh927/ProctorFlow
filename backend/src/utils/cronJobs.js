const cron = require('node-cron');
const { pool } = require('../config/db');
const logger = require('./logger');

const startCronJobs = () => {
    // Run every minute to check for expired exams
    cron.schedule('* * * * *', async () => {
        try {
            const [result] = await pool.query("UPDATE exams SET status = 'Completed' WHERE expires_at < NOW() AND status != 'Completed'");
            if (result.affectedRows > 0) {
                logger('CRON_JOB', `Auto-marked ${result.affectedRows} expired exams as Completed.`);
                console.log(`[CRON] Auto-marked ${result.affectedRows} expired exams as Completed.`);
            }
        } catch (error) {
            logger('CRON_ERROR', 'Failed to auto-delete expired exams', { error: error.message });
            console.error('[CRON ERROR]', error);
        }
    });

    console.log('Cron jobs initialized: Auto-delete expired exams scheduled.');

    // Run every 15 minutes to delete demo-created student accounts older than 1 hour
    cron.schedule('*/15 * * * *', async () => {
        try {
            // First delete associated notifications to prevent foreign key constraint issues or orphans
            await pool.query(`
                DELETE FROM notifications 
                WHERE user_type = 'student' 
                  AND user_id IN (
                      SELECT id FROM students 
                      WHERE created_by_demo = TRUE AND created_at < NOW() - INTERVAL 1 HOUR
                  )
            `);

            // Then delete the students
            const [result] = await pool.query(`
                DELETE FROM students 
                WHERE created_by_demo = TRUE AND created_at < NOW() - INTERVAL 1 HOUR
            `);
            
            if (result.affectedRows > 0) {
                logger('CRON_JOB', `Auto-deleted ${result.affectedRows} demo-created student accounts.`);
                console.log(`[CRON] Auto-deleted ${result.affectedRows} demo-created student accounts.`);
            }
        } catch (error) {
            logger('CRON_ERROR', 'Failed to auto-delete demo student accounts', { error: error.message });
            console.error('[CRON ERROR] Demo accounts cleanup failed:', error);
        }
    });
    console.log('Cron jobs initialized: Auto-delete demo student accounts scheduled.');
};

module.exports = { startCronJobs };
