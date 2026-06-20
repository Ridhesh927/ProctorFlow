const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./src/config/db');
require('dotenv').config();

console.log('[ENV CHECK] Env variables loaded:');
console.log('[ENV CHECK] GROQ_API_KEY available:', !!process.env.GROQ_API_KEY);
console.log('[ENV CHECK] GEMINI_API_KEY available:', !!process.env.GEMINI_API_KEY);

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required. Refusing to start with insecure defaults.');
}

const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: corsOptions.origin,
        methods: ['GET', 'POST'],
        credentials: true,
    }
});

app.set('socketio', io);

// Middleware
app.use(helmet());
app.use(cookieParser());
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', require('express').static(require('path').join(__dirname, 'uploads')));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again shortly.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts. Try again in 15 minutes.' }
});

// Rate limiting enabled to protect against Brute Force and DDoS
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

// Routes
const authRoutes = require('./src/routes/authRoutes');
const examRoutes = require('./src/routes/examRoutes');
const aiRoutes = require('./src/routes/aiRoutes');
const interviewRoutes = require('./src/routes/interviewRoutes');
const codingRoutes = require('./src/routes/codingRoutes');
const jobRoutes = require('./src/routes/jobRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/coding', codingRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/notifications', notificationRoutes);

// Initialize Database
if (require.main === module) {
    initDB();

    // Initialize Background Jobs
    const { startCronJobs } = require('./src/utils/cronJobs');
    startCronJobs();
}

// Basic Route
app.get('/', (req, res) => {
    res.send('Exam Portal Backend Running...');
});

// Socket.io Logic
require('./src/sockets/proctoringSocket')(io);

const PORT = process.env.PORT || 5000;
// Triggers nodemon restart
// Server is running on port 5000
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// Export app and server for testing
module.exports = { app, server };
// Nodemon restart trigger

