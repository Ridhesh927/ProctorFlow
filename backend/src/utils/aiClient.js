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

const callProvider = async (provider, {
    taskType,
    prompt,
    role,
    jsonMode,
    temperature,
    maxTokens,
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
            model: groqModel,
        });
    }

    if (provider === 'gemini') {
        return callGemini({
            prompt,
            jsonMode,
            temperature,
            maxTokens,
            model: geminiModel,
        });
    }

    throw new Error(`Unsupported provider: ${provider}`);
};

const callGroq = async ({ taskType, prompt, role, jsonMode, temperature, maxTokens, model }) => {
    let attempts = 0;
    const maxAttempts = groqClients.length || 1;
    let lastError = null;

    while (attempts < maxAttempts) {
        const result = getGroqClient(taskType);
        const client = result?.client;
        const index = result?.index;
        
        if (!client) {
            throw new Error('No GROQ_API_KEYS are configured');
        }

        console.log(`[Groq] Attempt ${attempts + 1}/${maxAttempts} (Key #${index + 1}) for task: ${taskType || 'default'} using model:`, model || 'llama-3.3-70b-versatile');
        
        try {
            const completion = await client.chat.completions.create({
                messages: [{ role: role || 'user', content: prompt }],
                model: model || 'llama-3.3-70b-versatile',
                temperature: typeof temperature === 'number' ? temperature : 0.7,
                ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
                ...(maxTokens ? { max_tokens: maxTokens } : {}),
            });

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
            if (error.status === 429 || error.status === 401) {
                attempts++;
                continue;
            }
            // For other errors, maybe it's the prompt or model, but let's try one more key just in case
            attempts++;
        }
    }

    throw lastError || new Error('Groq calls failed after all key rotations');
};

const callGemini = async ({ prompt, jsonMode, temperature, maxTokens, model }) => {
    if (!geminiClient) {
        throw new Error('GEMINI_API_KEY or KILO_API_KEY is not configured');
    }

    const generativeModel = geminiClient.getGenerativeModel({
        model: model || 'gemini-3.5-flash',
    });

    const result = await generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: typeof temperature === 'number' ? temperature : 0.7,
            ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
    });

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
                groqModel,
                geminiModel,
            });
            return { providerUsed: provider, content };
        } catch (error) {
            errors.push(`${provider}: ${error.message}`);
        }
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
};
