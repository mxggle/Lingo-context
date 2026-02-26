// Gemini AI service — encapsulates all AI interaction logic

const { getSystemInstruction, generatePrompt } = require('../prompts');
const { fetchWithRetry } = require('../fetchWithRetry');
const { sendError } = require('../middleware/errorHandler');

// Cost calculation (rates per 1M tokens for Gemini Flash)
function calculateCost(promptTokens, completionTokens) {
    const RATE_INPUT = 0.10;
    const RATE_OUTPUT = 0.40;
    const inputCost = (promptTokens / 1000000) * RATE_INPUT;
    const outputCost = (completionTokens / 1000000) * RATE_OUTPUT;
    return inputCost + outputCost;
}

// Call Gemini API and return parsed result
async function analyzeText({ text, context, targetLanguage }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw Object.assign(new Error('Server configuration error: API Key missing'), { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const systemInstruction = getSystemInstruction(targetLanguage);
    const prompt = generatePrompt(text, context, targetLanguage);

    const response = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [{ text: systemInstruction + '\n\n' + prompt }]
            }],
            generationConfig: {
                temperature: 0.3,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            }
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errMsg = error.error?.message || 'Gemini API request failed';
        if (response.status === 429) {
            throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
        }
        throw new Error(errMsg);
    }

    const data = await response.json();

    // Extract usage metadata
    const usage = data.usageMetadata || {};
    const promptTokens = usage.promptTokenCount || 0;
    const completionTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || 0;
    const cost = calculateCost(promptTokens, completionTokens);

    // Extract content
    const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!contentText) throw new Error('No content in response');

    // Parse JSON from content
    const jsonMatch = contentText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid JSON format in response');

    const result = JSON.parse(jsonMatch[0]);
    if (result.source_language && !result.language) {
        result.language = result.source_language;
    }

    // Furigana reconstruction for Japanese
    const isJapanese = result.language === 'ja' || result.source_language === 'ja';
    const hasReadings = result.segments && Array.isArray(result.segments) &&
        result.segments.some(s => s.reading && s.reading !== s.text);

    if (isJapanese && hasReadings) {
        result.furigana = result.segments.map(segment => {
            if (segment.reading && segment.reading !== segment.text) {
                return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
            }
            return segment.text;
        }).join('');
    } else {
        result.furigana = text;
    }

    return {
        result,
        usage: { model, promptTokens, completionTokens, totalTokens, cost }
    };
}

module.exports = { analyzeText, calculateCost };
