const { pool } = require('../config/db');

// Fetch all notifications for the logged-in user
exports.getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.role; // 'student' or 'teacher'

        const [rows] = await pool.query(
            'SELECT * FROM notifications WHERE user_id = ? AND user_type = ? ORDER BY created_at DESC LIMIT 50',
            [userId, userType]
        );

        res.json({ success: true, notifications: rows });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
};

// Mark a specific notification as read
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const userType = req.user.role;

        await pool.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ? AND user_type = ?',
            [id, userId, userType]
        );

        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
};

// Mark all notifications as read for the user
exports.markAllRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.role;

        await pool.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND user_type = ?',
            [userId, userType]
        );

        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ success: false, message: 'Failed to update notifications' });
    }
};

// Delete a specific notification
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const userType = req.user.role;

        await pool.query(
            'DELETE FROM notifications WHERE id = ? AND user_id = ? AND user_type = ?',
            [id, userId, userType]
        );

        res.json({ success: true, message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ success: false, message: 'Failed to delete notification' });
    }
};

// Clear all notifications for the user
exports.clearAllNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.role;

        await pool.query(
            'DELETE FROM notifications WHERE user_id = ? AND user_type = ?',
            [userId, userType]
        );

        res.json({ success: true, message: 'All notifications cleared successfully' });
    } catch (error) {
        console.error('Error clearing notifications:', error);
        res.status(500).json({ success: false, message: 'Failed to clear notifications' });
    }
};

// Internal helper to create a notification
exports.createNotification = async (userId, userType, title, message, link = null) => {
    try {
        await pool.query(
            'INSERT INTO notifications (user_id, user_type, title, message, link) VALUES (?, ?, ?, ?, ?)',
            [userId, userType, title, message, link]
        );
        return true;
    } catch (error) {
        console.error('Error creating notification:', error);
        return false;
    }
};
