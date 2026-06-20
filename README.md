# 🛡️ ExamPro AI: Next-Gen AI-Powered Examination & Proctoring Platform

ExamPro AI is a comprehensive, state-of-the-art examination system designed for educational institutions and corporate hiring. It combines high-integrity proctoring, AI-driven assessment generation, and deeply personal adaptive learning insights.

---

## 🌟 Key Features

### 1. 🤖 AI-Powered "Smart Import" & Generation
*   **Multi-Format Analysis**: Upload old question papers in **PDF, Docx, CSV, Excel, or Image** formats.
*   **AI Parsing**: Automatically extracts questions, options, topics, and difficulty levels into the database using Groq/Gemini.
*   **Adaptive Generation**: Generate personalized MCQ sets based on student resumes or syllabus content.

### 2. 🛡️ Advanced Interactive Live Proctoring
*   **Invigilator Wall**: A real-time grid view for teachers to monitor multiple students simultaneously.
*   **Voice Intervention**: A "Talk" feature (Text-to-Speech) allowing teachers to send vocal alerts directly to student browsers.
*   **Automated Security Snapshots**: Silent webcam captures every 5 minutes for a visual audit trail.
*   **Violation Analysis**: 360-degree monitoring of tab switching, suspicious movements, and background sounds.

### 3. 💻 Multi-Round Specialized Assessments
*   **Coding Rounds**: Integrated IDE supporting JS, Python, Java, and C++.
*   **Automated Code Review**: AI-driven grading of DSA logic, time complexity, and edge cases.
*   **Digital Rough Pad**: A draggable, monitorable scratchpad for students to eliminate "looking down" as a cheating excuse.

### 4. 📊 Depth Analytics & Reporting
*   **Exam Health (Item Analysis)**: Visual reports on "Hardest Questions", "Ambiguous Questions", and Success Rates.
*   **AI Learning Path**: Personalized recommendations for students based on their weak topics.
*   **Verifiable Certificates**: Automated, branded PDF certificates with **QR-code verification** for passing students.

---

## 🏗️ Technology Stack

| Logic | Technology |
| :--- | :--- |
| **Frontend** | React 19, Vite, Framer Motion (Animations), TailwindCSS/Vanilla CSS |
| **Backend** | Node.js, Express, Socket.IO (Real-time), Multer |
| **Database** | MySQL (Pool-optimized), Lucene-like CSV Search |
| **AI Brain** | Groq (Llama 3.3), Google Gemini 1.5-Flash |
| **Utilities** | jsPDF, html2canvas, Tesseract.js (OCR), PDF-parse |

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18+)
- **MySQL Server**
- **Groq API Key(s)** (at least 3 recommended for high-load rotation)

### 2. Database Setup (Supabase / Local)
The project is built to automatically initialize its own schema! 
1. Create a new MySQL or PostgreSQL database (if using Supabase, use the connection string they provide).
2. Add your database credentials to the `.env` file (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).
3. **Auto-Initialization:** The moment you start the backend server (`npm run dev` or `node server.js`), the `initDB()` function will run automatically. It will create all necessary tables, configure constraints, and inject the demo accounts for you.

### 3. Backend Setup
```bash
cd backend
npm install
# Ensure .env is populated with DB and API keys
npm run dev
```

### 4. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### 4. Demo Credentials & Bootstrapping
When the backend starts, it automatically bootstraps the following demo accounts to make testing deployments seamless:
- **Demo Student:** `student@test.com` (PRN: `TEST_STUDENT_001`) | Password: `password123`
- **Demo Teacher:** `teacher@test.com` | Password: `password123`
- **Main Admin:** Bootstrapped via `.env` (`ADMIN_EMAIL` and `ADMIN_PASSWORD`)

*(Note: When manually creating new students from the dashboard, their default password is set to **`Test@123`**).*

---

## 🔐 Security Enhancements

The platform includes several strict security mechanisms to prevent unauthorized access:
- **Rate Limiting:** Protects the `/api/auth` routes against brute-force attacks (12 attempts per 15 minutes) and limits general API usage to prevent DDoS attacks.
- **IDOR Protection:** Exam start and submission routes strictly validate the student's department/year matches the exam requirements, and ensure active sessions exist before processing grades.
- **Strict Role-Based Access Control (RBAC):** Middleware guarantees that only Main Admins can create other teachers.
- **Server-Side Logout:** Token revocation mechanisms actively terminate JWT sessions on the server.

---

## 🧪 Testing

We use **Jest** and **Supertest** to conduct robust integration testing across the backend. Tests are executed in isolation on a temporary database (`exam_portal_test`) to prevent data corruption.

To run the integration tests:
```bash
cd backend
npm test
```
The test suite validates:
1. Authentication & Role Permissions
2. Full Teacher Exam Lifecycle (Creation & Management)
3. Full Student Exam Lifecycle (Session tracking & Submission scoring)

---

## 🔑 Environment Variables (`backend/.env`)

Ensure you have the following keys configured for full functionality:

```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=exam_portal_v2

# AI Infrastructure (Multiple keys for load-balancing)
GROQ_API_KEY=key_1
GROQ_API_KEY_2=key_2
GROQ_API_KEY_3=key_3

GEMINI_API_KEY=your_gemini_key

# Security
JWT_SECRET=your_complex_secret_string
FRONTEND_ORIGINS=http://localhost:5173
```

---

## 📂 Project Architecture

```text
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── student/     # Take Exam, Results, Dashboard
│   │   │   └── teacher/     # Live Proctoring, Analytics, Exam Creator
│   │   └── components/      # RoughPad, SocketProvider, etc.
├── backend/
│   ├── src/
│   │   ├── controllers/     # AI, Coding, Exam, Proctoring logic
│   │   ├── utils/           # AI Client (Key Rotation), Scanners
│   │   └── routes/          # API Endpoints
└── DB_SCHEMA_OVERVIEW.md     # Detailed Database Documentation
```

---

## ⚡ API Key Partitioning

To ensure reliability, the system rotates keys based on the task type:
- **`mcq_gen`**: Optimized for heavy bulk parsing.
- **`coding`**: High precision for DSA and Grading.
- **`monitoring`**: Real-time response for proctoring audits.
- **`reporting`**: Summary generation for final reports.

---

