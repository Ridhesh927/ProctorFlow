
-- Teachers Table
CREATE TABLE IF NOT EXISTS teachers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    is_main_admin BOOLEAN DEFAULT FALSE,
    is_blocked BOOLEAN DEFAULT FALSE,
    last_token VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (last_token)
);

-- Students Table
CREATE TABLE IF NOT EXISTS students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    prn_number VARCHAR(50) NOT NULL UNIQUE,
    department VARCHAR(255) DEFAULT NULL,
    year VARCHAR(50) DEFAULT NULL,
    is_blocked BOOLEAN DEFAULT FALSE,
    created_by_demo BOOLEAN DEFAULT FALSE,
    resume_text LONGTEXT DEFAULT NULL,
    parsed_skills JSON DEFAULT NULL,
    last_token VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (last_token)
);

-- Exams Table
CREATE TABLE IF NOT EXISTS exams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    duration INT NOT NULL, -- in minutes
    scheduled_start DATETIME,
    total_marks INT NOT NULL,
    status ENUM(
        'Draft',
        'Published',
        'Scheduled',
        'Completed'
    ) DEFAULT 'Published',
    passing_marks INT NOT NULL,
    instructions TEXT,
    teacher_id INT,
    target_department VARCHAR(255) DEFAULT NULL,
    target_year VARCHAR(50) DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (status),
    FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
);

-- Exam Questions Table
CREATE TABLE IF NOT EXISTS exam_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    exam_id INT,
    question TEXT NOT NULL,
    options JSON NOT NULL, -- Array of strings
    correct_answer INT NOT NULL, -- Index 0-3
    marks INT DEFAULT 1,
    difficulty ENUM('Easy', 'Medium', 'High') DEFAULT 'Medium',
    topic VARCHAR(255) DEFAULT 'General',
    FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE
);

-- Exam Results Table
CREATE TABLE IF NOT EXISTS exam_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    exam_id INT,
    student_id INT,
    score INT NOT NULL,
    total_questions INT NOT NULL,
    correct_answers INT NOT NULL,
    total_marks INT NOT NULL DEFAULT 0,
    completion_time INT NOT NULL, -- in seconds
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (exam_id),
    INDEX (student_id),
    FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
);

-- Student Sessions (for proctoring/tracking)
CREATE TABLE IF NOT EXISTS exam_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT,
    exam_id INT,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP NULL,
    warnings_count INT DEFAULT 0,
    is_suspended BOOLEAN DEFAULT FALSE,
    status ENUM(
        'active',
        'completed',
        'terminated'
    ) DEFAULT 'active',
    INDEX (student_id),
    INDEX (exam_id),
    FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE
);

-- Detailed Warnings Log
CREATE TABLE IF NOT EXISTS exam_warnings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT,
    warning_type VARCHAR(100), -- 'tab-switch', 'multiple-faces', 'no-face', 'fullscreen-exit', 'talking'
    message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES exam_sessions (id) ON DELETE CASCADE
);

-- Session Actions Audit Trail (warn/suspend/terminate/system actions)
CREATE TABLE IF NOT EXISTS exam_session_actions (
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
);

-- Individual Question Responses (for detailed tracking)
CREATE TABLE IF NOT EXISTS student_responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT,
    question_id INT,
    selected_option INT, -- Index of option
    time_spent INT, -- in seconds for this question
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES exam_sessions (id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES exam_questions (id) ON DELETE CASCADE
);

-- Adaptive Learning Recommendations generated post-submission
CREATE TABLE IF NOT EXISTS exam_learning_recommendations (
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
);

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    user_type ENUM('student', 'teacher') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    link VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (user_id, user_type)
);

-- AI Interview Preparation Tables

CREATE TABLE IF NOT EXISTS interviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT,
    job_role_target VARCHAR(255) NOT NULL,
    coding_id INT NULL,
    total_score INT DEFAULT 0,
    ai_feedback TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    interview_id INT,
    question TEXT NOT NULL,
    options JSON NOT NULL, -- Array of strings (keeping MCQ format for now)
    correct_answer VARCHAR(255) NOT NULL, -- The exact text of the correct option
    student_answer VARCHAR(255) DEFAULT NULL,
    explanation TEXT,
    FOREIGN KEY (interview_id) REFERENCES interviews (id) ON DELETE CASCADE
);

-- AI Coding Round Table
CREATE TABLE IF NOT EXISTS coding_interviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    include_hard BOOLEAN DEFAULT FALSE,
    questions JSON NOT NULL,      -- Array of 2 { title, description, constraints, examples }
    student_codes JSON DEFAULT NULL, -- Object { q1: code, q2: code }
    language VARCHAR(50) DEFAULT 'javascript',
    total_score INT DEFAULT 0,
    ai_feedback TEXT DEFAULT NULL,
    completion_time_seconds INT DEFAULT 0,
    submitted_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
);