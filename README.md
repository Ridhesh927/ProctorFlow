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

### 2. Backend Setup
```bash
cd backend
npm install
# Create .env file (see Environment Variables section below)
npm run dev
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### 4. Default Credentials
When creating new students(manually added) from the dashboard, their default password is set to **`Test@123`**.

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

