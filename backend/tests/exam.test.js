const request = require('supertest');
const { app, server } = require('../server');
const { pool } = require('../src/config/db');
const { getTestTeacherToken, getTestStudentToken } = require('./helpers/authHelpers');

describe('Exam Routes (/api/exams)', () => {
    let teacherToken;
    let studentToken;
    let examId;
    let sessionId;
    let questionId;

    beforeAll(async () => {
        // Setup initial tokens
        const teacher = await getTestTeacherToken();
        teacherToken = teacher.token;

        const student = await getTestStudentToken();
        studentToken = student.token;
    });

    afterAll(async () => {
        if (server && server.listening) {
            await new Promise(resolve => server.close(resolve));
        }
        await pool.end();
    });

    describe('Teacher Exam Management', () => {
        it('should allow teacher to create a new exam', async () => {
            const response = await request(app)
                .post('/api/exams/create')
                .set('Cookie', [`auth_token=${teacherToken}`])
                .send({
                    title: 'Test Integration Exam',
                    subject: 'Computer Science',
                    duration: 60,
                    total_marks: 10,
                    passing_marks: 4,
                    questions: [
                        {
                            question: 'What is 2+2?',
                            options: ['3', '4', '5', '6'],
                            correct_answer: 1,
                            marks: 10,
                            difficulty: 'Easy'
                        }
                    ],
                    target_department: null,
                    target_year: null,
                    expires_at: new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' ')
                });

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('examId');
            examId = response.body.examId;
        });

        it('should return teacher exams list', async () => {
            const response = await request(app)
                .get('/api/exams/teacher/my-exams')
                .set('Cookie', [`auth_token=${teacherToken}`]);

            expect(response.status).toBe(200);
            expect(response.body.length).toBeGreaterThan(0);
        });
    });

    describe('Student Exam Flow', () => {
        it('should list available exams for student', async () => {
            const response = await request(app)
                .get('/api/exams/student/available')
                .set('Cookie', [`auth_token=${studentToken}`]);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.exams)).toBe(true);
        });

        it('should allow student to fetch exam details', async () => {
            const response = await request(app)
                .get(`/api/exams/${examId}`)
                .set('Cookie', [`auth_token=${studentToken}`]);

            expect(response.status).toBe(200);
            expect(response.body.title).toBe('Test Integration Exam');
            expect(response.body.questions.length).toBeGreaterThan(0);
            questionId = response.body.questions[0].id;
        });

        it('should allow student to start exam session', async () => {
            const response = await request(app)
                .post('/api/exams/session/start')
                .set('Cookie', [`auth_token=${studentToken}`])
                .send({ examId });

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('sessionId');
            sessionId = response.body.sessionId;
        });

        it('should allow student to submit exam', async () => {
            const response = await request(app)
                .post('/api/exams/submit')
                .set('Cookie', [`auth_token=${studentToken}`])
                .send({
                    examId,
                    sessionId,
                    answers: { [questionId]: 1 } // Answered option index 1 (correct)
                });

            expect(response.status).toBe(200);
            expect(response.body.score).toBe(10);
        });
    });

    describe('Teacher Results', () => {
        it('should allow teacher to view exam results', async () => {
            const response = await request(app)
                .get('/api/exams/teacher/results')
                .set('Cookie', [`auth_token=${teacherToken}`]);

            expect(response.status).toBe(200);
            expect(response.body.results).toBeDefined();
            // Should contain our student's result
            const result = response.body.results.find(r => r.exam_id === examId);
            expect(result).toBeDefined();
            expect(result.score).toBe(10);
        });

        it('should allow teacher to fetch exam result script', async () => {
            const resultsResponse = await request(app)
                .get('/api/exams/teacher/results')
                .set('Cookie', [`auth_token=${teacherToken}`]);
            const result = resultsResponse.body.results.find(r => r.exam_id === examId);

            const scriptResponse = await request(app)
                .get(`/api/exams/teacher/result/${result.id}/script`)
                .set('Cookie', [`auth_token=${teacherToken}`]);

            expect(scriptResponse.status).toBe(200);
            expect(scriptResponse.body.result).toBeDefined();
            expect(scriptResponse.body.questions).toBeDefined();
            expect(scriptResponse.body.questions.length).toBeGreaterThan(0);
        });
    });
});
