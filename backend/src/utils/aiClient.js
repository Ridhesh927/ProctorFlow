const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.KILO_API_KEY;

// Multiple Groq Keys support
const groqKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4
].filter(Boolean);

let groqClients = groqKeys.map(key => new Groq({ apiKey: key }));
let currentGroqIndex = 0;

const TASK_KEY_MAP = {
    'mcq_gen': 0,      // Key 1
    'coding': 1,       // Key 2
    'monitoring': 2,   // Key 3
    'reporting': 0,    // Key 1 (shared)
    'item_analysis': 1 // Key 2 (shared)
};

const getGroqClient = (taskType) => {
    if (groqClients.length === 0) return null;
    
    // Try preferred key for task
    if (taskType && TASK_KEY_MAP[taskType] !== undefined) {
        const preferredIndex = TASK_KEY_MAP[taskType];
        if (preferredIndex < groqClients.length) {
            return { client: groqClients[preferredIndex], index: preferredIndex };
        }
    }

    // Default to rotation
    const index = currentGroqIndex;
    const client = groqClients[index];
    currentGroqIndex = (currentGroqIndex + 1) % groqClients.length;
    return { client, index };
};

const geminiClient = geminiApiKey
    ? new GoogleGenerativeAI(geminiApiKey)
    : null;

const normalizeProvider = (provider) => {
    const value = String(provider || 'auto').toLowerCase();
    if (value === 'groq' || value === 'gemini' || value === 'auto') return value;
    return 'auto';
};

const getProviderOrder = (provider) => {
    const normalized = normalizeProvider(provider);
    if (normalized === 'groq') return ['groq', 'gemini'];
    if (normalized === 'gemini') return ['gemini', 'groq'];

    const defaultProvider = normalizeProvider(process.env.AI_DEFAULT_PROVIDER || 'auto');
    if (defaultProvider === 'gemini') return ['gemini', 'groq'];
    return ['groq', 'gemini'];
};

const stripCodeFences = (text) => {
    if (!text) return '';
    return text
        .trim()
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/think>/gi, '')
        .replace(/<think>/gi, '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
};

const extractBalancedJson = (text) => {
    if (!text) return null;

    const start = text.search(/[\[{]/);
    if (start === -1) return null;

    const stack = [];
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{' || ch === '[') {
            stack.push(ch);
            continue;
        }

        if (ch === '}' || ch === ']') {
            const open = stack[stack.length - 1];
            if ((open === '{' && ch === '}') || (open === '[' && ch === ']')) {
                stack.pop();
                if (stack.length === 0) {
                    return text.slice(start, i + 1);
                }
            } else {
                return null;
            }
        }
    }

    return null;
};

const parseJsonFromResponse = (content) => {
    const cleaned = stripCodeFences(content);

    try {
        return JSON.parse(cleaned);
    } catch (initialError) {
        const extracted = extractBalancedJson(cleaned);
        if (!extracted) {
            throw initialError;
        }

        return JSON.parse(extracted);
    }
};

const DEFAULT_AI_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 10000;

const DEFAULT_FALLBACK_QUESTIONS = {
    questions: [
        {
            question: "Which data structure uses LIFO (Last In, First Out) ordering?",
            options: ["Queue", "Stack", "Array", "Linked List"],
            correct_answer: 1,
            explanation: "A Stack operates on a Last In, First Out (LIFO) principle.",
            topic: "Data Structures",
            difficulty: "Medium",
            marks: 5
        },
        {
            question: "What is the primary purpose of indexing in relational databases?",
            options: [
                "To speed up data retrieval operations",
                "To reduce disk space usage",
                "To enforce foreign key constraints automatically",
                "To prevent database deadlocks"
            ],
            correct_answer: 0,
            explanation: "Indexes speed up SELECT queries by providing quick lookups on indexed columns.",
            topic: "Database Management",
            difficulty: "Medium",
            marks: 5
        }
    ]
};

const withTimeout = (promise, ms = DEFAULT_AI_TIMEOUT_MS, operationName = 'AI Request') => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`${operationName} timed out after ${ms}ms`);
            err.code = 'ETIMEDOUT';
            reject(err);
        }, ms);
    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
};

const callProvider = async (provider, {
    taskType,
    prompt,
    role,
    jsonMode,
    temperature,
    maxTokens,
    timeout,
    groqModel,
    geminiModel,
}) => {
    if (provider === 'groq') {
        return callGroq({
            taskType,
            prompt,
            role,
            jsonMode,
            temperature,
            maxTokens,
            timeout,
            model: groqModel,
        });
    }

    if (provider === 'gemini') {
        return callGemini({
            prompt,
            jsonMode,
            temperature,
            maxTokens,
            timeout,
            model: geminiModel,
        });
    }

    throw new Error(`Unsupported provider: ${provider}`);
};

const callGroq = async ({ taskType, prompt, role, jsonMode, temperature, maxTokens, timeout, model }) => {
    let attempts = 0;
    const maxAttempts = groqClients.length || 1;
    let lastError = null;
    const timeoutMs = timeout || DEFAULT_AI_TIMEOUT_MS;

    while (attempts < maxAttempts) {
        const result = getGroqClient(taskType);
        const client = result?.client;
        const index = result?.index;
        
        if (!client) {
            throw new Error('No GROQ_API_KEYS are configured');
        }

        console.log(`[Groq] Attempt ${attempts + 1}/${maxAttempts} (Key #${index + 1}) for task: ${taskType || 'default'} using model:`, model || 'llama-3.3-70b-versatile');
        
        try {
            const completionPromise = client.chat.completions.create({
                messages: [{ role: role || 'user', content: prompt }],
                model: model || 'llama-3.3-70b-versatile',
                temperature: typeof temperature === 'number' ? temperature : 0.7,
                ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
                ...(maxTokens ? { max_tokens: maxTokens } : {}),
            }, { timeout: timeoutMs });

            const completion = await withTimeout(
                completionPromise,
                timeoutMs,
                `Groq API (model: ${model || 'llama-3.3-70b-versatile'})`
            );

            const content = completion.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No response from Groq');
            }

            console.log('[Groq] Success - Response length:', content.length);
            return content;
        } catch (error) {
            lastError = error;
            console.error(`[Groq] Key failed (Attempt ${attempts + 1}):`, error.message);
            
            // If it's a rate limit or auth error, try another key immediately
            if (error.status === 429 || error.status === 401 || error.code === 'ETIMEDOUT') {
                attempts++;
                continue;
            }
            // For other errors, try one more key just in case
            attempts++;
        }
    }

    throw lastError || new Error('Groq calls failed after all key rotations');
};

const callGemini = async ({ prompt, jsonMode, temperature, maxTokens, timeout, model }) => {
    if (!geminiClient) {
        throw new Error('GEMINI_API_KEY or KILO_API_KEY is not configured');
    }

    const timeoutMs = timeout || DEFAULT_AI_TIMEOUT_MS;

    const generativeModel = geminiClient.getGenerativeModel({
        model: model || 'gemini-3.5-flash',
    });

    const generationPromise = generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: typeof temperature === 'number' ? temperature : 0.7,
            ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
    });

    const result = await withTimeout(
        generationPromise,
        timeoutMs,
        `Gemini API (model: ${model || 'gemini-3.5-flash'})`
    );

    const content = result?.response?.text();
    if (!content) {
        throw new Error('No response from Gemini');
    }

    return content;
};

const callWithFallback = async ({
    prompt,
    role,
    preferredProvider,
    jsonMode = false,
    temperature,
    maxTokens,
    timeout,
    fallbackContent,
    fallbackText,
    groqModel,
    geminiModel,
}) => {
    const order = getProviderOrder(preferredProvider);
    const errors = [];

    for (const provider of order) {
        try {
            const content = await callProvider(provider, {
                prompt,
                role,
                jsonMode,
                temperature,
                maxTokens,
                timeout,
                groqModel,
                geminiModel,
            });
            return { providerUsed: provider, content };
        } catch (error) {
            errors.push(`${provider}: ${error.message}`);
        }
    }

    const effectiveFallback = fallbackContent || fallbackText;
    if (effectiveFallback) {
        console.warn(`[AI] All providers failed. Returning graceful text fallback.`);
        return { providerUsed: 'fallback', content: effectiveFallback };
    }

    throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
};

const generateJson = async (options) => {
    const order = getProviderOrder(options.preferredProvider);
    const errors = [];

    for (const provider of order) {
        try {
            const content = await callProvider(provider, {
                ...options,
                jsonMode: true,
            });

            const parsed = parseJsonFromResponse(content);
            
            console.log(`[AI] ${provider} succeeded - Generated JSON with ${JSON.stringify(parsed).length} chars`);
            
            return {
                providerUsed: provider,
                data: parsed,
            };
        } catch (error) {
            const errorMsg = `${provider}: ${error.message}`;
            errors.push(errorMsg);
            console.error(`[AI] ${provider} failed:`, error.message);
        }
    }

    // Graceful fallback mechanisms
    if (options.fallbackData) {
        console.warn('[AI] Using provided fallback data after AI provider failure/timeout');
        return {
            providerUsed: 'fallback',
            data: options.fallbackData
        };
    }

    // Question generation fallback
    if (options.prompt && (options.prompt.includes('multiple-choice') || options.prompt.includes('MCQ') || options.prompt.includes('"questions"'))) {
        console.warn('[AI] Falling back to standard question dataset due to provider failure/timeout');
        return {
            providerUsed: 'fallback',
            data: DEFAULT_FALLBACK_QUESTIONS
        };
    }

    const fullError = `All AI providers failed to produce valid JSON. ${errors.join(' | ')}`;
    console.error('[AI] All providers exhausted:', fullError);
    throw new Error(fullError);
};

const generateText = async (options) => {
    return callWithFallback({ ...options, jsonMode: false });
};

module.exports = {
    generateJson,
    generateText,
    withTimeout,
    DEFAULT_AI_TIMEOUT_MS,
    DEFAULT_FALLBACK_QUESTIONS,
};
