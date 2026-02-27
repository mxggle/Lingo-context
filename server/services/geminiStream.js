// Gemini AI service — encapsulates streaming AI interaction logic

const { getSystemInstruction, generatePrompt } = require('../prompts');
const { fetchWithRetry } = require('../fetchWithRetry');

async function analyzeTextStream({ text, context, targetLanguage }, res) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw Object.assign(new Error('Server configuration error: API Key missing'), { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const timeout = parseInt(process.env.API_TIMEOUT) || 30000;

    const systemInstruction = getSystemInstruction(targetLanguage);
    const prompt = generatePrompt(text, context, targetLanguage);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
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
                    maxOutputTokens: 512,
                }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const errMsg = error.error?.message || 'Gemini API request failed';
            if (response.status === 429) {
                throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
            }
            throw new Error(errMsg);
        }

        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        for await (const value of response.body) {
            buffer += decoder.decode(value, { stream: true });

            // Parse SSE chunks from Gemini to extract just the text parts
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Save incomplete chunk for next iteration

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.replace('data: ', '').trim();
                    if (!dataStr) continue;

                    try {
                        const parsed = JSON.parse(dataStr);
                        const candidates = parsed.candidates;
                        if (candidates && candidates.length > 0) {
                            const textPart = candidates[0].content?.parts?.[0]?.text;
                            if (textPart) {
                                // Forward textPart directly as SSE data
                                res.write(`data: ${JSON.stringify({ text: textPart })}\n\n`);
                            }
                        }
                    } catch (e) {
                        // Ignore parse errors on partial chunks if any
                    }
                }
            }
        }

    } catch (error) {
        console.error('Streaming API Error:', error);
        const message = error.name === 'AbortError' 
            ? 'Request timed out. Please try again.' 
            : error.message;
        res.write(`data: ${JSON.stringify({ error: true, message })}\n\n`);
    } finally {
        clearTimeout(timeoutId);
        res.write('data: [DONE]\n\n');
        res.end();
    }
}

module.exports = { analyzeTextStream };
