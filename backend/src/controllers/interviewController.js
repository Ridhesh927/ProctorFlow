const { pool } = require('../config/db');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const notificationController = require('./notificationController');
const logger = require('../utils/logger');
const { generateJson, generateText } = require('../utils/aiClient');
require('dotenv').config();

// Reference Datasets for AI Context
// In a production system, these might be stored in the DB, but for now
// we keep them as static prompts to guide the AI's difficulty and style.
const REFERENCE_DATASETS = {
    aptitude: `
    Examples of Aptitude Questions (Difficulty varies):
    1. A train running at the speed of 60 km/hr crosses a pole in 9 seconds. What is the length of the train?
    2. The price of a commodity is increased by 25%. By what percentage must a consumer reduce their consumption so that the expenditure remains the same?
    3. If A can do a piece of work in 10 days and B can do it in 15 days, how long will they take if they work together?
    Focus on quantitative analysis, time/distance, percentages, and basic algebra.
    `,
    logical: `
    Examples of Logical Reasoning Questions:
    1. Look at this series: 2, 1, (1/2), (1/4), ... What number should come next?
    2. Pointing to a photograph, a man said, "I have no brother or sister but that man's father is my father's son." Whose photograph was it?
    3. In a certain code language, '134' means 'good and tasty', '478' means 'see good pictures'. Which digit stands for 'see'?
    Focus on pattern recognition, syllogisms, blood relations, and coding/decoding.
    `,
    // Domain-specific topic mappings. The AI uses this to understand what to ask about for each role.
    getDomainTopics: (role) => {
        const r = role.toLowerCase();
        if (r.includes('web') || r.includes('frontend') || r.includes('front-end') || r.includes('react') || r.includes('vue') || r.includes('angular')) {
            return 'HTML5, CSS3, JavaScript (ES6+), DOM manipulation, React/Vue/Angular concepts, Responsive Design, Web Performance, HTTP, Browser APIs, REST APIs, Web Security (XSS, CSRF).';
        } else if (r.includes('backend') || r.includes('back-end') || r.includes('server') || r.includes('node') || r.includes('django') || r.includes('spring')) {
            return 'Node.js/Python/Java server concepts, REST API design, Database design (SQL & NoSQL), ORM, Authentication (JWT, OAuth), Caching (Redis), Microservices, Message Queues, Docker, CI/CD.';
        } else if (r.includes('full stack') || r.includes('fullstack')) {
            return 'HTML/CSS/JS frontend, Node.js/Python backend, REST API design, SQL/NoSQL databases, Authentication (JWT), React or Vue, System design, Docker basics, CI/CD pipelines.';
        } else if (r.includes('software') || r.includes('sde') || r.includes('swe') || r.includes('software engineer') || r.includes('software developer')) {
            return 'Data Structures (arrays, linked lists, trees, graphs, heaps), Algorithms (sorting, searching, dynamic programming, greedy), Object-Oriented Programming (encapsulation, inheritance, polymorphism, abstraction), Design Patterns (Singleton, Observer, Factory), System Design concepts (scalability, load balancing, caching), SQL fundamentals, Version Control (Git), Software Development Life Cycle (SDLC), Testing (unit, integration), Time and Space Complexity (Big-O).';
        } else if (r.includes('data science') || r.includes('machine learning') || r.includes('ml') || r.includes('ai') || r.includes('data analyst')) {
            return 'Statistics & Probability, Linear Algebra, Machine Learning algorithms (regression, classification, clustering), Python (Pandas, NumPy, Scikit-learn), SQL, Data Visualization, Neural Networks, Feature Engineering, Model Evaluation, Overfitting/Underfitting.';
        } else if (r.includes('mobile') || r.includes('android') || r.includes('ios') || r.includes('react native') || r.includes('flutter')) {
            return 'Mobile UI/UX principles, Native APIs (Camera, GPS, Notifications), Local Storage, AsyncStorage, Networking (REST), State Management, Published app lifecycle, Platform specifics (Android/iOS), Performance optimization, App security.';
        } else if (r.includes('devops') || r.includes('cloud') || r.includes('aws') || r.includes('azure') || r.includes('gcp')) {
            return 'Linux commands, Docker & Kubernetes, CI/CD pipelines (Jenkins, GitHub Actions), Cloud services (AWS EC2, S3, Lambda, RDS), Infrastructure as Code (Terraform), Monitoring (Prometheus, Grafana), Networking (VPC, DNS, Load Balancers), Security groups.';
        } else if (r.includes('cyber') || r.includes('security') || r.includes('ethical hacking')) {
            return 'Network Security (firewalls, VPNs, IDS/IPS), Cryptography (AES, RSA, hashing), OWASP Top 10, Vulnerability assessment, Penetration testing basics, Incident response, Compliance standards (ISO 27001, GDPR), Social engineering.';
        } else if (r.includes('database') || r.includes('dba') || r.includes('sql')) {
            return 'SQL (joins, subqueries, indexes, stored procedures, triggers), Database normalization, Transactions & ACID, Query optimization, NoSQL databases (MongoDB, Redis, Cassandra), Database replication, Backup & recovery.';
        } else {
            // Generic software role fallback
            return `Core programming concepts (OOP, SOLID principles), Data Structures & Algorithms, System Design, Databases (SQL/NoSQL), Version Control (Git), Testing, and specific skills relevant to "${role}"`;
        }
    }
};

// 1. Upload and Parse Resume
exports.uploadResume = async (req, res) => {
    try {
        const studentId = req.user.id;
        
        if (!req.file) {
            return res.status(400).json({ message: 'No resume file uploaded.' });
        }

        const mimetype = req.file.mimetype;
        const buffer = req.file.buffer;
        let resumeText = '';

        logger('INFO', `Parsing resume for student ${studentId}`, { mimetype });

        if (mimetype === 'application/pdf') {
            const result = await pdfParse(buffer);
            resumeText = result.text;
        } else if (mimetype.startsWith('image/')) {
            const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
            resumeText = text;
        } else {
            return res.status(400).json({ message: 'Invalid file type. Please upload a PDF or an Image.' });
        }

        if (!resumeText || resumeText.trim() === '') {
             return res.status(400).json({ message: 'Could not extract text from the uploaded file.' });
        }

        const summarizePrompt = `
        Analyze the following resume text.
        1. Extract a brief structured summary of the core technical skills.
        2. Suggest 2-3 suitable job role titles (careers) based on these skills.
        Format the output strictly as a JSON object with two keys: "skills" (array of strings) and "roles" (array of strings). e.g. {"skills": ["React", "Node.js"], "roles": ["Frontend Developer", "Full Stack Engineer"]}.
        
        Resume Text:
        """
        ${resumeText.substring(0, 4000)} // Limit length for speed
        """
        `;

        let parsedSkills = [];
        let parsedRoles = [];
        try {
            const { data: AIResponse } = await generateJson({
                taskType: 'mcq_gen',
                prompt: summarizePrompt,
                role: 'user',
                preferredProvider: 'auto',
                temperature: 0.1,
                maxTokens: 1024,
                groqModel: 'llama-3.1-8b-instant',
                geminiModel: 'gemini-1.5-flash',
            });
            
            // Handle different possible JSON shapes the AI might return
            if (AIResponse.skills && Array.isArray(AIResponse.skills)) {
                parsedSkills = AIResponse.skills;
            } else if (Array.isArray(AIResponse)) {
                parsedSkills = AIResponse;
            } else {
                // fallback extraction
                parsedSkills = Object.values(AIResponse).flat().filter(i => typeof i === 'string');
            }
            
            if (AIResponse.roles && Array.isArray(AIResponse.roles)) {
                parsedRoles = AIResponse.roles;
            }
        } catch (aiErr) {
            logger('WARN', 'AI failed to summarize skills, saving raw text only', { error: aiErr.message });
        }

        const dbStoredJson = {
            skills: parsedSkills,
            roles: parsedRoles
        };

        // Save to Database
        await pool.query(
            'UPDATE students SET resume_text = ?, parsed_skills = ? WHERE id = ?',
            [resumeText, JSON.stringify(dbStoredJson), studentId]
        );

        res.status(200).json({ 
            message: 'Resume parsed and saved successfully.', 
            skills: parsedSkills,
            roles: parsedRoles
        });

    } catch (error) {
        logger('ERROR', 'Error processing resume', { error: error.message });
        res.status(500).json({ message: 'Failed to process resume.', error: error.message });
    }
};

// 2. Generate Personalized Interview
exports.generateInterview = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { jobRoleTarget, difficulty = 'medium', questionCount = 20 } = req.body;

        const requestedCount = parseInt(questionCount, 10);
        const totalQuestionCount = Number.isNaN(requestedCount)
            ? 10
            : Math.min(25, Math.max(10, requestedCount));

        if (!jobRoleTarget) return res.status(400).json({ error: 'Target job role is required' });

        // Map difficulty to specific AI instructions
        const getDifficultyInstructions = (level) => {
            switch (level) {
                case 'easy':
                    return `DIFFICULTY: EASY — Generate beginner-friendly questions.
                    - Questions in each category should be straightforward and conceptual (no tricks, no edge cases).
                    - Use simple language; focus on definitions, basic syntax, and everyday use-cases.
                    - Difficulty split: 4 Easy + 1 Medium.`;
                case 'hard':
                    return `DIFFICULTY: HARD — Generate expert-level questions.
                    - Focus on edge cases, performance trade-offs, system design, and advanced concepts.
                    - Questions should challenge candidates with 2+ years of experience.
                    - Difficulty split: 1 Easy + 2 Medium + 2 Hard.`;
                default: // medium
                    return `DIFFICULTY: MEDIUM — Generate intermediate-level questions.
                    - Mix practical application questions with some conceptual ones.
                    - Include some common interview traps and comparison questions.
                    - Difficulty split: 1 Easy + 3 Medium + 1 Hard.`;
            }
        };

        const difficultyInstructions = getDifficultyInstructions(difficulty);

        // Fetch Student Data
        const [students] = await pool.query(
            'SELECT resume_text, parsed_skills, year FROM students WHERE id = ?',
            [studentId]
        );

        if (!students || students.length === 0 || !students[0].resume_text) {
            return res.status(400).json({ message: 'No resume found. Please upload a resume first.' });
        }

        const resume = students[0].resume_text;
        const studentYear = students[0].year || 'Final Year';
        let resumeSkills = [];
        let resumeRoles = [];

        try {
            const parsedSkillsRaw = students[0].parsed_skills;
            if (parsedSkillsRaw) {
                const parsed = typeof parsedSkillsRaw === 'string' ? JSON.parse(parsedSkillsRaw) : parsedSkillsRaw;
                if (Array.isArray(parsed?.skills)) resumeSkills = parsed.skills.filter(s => typeof s === 'string');
                if (Array.isArray(parsed?.roles)) resumeRoles = parsed.roles.filter(r => typeof r === 'string');
            }
        } catch (parseErr) {
            logger('WARN', 'Failed to parse stored resume skills JSON', { studentId, error: parseErr.message });
        }

        const topResumeSkills = resumeSkills.slice(0, 8);
        const topSuggestedRoles = resumeRoles.slice(0, 3);
        const resumeSkillsText = topResumeSkills.length > 0 ? topResumeSkills.join(', ') : 'No explicit skills extracted';
        const suggestedRolesText = topSuggestedRoles.length > 0 ? topSuggestedRoles.join(', ') : 'No role suggestions available';

        logger('INFO', `Preparing ${totalQuestionCount}-question interview for student ${studentId}`, {
            role: jobRoleTarget,
            difficulty,
        });

        const highVolumeMode = totalQuestionCount > 30;

        // Helper function for parallel generation
        const fetchQuestionsForCategory = async (category, count, promptDetails) => {
            const prompt = `
            You are an expert technical interviewer. Create ${count} MCQs for the category: "${category}".
            
            Context:
            - Job Target: ${jobRoleTarget}
            - Academic Year: ${studentYear}

            ${difficultyInstructions}
            
            Category Specific Instructions:
            ${promptDetails}

            Instructions:
            1. Generate EXACTLY ${count} questions.
            2. Each question must have exactly 4 options (A, B, C, D).
            3. The "correct_answer" must be the EXACT full text of one of the options.
            4. Provide a short explanation for why the correct answer is right.

            OUTPUT FORMAT - return ONLY this JSON structure:
            {
              "questions": [
                {
                  "question": "...",
                  "options": ["...", "...", "...", "..."],
                  "correct_answer": "...",
                  "explanation": "..."
                }
              ]
            }
            `;

            try {
                const { data: content } = await generateJson({
                    taskType: 'mcq_gen',
                    prompt,
                    role: 'user',
                    preferredProvider: 'groq',
                    temperature: 0.35,
                    maxTokens: 3000,
                    groqModel: 'llama-3.3-70b-versatile',
                    geminiModel: 'gemini-1.5-flash',
                });
                
                const questions = (content.questions || []).filter(q => {
                    if (!q.question || !q.correct_answer || !Array.isArray(q.options) || q.options.length < 2) return false;
                    if (!q.options.some(opt => opt === q.correct_answer)) {
                        const match = q.options.find(opt => opt.toLowerCase().trim() === q.correct_answer.toLowerCase().trim());
                        if (match) q.correct_answer = match; else return false;
                    }
                    return true;
                });
                
                logger('INFO', `Generated ${questions.length} valid questions for ${category}`, { requested: count, category });
                return questions;
            } catch (error) {
                logger('ERROR', `AI provider failed for ${category}`, {
                    category,
                    requested: count,
                    error: error.message,
                    stack: error.stack,
                });
                throw error;
            }
        };

        const fetchQuestionsForCategoryRobust = async (category, count, promptDetails) => {
            const collected = [];
            const seen = new Set();
            const maxChunkSize = highVolumeMode ? 6 : 4;
            const plannedCalls = Math.max(1, Math.ceil(count / maxChunkSize));
            const maxAttempts = plannedCalls + (highVolumeMode ? 1 : 2);
            let attempts = 0;
            let staleAttempts = 0;

            logger('INFO', `Starting robust generation for category: ${category}`, {
                target: count,
                maxChunkSize,
                maxAttempts,
            });

            while (collected.length < count && attempts < maxAttempts) {
                const needed = count - collected.length;
                const chunkSize = Math.min(maxChunkSize, needed);

                try {
                    // Add exponential backoff delay between retries
                    if (attempts > 0) {
                        const delay = Math.min(1000 * Math.pow(1.5, attempts - 1), 5000);
                        logger('INFO', `Retry delay for ${category}`, { attempt: attempts, delayMs: delay });
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }

                    logger('INFO', `Attempting generation for ${category}`, {
                        attempt: attempts + 1,
                        chunkSize,
                        needed,
                    });

                    const chunk = await fetchQuestionsForCategory(category, chunkSize, promptDetails);
                    let addedInThisAttempt = 0;

                    for (const question of chunk) {
                        const key = String(question.question || '').trim().toLowerCase();
                        if (!key || seen.has(key)) continue;
                        seen.add(key);
                        collected.push(question);
                        addedInThisAttempt += 1;
                        if (collected.length >= count) break;
                    }

                    logger('INFO', `Generation chunk result for ${category}`, {
                        chunkSize,
                        generated: chunk.length,
                        valid: addedInThisAttempt,
                        collected: collected.length,
                    });

                    if (addedInThisAttempt === 0) {
                        staleAttempts += 1;
                    } else {
                        staleAttempts = 0;
                    }
                } catch (chunkErr) {
                    logger('ERROR', 'Category chunk generation failed', {
                        category,
                        attempt: attempts + 1,
                        requested: chunkSize,
                        error: chunkErr.message,
                    });
                    staleAttempts += 1;
                }

                if (staleAttempts >= 2) {
                    logger('WARN', 'Stopping repeated stale attempts for category', {
                        category,
                        requested: count,
                        generated: collected.length,
                        staleAttempts,
                    });
                    break;
                }

                attempts += 1;
            }

            if (collected.length < count) {
                logger('WARN', 'Generated fewer questions than requested for category', {
                    category,
                    requested: count,
                    generated: collected.length,
                    attempts,
                });
            }

            logger('INFO', `Category generation complete: ${category}`, {
                target: count,
                generated: collected.length,
            });

            return collected.slice(0, count);
        };

        const domainTopics = REFERENCE_DATASETS.getDomainTopics(jobRoleTarget);

        const categoryTemplates = [
            {
                name: 'DSA',
                prompt: `Focus ONLY on Data Structures & Algorithms (DSA):
                - Topic variety: Arrays, Strings, Linked Lists, Stacks, Queues, Trees, Graphs, Sorting, Searching, Dynamic Programming, Hashing.
                - Include conceptual questions (e.g. "What is the time complexity of QuickSort?") and logic-application questions.
                - Mix of Easy, Medium, and Hard.
                Use references: ${REFERENCE_DATASETS.aptitude}`
            },
            {
                name: 'Logical Reasoning',
                prompt: `Focus ONLY on Logical Reasoning:
                - Topics: Number series, Blood relations, Syllogisms, Coding-decoding, Puzzles, Seating arrangements, Direction sense.
                - Questions must test analytical thinking, NOT numerical math.
                Use references: ${REFERENCE_DATASETS.logical}`
            },
            {
                name: 'Verbal Ability',
                prompt: `Focus ONLY on Verbal Ability & Aptitude:
                - Topics: Reading comprehension, Vocabulary (synonyms, antonyms), Sentence correction, Fill in the blanks, Para jumbles, Analogy.
                - Questions should test English language proficiency and verbal reasoning.`
            },
            {
                name: 'Technical & Domain',
                prompt: `The candidate applied for: "${jobRoleTarget}".

                IMPORTANT: Your PRIMARY focus is the job role "${jobRoleTarget}". Ask questions specifically about:
                ${domainTopics}

                Candidate resume (for personalization):
                ${resume.substring(0, 1500)}

                Extracted resume skills (highest confidence):
                ${resumeSkillsText}

                AI-suggested role matches from resume:
                ${suggestedRolesText}

                Personalization rules you MUST follow:
                - Most questions must be tightly aligned to "${jobRoleTarget}" day-to-day skills.
                - Include resume technologies/skills when relevant to the role.
                - Include at least one question that probes a likely gap between resume focus and target-role requirements.
                - Keep the set balanced: do not generate all questions from one single tool/framework.

                All questions in this category MUST be directly relevant to the day-to-day work of a "${jobRoleTarget}".`
            }
        ];

        const baseCount = Math.floor(totalQuestionCount / categoryTemplates.length);
        const remainder = totalQuestionCount % categoryTemplates.length;
        const remainderPriority = ['Technical & Domain', 'DSA', 'Logical Reasoning', 'Verbal Ability'];

        const remainderSet = new Set(remainderPriority.slice(0, remainder));
        const categories = categoryTemplates.map((category) => ({
            ...category,
            count: baseCount + (remainderSet.has(category.name) ? 1 : 0),
        }));

        logger('INFO', `Generating ${totalQuestionCount}-question interview for student ${studentId}`, {
            role: jobRoleTarget,
            categorySplit: categories.map((c) => `${c.name}:${c.count}`).join(', '),
            mode: highVolumeMode ? 'high-volume-sequential' : 'standard-parallel',
        });
        const results = [];
        for (const category of categories) {
            const generated = await fetchQuestionsForCategoryRobust(category.name, category.count, category.prompt);
            results.push(generated);
        }
        const allQuestions = results.flat().slice(0, totalQuestionCount);

        const minimumAcceptableCount = Math.max(8, Math.ceil(totalQuestionCount * 0.8));
        if (allQuestions.length < minimumAcceptableCount) {
            throw new Error(`AI generated too few valid questions (${allQuestions.length}). Please try again.`);
        }

        const [interviewResult] = await pool.query(
            'INSERT INTO interviews (student_id, job_role_target) VALUES (?, ?)',
            [studentId, jobRoleTarget]
        );
        const interviewId = interviewResult.insertId;

const questionStore = require('../utils/questionStore');

        // Pre-generate the coding round that will follow the MCQ round
        let codingId = null;
        try {
            const includeHard = difficulty === 'hard';
            let enrichedCodingQuestions = [];

            // Priority 1: Pick from Dataset
            if (questionStore.hasQuestions()) {
                const levelA = includeHard ? 'Medium' : 'Easy';
                const levelB = includeHard ? 'Hard' : 'Medium';
                const q1 = questionStore.getRandomQuestions(levelA, 1)[0];
                const q2 = questionStore.getRandomQuestions(levelB, 1)[0];

                if (q1 && q2) {
                    enrichedCodingQuestions = [q1, q2].map((q, idx) => ({
                        title: q.title,
                        difficulty: q.difficulty,
                        description: q.description,
                        examples: q.examples,
                        constraints: q.constraints.join?.('\n') || String(q.constraints),
                        hint: "Think about the main idea first.",
                        round_type: 'coding',
                        sequence: idx + 1,
                        provenance_mode: 'dataset-csv'
                    }));
                }
            }

            // Priority 2: AI Generation
            if (enrichedCodingQuestions.length < 2) {
                const levelA = includeHard ? 'Medium' : 'Easy';
                const levelB = includeHard ? 'Hard'   : 'Medium';
                const codingPrompt = `You are a senior software engineer. Generate 2 classic DSA algorithm problems. One ${levelA}, one ${levelB}. Return ONLY JSON.`;
                const { data: codingParsed } = await generateJson({
                    taskType: 'coding',
                    prompt: codingPrompt,
                    role: 'user',
                    preferredProvider: 'groq',
                    temperature: 0.7,
                    groqModel: 'llama-3.3-70b-versatile',
                });
                if (codingParsed.questions && codingParsed.questions.length >= 2) {
                    enrichedCodingQuestions = codingParsed.questions.map(q => ({ ...q, provenance_mode: 'ai-generated' }));
                }
            }

            if (enrichedCodingQuestions.length >= 2) {
                const [codingResult] = await pool.query(
                    'INSERT INTO coding_interviews (student_id, include_hard, questions) VALUES (?, ?, ?)',
                    [studentId, includeHard, JSON.stringify(enrichedCodingQuestions)]
                );
                codingId = codingResult.insertId;
                await pool.query('UPDATE interviews SET coding_id = ? WHERE id = ?', [codingId, interviewId]);
            }
        } catch (codingErr) {
            logger('WARN', 'Pre-generating coding round failed (non-fatal)', { error: codingErr.message });
        }

        const questionValues = allQuestions.map(q => [
            interviewId,
            q.question,
            JSON.stringify(q.options),
            q.correct_answer,
            q.explanation || ''
        ]);

        await pool.query(
            'INSERT INTO interview_questions (interview_id, question, options, correct_answer, explanation) VALUES ?',
            [questionValues]
        );

        res.status(200).json({ 
            message: 'Interview generated successfully.',
            interviewId,
            codingId,
            questionCount: allQuestions.length
        });

    } catch (error) {
        logger('ERROR', 'Error generating interview', { error: error.message });
        res.status(500).json({ message: 'Failed to generate interview.', error: error.message });
    }
};

// 3. Get Student's Interviews
exports.getInterviews = async (req, res) => {
    try {
        const studentId = req.user.id;
        const [interviews] = await pool.query(
            'SELECT * FROM interviews WHERE student_id = ? ORDER BY created_at DESC',
            [studentId]
        );
        
        // Include resume status
        const [student] = await pool.query('SELECT resume_text, parsed_skills FROM students WHERE id = ?', [studentId]);
        const hasResume = !!student[0]?.resume_text;
        
        // MySQL 2 automatically parses JSON columns. Handle both string and pre-parsed array:
        let parsedSkills = [];
        let suggestedRoles = [];
        if (student[0]?.parsed_skills) {
            let data = typeof student[0].parsed_skills === 'string' 
                ? JSON.parse(student[0].parsed_skills) 
                : student[0].parsed_skills;
                
            if (Array.isArray(data)) {
                parsedSkills = data;
            } else if (data && typeof data === 'object') {
                parsedSkills = data.skills || [];
                suggestedRoles = data.roles || [];
            }
        }

        res.status(200).json({ interviews, hasResume, parsedSkills, suggestedRoles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 4. Get Specific Interview Questions
exports.getInterviewDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const studentId = req.user.id;

        // Verify ownership
        const [interview] = await pool.query('SELECT * FROM interviews WHERE id = ? AND student_id = ?', [id, studentId]);
        if (interview.length === 0) {
            return res.status(403).json({ message: 'Unauthorized or interview not found.' });
        }

        const [questions] = await pool.query(
            'SELECT id, question, options, correct_answer, student_answer, explanation FROM interview_questions WHERE interview_id = ?', 
            [id]
        );
        
        // Security: If not submitted yet, strip the correct answers and explanations
        const isSubmitted = interview[0].ai_feedback !== null;
        
        const formattedQuestions = questions.map(q => {
            const formatted = {
                ...q,
                options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
            };
            
            if (!isSubmitted) {
                delete formatted.correct_answer;
                delete formatted.explanation;
                delete formatted.student_answer;
            }
            
            return formatted;
        });

        // Fetch coding round results if linked
        let codingRound = null;
        if (interview[0].coding_id) {
            const [codingRows] = await pool.query(
                'SELECT * FROM coding_interviews WHERE id = ?',
                [interview[0].coding_id]
            );
            if (codingRows.length > 0) {
                codingRound = codingRows[0];
                // Support mysql2 auto-parsing and manual parsing fallback
                codingRound.questions = typeof codingRound.questions === 'string' ? JSON.parse(codingRound.questions) : codingRound.questions;
                codingRound.student_codes = typeof codingRound.student_codes === 'string' ? JSON.parse(codingRound.student_codes) : codingRound.student_codes;
            }
        }

        res.status(200).json({ 
            interview: interview[0], 
            questions: formattedQuestions,
            codingRound 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 5. Submit Interview and Get Feedback
exports.submitInterview = async (req, res) => {
    try {
        const { id } = req.params; // interview id
        const studentId = req.user.id;
        const { answers } = req.body; // Object: { questionId: selectedOptionText }

        // Verify ownership
        const [interview] = await pool.query('SELECT * FROM interviews WHERE id = ? AND student_id = ?', [id, studentId]);
        if (interview.length === 0) {
            return res.status(403).json({ message: 'Unauthorized or interview not found.' });
        }

        // Get questions
        const [questions] = await pool.query('SELECT * FROM interview_questions WHERE interview_id = ?', [id]);
        
        let correctCount = 0;
        let aiFeedbackContext = '';

        for (const q of questions) {
            const studentAnswer = answers[q.id];
            let isCorrect = false;
            
            if (studentAnswer && studentAnswer.trim().toLowerCase() === q.correct_answer.trim().toLowerCase()) {
                correctCount++;
                isCorrect = true;
            }

            // Save student's answer
            await pool.query('UPDATE interview_questions SET student_answer = ? WHERE id = ?', [studentAnswer || null, q.id]);

            aiFeedbackContext += `
            Question: ${q.question}
            Student Answer: ${studentAnswer || "No Answer"}
            Correct Answer: ${q.correct_answer}
            Was Correct: ${isCorrect}
            `;
        }

        const scorePercentage = Math.round((correctCount / questions.length) * 100);

        // Generate AI Feedback based on performance
        const prompt = `
        You are an expert technical interviewer. The candidate just finished an MCQ screening test for the role of "${interview[0].job_role_target}".
        They scored ${scorePercentage}% (${correctCount} out of ${questions.length}).

        Here is the breakdown of their answers:
        ${aiFeedbackContext}

        Provide a very brief (2-3 paragraphs max) constructive feedback report.
        Highlight their strong areas, point out what they need to study more, and give specific advice for their upcoming real interviews.
        Be encouraging but realistic. Do not use markdown styling like headers, just plain text paragraphs.
        `;

        let feedbackText = "Feedback generation failed.";
        try {
            const { content } = await generateText({
                taskType: 'reporting',
                prompt,
                role: 'system',
                preferredProvider: 'auto',
                temperature: 0.7,
                groqModel: 'llama-3.1-8b-instant',
                geminiModel: 'gemini-1.5-flash',
            });
            feedbackText = content || "No feedback generated.";
        } catch (aiErr) {
            logger('WARN', 'AI feedback generation failed', { error: aiErr.message });
        }

        // Update overall interview score and feedback
        await pool.query('UPDATE interviews SET total_score = ?, ai_feedback = ? WHERE id = ?', [scorePercentage, feedbackText, id]);

        // Return coding_id so the frontend can chain into the coding round
        const [updatedInterview] = await pool.query('SELECT coding_id FROM interviews WHERE id = ?', [id]);
        const codingId = updatedInterview[0]?.coding_id || null;

        // Trigger Notification
        notificationController.createNotification(
            studentId,
            'student',
            'Interview Evaluation Complete',
            `Your AI interview evaluation has been graded. Final Score: ${scorePercentage}%.`,
            `/student/results`
        );

        res.status(200).json({
            message: 'Interview submitted successfully.',
            score: scorePercentage,
            feedback: feedbackText,
            codingId
        });

    } catch (error) {
         logger('ERROR', 'Error submitting interview', { error: error.message });
         res.status(500).json({ error: error.message });
    }
};
