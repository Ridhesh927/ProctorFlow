const { pool } = require('../config/db');
const notificationController = require('./notificationController');
const logger = require('../utils/logger');
const { generateJson, generateText } = require('../utils/aiClient');
const { getCompanyProfile, getSupportedCompanies } = require('../utils/companyQuestionLibrary');

// ─────────────────────────────────────────────
// Helper: Call AI and parse JSON safely
// ─────────────────────────────────────────────
const callAI = async (prompt) => {
    const { data } = await generateJson({
        taskType: 'coding',
        prompt,
        role: 'user',
        preferredProvider: 'auto',
        temperature: 0.7,
        groqModel: 'llama-3.3-70b-versatile',
        geminiModel: 'gemini-1.5-flash',
    });
    return data;
};

const callAIText = async (prompt) => {
    const { content } = await generateText({
        taskType: 'coding',
        prompt,
        role: 'user',
        preferredProvider: 'auto',
        temperature: 0.2,
        groqModel: 'llama-3.3-70b-versatile',
        geminiModel: 'gemini-1.5-flash',
    });
    return content || '';
};

// ─────────────────────────────────────────────
// Execute Code via Local Machine (100% Free)
// ─────────────────────────────────────────────
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const crypto = require('crypto');

const normalizeTestCaseStats = (rawStats, fallbackTotal = 6) => {
    const total = Math.max(1, Number.parseInt(rawStats?.total_test_cases, 10) || fallbackTotal);
    const passed = Math.max(0, Number.parseInt(rawStats?.passed_test_cases, 10) || 0);
    const failed = Math.max(0, Number.parseInt(rawStats?.failed_test_cases, 10) || 0);
    const completedRaw = Number.parseInt(rawStats?.completed_test_cases, 10);
    const completed = Number.isNaN(completedRaw) ? passed + failed : Math.max(0, completedRaw);

    const cappedCompleted = Math.min(total, completed);
    const cappedPassed = Math.min(cappedCompleted, passed);
    const maxFailed = cappedCompleted - cappedPassed;
    const cappedFailed = Math.min(maxFailed, failed);
    const remaining = Math.max(0, total - cappedCompleted);

    return {
        total_test_cases: total,
        completed_test_cases: cappedCompleted,
        passed_test_cases: cappedPassed,
        failed_test_cases: cappedFailed,
        remaining_test_cases: remaining,
    };
};

exports.executeCode = async (req, res) => {
    try {
        const { language, sourceCode, stdin = '', codingId, questionIndex } = req.body;

        const EXTENSIONS = {
            javascript: 'js',
            python: 'py',
            java: 'java',
            cpp: 'cpp',
        };

        const ext = EXTENSIONS[language];
        if (!ext) {
            return res.status(400).json({ message: 'Unsupported language' });
        }

        // Create a unique temporary file
        const fileId = crypto.randomUUID();
        // Move tempDir to the Operating System's temporary directory to avoid triggering Nodemon restarts!
        const tempDir = path.join(os.tmpdir(), 'exam_portal_exec', fileId);
        await fs.mkdir(tempDir, { recursive: true });

        let fileName = `main.${ext}`;
        if (language === 'java') {
            fileName = 'Solution.java'; // Standard name for Java templates
        }

        const filePath = path.join(tempDir, fileName);
        await fs.writeFile(filePath, sourceCode);

        // Command mapping
        let command = '';
        if (language === 'javascript') {
            command = `node ${fileName}`;
        } else if (language === 'python') {
            command = `python ${fileName}`;
        } else if (language === 'cpp') {
            command = process.platform === 'win32' 
                ? `g++ ${fileName} -o main.exe && main.exe`
                : `g++ ${fileName} -o main && ./main`;
        } else if (language === 'java') {
            command = `javac ${fileName} && java Solution`;
        }

        // Execute code locally via Promise
        const executeLocal = () => new Promise((resolve) => {
            exec(command, { cwd: tempDir, timeout: 5000 }, async (error, stdout, stderr) => {
                try { await fs.rm(tempDir, { recursive: true, force: true }); } catch (e) {}

                if (error) {
                    const isTimeout = error.killed;
                    resolve({
                        stdout: stdout || '',
                        stderr: isTimeout ? 'Execution Timed Out (Maximum 5 seconds)' : stderr || error.message,
                        compile_output: '',
                        status: isTimeout ? { id: 5, description: 'Time Limit Exceeded' } : { id: 4, description: 'Runtime Error' }
                    });
                } else {
                    resolve({
                        stdout: stdout || '',
                        stderr: stderr || '',
                        compile_output: '',
                        status: { id: 3, description: 'Accepted' },
                        time: '0.1',
                        memory: '1024'
                    });
                }
            });
        });

        // Concurrently run AI Testing if codingId is present
        let aiPromise = Promise.resolve({
            status: 'fail',
            feedback: '',
            testCaseStats: null,
        });
        if (codingId !== undefined && questionIndex !== undefined) {
            aiPromise = (async () => {
                const [rows] = await pool.query('SELECT questions FROM coding_interviews WHERE id = ?', [codingId]);
                if (rows.length > 0) {
                    const questions = typeof rows[0].questions === 'string' ? JSON.parse(rows[0].questions) : rows[0].questions;
                    const q = questions[questionIndex];
                    if (q) {
                        const fallbackTotal = Math.max((q.examples?.length || 0) + 5, 6);
                        const prompt = `
You are an automated coding test suite. The student just clicked 'Run Code' to test their solution.
Problem: ${q.title}
Description: ${q.description}
Examples/Tests: ${JSON.stringify(q.examples)}
Constraints: ${q.constraints}

Student's ${language} Code:
\`\`\`
${sourceCode}
\`\`\`

Evaluate ONLY if this code correctly solves the problem for all standard test cases and edge cases.

Return ONLY valid JSON with this exact structure:
{
  "status": "pass" | "fail",
  "feedback": "1-3 sentences describing correctness and key failure if any.",
  "total_test_cases": <integer>,
  "completed_test_cases": <integer>,
  "passed_test_cases": <integer>,
  "failed_test_cases": <integer>,
  "remaining_test_cases": <integer>
}

Rules for counts:
- completed_test_cases = passed_test_cases + failed_test_cases
- remaining_test_cases = total_test_cases - completed_test_cases
- Keep all values non-negative integers.
Do NOT provide corrected code.
`;

                        try {
                            const parsed = await callAI(prompt);
                            return {
                                status: parsed.status || 'fail',
                                feedback: parsed.feedback || '',
                                testCaseStats: normalizeTestCaseStats(parsed, fallbackTotal),
                            };
                        } catch (aiErr) {
                            logger('WARN', 'AI test-case analysis fallback to text mode', { error: aiErr.message });
                            const feedback = await callAIText(prompt);
                            return {
                                status: /passed/i.test(feedback) ? 'pass' : 'fail',
                                feedback: feedback || '',
                                testCaseStats: normalizeTestCaseStats(null, fallbackTotal),
                            };
                        }
                    }
                }
                return { status: 'fail', feedback: '', testCaseStats: null };
            })();
        }

        const [localResult, aiResult] = await Promise.all([executeLocal(), aiPromise]);

        let testCaseStats = aiResult.testCaseStats;
        if (localResult.status?.id !== 3) {
            const total = testCaseStats?.total_test_cases || 6;
            testCaseStats = {
                total_test_cases: total,
                completed_test_cases: 0,
                passed_test_cases: 0,
                failed_test_cases: 0,
                remaining_test_cases: total,
            };
        }

        res.json({
            ...localResult,
            ai_test_status: aiResult.status,
            ai_test_feedback: aiResult.feedback,
            test_case_stats: testCaseStats,
        });

    } catch (error) {
        logger('ERROR', 'Error executing code locally', { error: error.message });
        res.status(500).json({ message: 'Local code execution failed', error: error.message });
    }
};

const questionStore = require('../utils/questionStore');

// ─────────────────────────────────────────────
// 1. Generate 2-Question Coding Round
// ─────────────────────────────────────────────
exports.generateCodingRound = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { includeHard = false, company = 'General', roundType = 'coding' } = req.body;
        
        const allowedRoundTypes = new Set(['coding', 'aptitude', 'mixed']);
        const safeRoundType = allowedRoundTypes.has(roundType) ? roundType : 'coding';
        const companyProfile = getCompanyProfile(company);

        let enrichedQuestions = [];
        let provenanceMode = 'ai-generated';

        // Priority 1: Pick from CSV Dataset if available
        if (questionStore.hasQuestions()) {
            const levelA = includeHard ? 'Medium' : 'Easy';
            const levelB = includeHard ? 'Hard' : 'Medium';

            const q1 = questionStore.getRandomQuestions(levelA, 1)[0];
            const q2 = questionStore.getRandomQuestions(levelB, 1)[0];

            if (q1 && q2) {
                enrichedQuestions = [q1, q2].map((q, idx) => ({
                    title: q.title,
                    difficulty: q.difficulty,
                    description: q.description,
                    examples: q.examples,
                    constraints: q.constraints.join?.('\n') || String(q.constraints),
                    hint: "Think about the main idea first, then choose a data structure that lets you update and look up information in constant time.", // default hint for CSV
                    source_company: companyProfile.name,
                    round_type: safeRoundType,
                    sequence: idx + 1,
                    provenance_mode: 'dataset-csv'
                }));
                provenanceMode = 'dataset-csv';
                logger('INFO', `Selected 2 questions from CSV dataset for student ${studentId}`);
            }
        }

        // Priority 2: Standard AI Generation (with CSV knowledge)
        if (enrichedQuestions.length < 2) {
            const samples = questionStore.getSamplesForAI(2);
            const sampleText = samples.length > 0 
                ? `Here are some stylistic examples from my dataset: ${JSON.stringify(samples)}` 
                : '';

            provenanceMode = 'pattern-simulated';
            const levelA = includeHard ? 'Medium' : 'Easy';
            const levelB = includeHard ? 'Hard'   : 'Medium';

            const topicGuidance = safeRoundType === 'coding'
                ? `Prioritize coding patterns usually seen in ${companyProfile.name} assessments: ${companyProfile.codingPatterns.join(', ')}.`
                : safeRoundType === 'aptitude'
                    ? `Prioritize aptitude-to-coding style problem statements inspired by ${companyProfile.name}: ${companyProfile.aptitudePatterns.join(', ')}.`
                    : `Mix one coding-heavy and one aptitude-style coding problem aligned with ${companyProfile.name}.`;

            const prompt = `
    You are a senior software engineer setting a coding interview.
    Generate 2 DSA problems. One should be ${levelA} difficulty, the other ${levelB}.
    ${sampleText}
    ${topicGuidance}
    Make problems realistic and include practical edge cases.
    
    Return ONLY a JSON object:
    {
      "questions": [
        {
          "title": "...",
          "difficulty": "${levelA}",
          "description": "...",
          "examples": [{ "input": "...", "output": "...", "explanation": "..." }],
          "constraints": "...",
          "hint": "..."
        },
        {
          "title": "...",
          "difficulty": "${levelB}",
          "description": "...",
          "examples": [{ "input": "...", "output": "...", "explanation": "..." }],
          "constraints": "...",
          "hint": "..."
        }
      ]
    }
    `;

            logger('INFO', `Generating coding round for student ${studentId} via AI`, { includeHard });
            const parsed = await callAI(prompt);

            if (!parsed.questions || parsed.questions.length < 2) {
                throw new Error('AI returned invalid question format. Try again.');
            }

            enrichedQuestions = parsed.questions.slice(0, 2).map((question, index) => ({
                ...question,
                source_company: companyProfile.name,
                round_type: safeRoundType,
                sequence: index + 1,
                provenance_mode: provenanceMode,
                source_evidence: null
            }));
        }

        const [result] = await pool.query(
            'INSERT INTO coding_interviews (student_id, include_hard, questions) VALUES (?, ?, ?)',
            [studentId, includeHard, JSON.stringify(enrichedQuestions)]
        );

        logger('INFO', `Coding round created for student ${studentId}`, {
            id: result.insertId,
            company: companyProfile.name,
            roundType: safeRoundType,
            provenanceMode,
        });
        res.status(201).json({
            codingId: result.insertId,
            meta: {
                provenanceMode,
                company: companyProfile.name,
                note: 'Company mode currently uses AI pattern simulation. To claim exact historical asked questions, add an evidence-backed dataset with source links, year, and round metadata.'
            }
        });

    } catch (error) {
        logger('ERROR', 'Error generating coding round', { error: error.message });
        res.status(500).json({ message: 'Failed to generate coding round.', error: error.message });
    }
};

exports.getCompanyLibrary = async (req, res) => {
    try {
        res.status(200).json({ companies: getSupportedCompanies() });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load company library.' });
    }
};

// ─────────────────────────────────────────────
// 2. Get Coding Round by ID
// ─────────────────────────────────────────────
exports.getCodingRound = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { id } = req.params;

        const [rows] = await pool.query(
            'SELECT * FROM coding_interviews WHERE id = ? AND student_id = ?',
            [id, studentId]
        );

        if (!rows.length) return res.status(404).json({ message: 'Coding round not found.' });

        const [parentInterview] = await pool.query(
            'SELECT id, ai_feedback FROM interviews WHERE coding_id = ? AND student_id = ?',
            [id, studentId]
        );
        const parentInterviewId = parentInterview[0]?.id || null;
        const parentInterviewCompleted = Boolean(parentInterview[0] && parentInterview[0].ai_feedback !== null);

        const round = rows[0];
        // Handle mysql2 auto-parsing
        const questions = typeof round.questions === 'string' ? JSON.parse(round.questions) : round.questions;
        const studentCodes = round.student_codes
            ? (typeof round.student_codes === 'string' ? JSON.parse(round.student_codes) : round.student_codes)
            : { q1: '', q2: '' };

        res.status(200).json({ 
            round: { 
                ...round, 
                questions, 
                student_codes: studentCodes, 
                parent_interview_id: parentInterviewId,
                parent_interview_completed: parentInterviewCompleted
            } 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────
// 3. Submit Code for AI Grading
// ─────────────────────────────────────────────
exports.submitCodingRound = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { id } = req.params;
        const { q1Code, q2Code, language = 'javascript', completionTimeSeconds = 0 } = req.body;

        const [rows] = await pool.query(
            'SELECT * FROM coding_interviews WHERE id = ? AND student_id = ?',
            [id, studentId]
        );
        if (!rows.length) return res.status(403).json({ message: 'Unauthorized or not found.' });

        const round = rows[0];
        const questions = typeof round.questions === 'string' ? JSON.parse(round.questions) : round.questions;
        const q1 = questions[0];
        const q2 = questions[1];
        const safeCompletionTime = Math.max(0, Number.parseInt(completionTimeSeconds, 10) || 0);

        const prompt = `
You are a senior algorithmic interviewer. A student just submitted code for 2 DSA problems.
Evaluate both solutions as a professional code reviewer. Be honest, constructive, and specific.

---
PROBLEM 1 (${q1.difficulty}): ${q1.title}
${q1.description}

Student's ${language} code:
\`\`\`${language}
${q1Code || '// No code submitted'}
\`\`\`

---
PROBLEM 2 (${q2.difficulty}): ${q2.title}
${q2.description}

Student's ${language} code:
\`\`\`${language}
${q2Code || '// No code submitted'}
\`\`\`

---
Return ONLY a JSON object:
{
  "total_score": <integer 0-100 overall>,
  "q1_score": <integer 0-50>,
  "q1_feedback": "Detailed review of Q1 code: correctness, edge cases, time complexity, improvements.",
  "q2_score": <integer 0-50>,
  "q2_feedback": "Detailed review of Q2 code: correctness, edge cases, time complexity, improvements.",
  "overall_feedback": "2-3 sentences summarizing the candidate's algorithmic thinking and what to study."
}
`;

        logger('INFO', `Grading coding round ${id} for student ${studentId}`);
        const grading = await callAI(prompt);

        const studentCodes = { q1: q1Code || '', q2: q2Code || '' };
        const score = Math.min(100, Math.max(0, grading.total_score || 0));

        const feedbackText = [
            `=== Question 1: ${q1.title} (${grading.q1_score ?? '?'}/50) ===`,
            grading.q1_feedback || '',
            '',
            `=== Question 2: ${q2.title} (${grading.q2_score ?? '?'}/50) ===`,
            grading.q2_feedback || '',
            '',
            `=== Overall ===`,
            grading.overall_feedback || ''
        ].join('\n');

        await pool.query(
            'UPDATE coding_interviews SET student_codes = ?, language = ?, total_score = ?, ai_feedback = ?, completion_time_seconds = ?, submitted_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(studentCodes), language, score, feedbackText, safeCompletionTime, id]
        );

        logger('INFO', `Coding round ${id} graded`, { score });

        // Trigger Notification
        notificationController.createNotification(
            studentId,
            'student',
            'Coding Round Graded',
            `Your AI coding round evaluation is complete. Total Score: ${score}/100.`,
            `/student/results`
        );

        res.status(200).json({ score, feedback: feedbackText, completionTimeSeconds: safeCompletionTime });

    } catch (error) {
        logger('ERROR', 'Error grading coding round', { error: error.message });
        res.status(500).json({ message: 'Failed to grade submission.', error: error.message });
    }
};

// ─────────────────────────────────────────────
// 4. Get Coding History
// ─────────────────────────────────────────────
exports.getCodingHistory = async (req, res) => {
    try {
        const studentId = req.user.id;
        const [rows] = await pool.query(
            'SELECT id, include_hard, total_score, ai_feedback, language, completion_time_seconds, submitted_at, created_at FROM coding_interviews WHERE student_id = ? ORDER BY created_at DESC',
            [studentId]
        );
        res.status(200).json({ history: rows });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
