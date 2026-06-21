const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD must be configured in environment variables.');
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'exam_portal_v2',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 20),
    queueLimit: 0
});
const DB_NAME = process.env.DB_NAME || 'exam_portal_v2';

const hasColumn = async (connection, tableName, columnName) => {
    const currentDbName = process.env.DB_NAME || 'exam_portal_v2';
    const [rows] = await connection.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [currentDbName, tableName, columnName]
    );
    return rows.length > 0;
};

const ensureColumn = async (connection, tableName, columnName, definitionSql) => {
    // Sanitize parameters to prevent dynamic SQL injection
    if (!/^[a-zA-Z0-9_]+$/.test(tableName) || !/^[a-zA-Z0-9_]+$/.test(columnName)) {
        throw new Error('Invalid table or column name in schema generation');
    }

    const exists = await hasColumn(connection, tableName, columnName);
    if (!exists) {
        try {
            await connection.query(
                `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`
            );
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
    }
};

const ensureSecurityColumns = async (connection) => {
    const currentDbName = process.env.DB_NAME || 'exam_portal_v2';
    const [rows] = await connection.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = 'teachers'
           AND COLUMN_NAME = 'is_main_admin'
         LIMIT 1`,
        [currentDbName]
    );

    try {
        if (!rows.length) {
            await connection.query(
                'ALTER TABLE teachers ADD COLUMN is_main_admin BOOLEAN DEFAULT FALSE'
            );
        }

        // Added by the system: ensure the created_by_demo tracking column exists
        await ensureColumn(connection, 'students', 'created_by_demo', 'BOOLEAN DEFAULT FALSE');

    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
};

const ensureExamEnhancementSchema = async (connection) => {
    await ensureColumn(connection, 'exam_questions', 'topic', "VARCHAR(255) DEFAULT 'General'");
    await ensureColumn(connection, 'exam_results', 'total_marks', 'INT NOT NULL DEFAULT 0');
    await ensureColumn(connection, 'exam_sessions', 'is_suspended', 'BOOLEAN DEFAULT FALSE');

    await connection.query(
        `CREATE TABLE IF NOT EXISTS exam_session_actions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_id INT NOT NULL,
            exam_id INT NOT NULL,
            student_id INT NOT NULL,
            action_type VARCHAR(100) NOT NULL,
            reason TEXT NULL,
            actioned_by INT NULL,
            actioned_by_role ENUM('teacher', 'student', 'system') DEFAULT 'system',
            metadata JSON DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_exam_session_actions_session (session_id),
            INDEX idx_exam_session_actions_exam_student (exam_id, student_id),
            FOREIGN KEY (session_id) REFERENCES exam_sessions (id) ON DELETE CASCADE,
            FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
        )`
    );

    await connection.query(
        `CREATE TABLE IF NOT EXISTS exam_learning_recommendations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            result_id INT NOT NULL UNIQUE,
            exam_id INT NOT NULL,
            student_id INT NOT NULL,
            weak_topics JSON DEFAULT NULL,
            practice_quiz JSON DEFAULT NULL,
            class_remediation JSON DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_learning_exam_student (exam_id, student_id),
            FOREIGN KEY (result_id) REFERENCES exam_results (id) ON DELETE CASCADE,
            FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
        )`
    );

    await connection.query(
        `UPDATE exam_results er
         JOIN exams e ON er.exam_id = e.id
         SET er.total_marks = e.total_marks
         WHERE COALESCE(er.total_marks, 0) = 0`
    );
};

const ensureMainAdminAccount = async (connection) => {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminUsername = process.env.ADMIN_USERNAME || 'Main Admin';

    if (!adminEmail || !adminPassword) {
        console.warn('ADMIN_EMAIL/ADMIN_PASSWORD are not configured. Main admin bootstrap skipped.');
        return;
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    const [rows] = await connection.query('SELECT id FROM teachers WHERE email = ?', [adminEmail]);

    if (rows.length === 0) {
        await connection.query(
            'INSERT INTO teachers (username, email, password, is_main_admin, is_blocked) VALUES (?, ?, ?, TRUE, FALSE)',
            [adminUsername, adminEmail, hashedPassword]
        );
        console.log('Main admin account bootstrapped successfully.');
        return;
    }

    await connection.query(
        'UPDATE teachers SET username = ?, password = ?, is_main_admin = TRUE, is_blocked = FALSE WHERE id = ?',
        [adminUsername, hashedPassword, rows[0].id]
    );
    console.log('Main admin account synchronized successfully.');
};

const ensureTestAccounts = async (connection) => {
    const testTeacherEmail = 'teacher@test.com';
    const testStudentEmail = 'student@test.com';
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 12);

    // Check teacher
    const [teacherRows] = await connection.query('SELECT id FROM teachers WHERE email = ?', [testTeacherEmail]);
    if (teacherRows.length === 0) {
        await connection.query(
            'INSERT INTO teachers (username, email, password, is_main_admin, is_blocked) VALUES (?, ?, ?, FALSE, FALSE)',
            ['Demo Teacher', testTeacherEmail, hashedPassword]
        );
        console.log(`Demo teacher account created: ${testTeacherEmail} / ${password}`);
    }

    // Check student
    const [studentRows] = await connection.query('SELECT id FROM students WHERE email = ?', [testStudentEmail]);
    if (studentRows.length === 0) {
        const prn = 'TEST_STUDENT_001';
        await connection.query(
            'INSERT INTO students (username, email, password, prn_number, department, year, is_blocked) VALUES (?, ?, ?, ?, ?, ?, FALSE)',
            ['Demo Student', testStudentEmail, hashedPassword, prn, 'CS', '3']
        );
        console.log(`Demo student account created: PRN: ${prn} / ${password}`);
    }
};

const initDB = async () => {
    try {
        console.log('Connecting to MySQL Database for initialization...');
        
        // Use a dedicated multi-statement connection for schema initialization
        const initConn = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'exam_portal_v2',
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
            multipleStatements: true
        });

        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Execute schema securely
        await initConn.query(schema);

        await ensureSecurityColumns(initConn);
        await ensureExamEnhancementSchema(initConn);
        await ensureMainAdminAccount(initConn);
        await ensureTestAccounts(initConn);

        console.log('Database initialized successfully.');
        await initConn.end();
    } catch (error) {
        console.error('CRITICAL: Error initializing database:', error);
        process.exit(1);
    }
};

module.exports = { pool, initDB };
