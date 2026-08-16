const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const { parse } = require('csv-parse/sync');
const Tesseract = require('tesseract.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger.js');
const { matchSection, getSamplesBySection } = require('../utils/csvSearch.js');
const { generateJson } = require('../utils/aiClient.js');
require('dotenv').config();

const MIN_PDF_TEXT_LENGTH = 120;

const extractScannedPdfTextWithGemini = async (pdfBuffer) => {
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.KILO_API_KEY;
    if (!geminiApiKey) {
        throw new Error('GEMINI_API_KEY or KILO_API_KEY is not configured');
    }

    const geminiClient = new GoogleGenerativeAI(geminiApiKey);
    const model = geminiClient.getGenerativeModel({ model: 'gemini-3.5-flash' });

    const result = await model.generateContent({
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        text: 'Extract all readable text from this scanned PDF. Return only plain text with paragraph breaks, no markdown and no additional commentary.'
                    },
                    {
                        inlineData: {
                            mimeType: 'application/pdf',
                            data: pdfBuffer.toString('base64')
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
        }
    });

    return result?.response?.text()?.trim() || '';
};

exports.generateQuestions = async (req, res) => {
    try {
        let { context, count = 5, difficulty = 'Medium', category = '', provider = 'auto' } = req.body;
        let fileContent = '';
        let extractionMethod = null;

        // Handle File Upload Extraction
        if (req.file) {
            const mimetype = req.file.mimetype;
            const buffer = req.file.buffer;
            const originalName = req.file.originalname.toLowerCase();

            if (mimetype === 'application/pdf') {
                const pdfData = await pdf(buffer);
                fileContent = (pdfData.text || '').trim();
                extractionMethod = 'pdf-parse';

                // Fallback for scanned PDFs where embedded text is missing/very small.
                if (fileContent.length < MIN_PDF_TEXT_LENGTH) {
                    try {
                        const scannedText = await extractScannedPdfTextWithGemini(buffer);
                        if (scannedText.length >= MIN_PDF_TEXT_LENGTH) {
                            fileContent = scannedText;
                            extractionMethod = 'gemini-scanned-pdf-ocr';
                        }
                    } catch (ocrError) {
                        logger('WARN', 'Scanned PDF OCR fallback failed', { message: ocrError.message });
                    }
                }
            } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || originalName.endsWith('.docx')) {
                const result = await mammoth.extractRawText({ buffer });
                fileContent = result.value;
                extractionMethod = 'mammoth-docx';
            } else if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || originalName.endsWith('.xlsx') || originalName.endsWith('.xls')) {
                const workbook = xlsx.read(buffer, { type: 'buffer' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // Convert to CSV string to give AI a clean format to parse
                fileContent = xlsx.utils.sheet_to_csv(worksheet);
                extractionMethod = 'xlsx-excel';
            } else if (mimetype === 'text/csv' || originalName.endsWith('.csv')) {
                fileContent = buffer.toString('utf8');
                extractionMethod = 'raw-csv';
            } else if (mimetype.startsWith('image/')) {
                const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
                fileContent = text;
                extractionMethod = 'tesseract-image-ocr';
            }

            if (fileContent) {
                logger('INFO', `Extracted text from ${extractionMethod}`, {
                    length: fileContent.length,
                    filename: originalName
                });
            }
        }

        // Combine context from body and file
        const finalContext = (context || '') + '\n' + fileContent;

        if (!finalContext.trim() && !category.trim()) {
            return res.status(400).json({ message: 'Syllabus text, a file (PDF/Docx/CSV/Excel/Image), or a category is required to generate questions.' });
        }

        // Limit count to prevent abuse or timeout
        const questionCount = Math.min(Math.max(parseInt(count, 10) || 5, 1), 50);

        // ── CSV Reference Integration ──────────────────────────────────────────
        let referenceBlock = '';
        let matchedSection = null;

        if (category && category.trim()) {
            matchedSection = matchSection(category.trim());

            if (matchedSection) {
                const samples = getSamplesBySection(matchedSection, 5);

                if (samples.length > 0) {
                    const sampleText = samples.map((s, i) =>
                        `  Example ${i + 1}:\n  Q: ${s.question}\n  A) ${s.a}  B) ${s.b}  C) ${s.c}  D) ${s.d}\n  Correct Answer Index: ${s.answer}`
                    ).join('\n\n');

                    referenceBlock = `
Reference Examples from the "${matchedSection}" database (match this style):
"""
${sampleText}
"""
`;
                    logger('INFO', `CSV reference injected for section: ${matchedSection}`);
                }
            }
        }
        // ──────────────────────────────────────────────────────────────────────

        // Build Prompt
        const contextSection = finalContext.trim()
            ? `Source Content/File Data:\n"""\n${finalContext}\n"""\n`
            : `Topic: ${category}\n`;

        const referenceInstruction = referenceBlock
            ? `${referenceBlock}\nUsing these references as a guide, `
            : '';

        const prompt = `You are an expert curriculum designer.
${contextSection}
${referenceInstruction}Extract or generate exactly ${questionCount} multiple-choice questions (MCQs) from the source content above.
Difficulty Level: ${difficulty}

Instructions:
1. Return exactly ${questionCount} questions.
2. Each question MUST have exactly 4 options.
3. correct_answer MUST be the INDEX of the correct option (0 for the first option, 1 for second, etc.).
4. Provide a very short explanation.
5. Topic should be the specific sub-topic (e.g., "React Hooks", "Database Normalization").
6. All output must be valid JSON.

OUTPUT FORMAT:
{
  "questions": [
    {
      "question": "Question text here?",
      "options": ["Option 0", "Option 1", "Option 2", "Option 3"],
      "correct_answer": 1, 
      "explanation": "Brief explanation why option 1 is correct.",
      "topic": "Sub-topic name",
      "difficulty": "${difficulty}",
      "marks": 5
    }
  ]
}`;

        const { data: parsedData, providerUsed } = await generateJson({
            prompt,
            role: 'system',
            preferredProvider: provider,
            temperature: 0.3,
            groqModel: 'llama-3.1-8b-instant',
            geminiModel: 'gemini-3.5-flash',
        });

        if (!parsedData || !parsedData.questions || !Array.isArray(parsedData.questions)) {
            throw new Error('Invalid JSON structure returned from AI');
        }

        res.status(200).json({
            questions: parsedData.questions,
            meta: {
                providerUsed,
                extractionMethod,
                count: parsedData.questions.length
            }
        });

    } catch (error) {
        logger('ERROR', 'Error in smart question import:', { message: error.message });
        res.status(500).json({ message: 'Failed to process file and generate questions.', error: error.message });
    }
};
