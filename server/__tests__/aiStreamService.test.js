const { Readable } = require('stream');

jest.mock('../services/providers', () => ({
    getProvider: jest.fn()
}));

jest.mock('../prompts', () => ({
    getSystemInstruction: jest.fn().mockReturnValue('mock system instruction'),
    generatePrompt: jest.fn().mockReturnValue('mock prompt'),
    normalizePromptContext: jest.fn(context => (context || '').replace(/\s+/g, ' ').trim())
}));

const { getProvider } = require('../services/providers');
const { analyzeTextStream, _clearCacheForTesting } = require('../services/aiStreamService');

function createSseResponse(lines) {
    return {
        body: Readable.from(lines.map(line => Buffer.from(`${line}\n\n`, 'utf8')))
    };
}

function createMockRes() {
    const writes = [];
    return {
        writes,
        write: jest.fn(chunk => writes.push(chunk)),
        end: jest.fn()
    };
}

function parseWrittenData(res) {
    return res.writes
        .map(chunk => chunk.match(/^data: (.*)\n\n$/)?.[1])
        .filter(Boolean);
}

describe('aiStreamService.js', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        _clearCacheForTesting();
    });

    it('returns an error frame instead of only DONE when the provider stream has no content', async () => {
        getProvider.mockReturnValue({
            callStreamAPI: jest.fn().mockResolvedValue({
                response: createSseResponse(['data: [DONE]']),
                model: 'test-model'
            }),
            parseSSEData: jest.fn().mockReturnValue(null)
        });

        const res = createMockRes();

        await analyzeTextStream({ text: 'hello', context: '', targetLanguage: 'English' }, res);

        const dataFrames = parseWrittenData(res);
        expect(dataFrames).toContain('[DONE]');
        expect(dataFrames.some(frame => {
            try {
                const parsed = JSON.parse(frame);
                return parsed.error === true && parsed.message.includes('No content');
            } catch (_err) {
                return false;
            }
        })).toBe(true);
    });

    it('normalizes the current AI schema into client-compatible meaning and grammar fields before streaming to the extension', async () => {
        const providerText = JSON.stringify({
            source_language: 'en',
            translation: '你好',
            explanation: {
                mode: 'contextual',
                contextual_note: '这里是在打招呼。',
                word_analysis: []
            },
            segments: [{ text: 'hello', reading: null }],
            audio_text: 'hello'
        });

        getProvider.mockReturnValue({
            callStreamAPI: jest.fn().mockResolvedValue({
                response: createSseResponse([`data: ${JSON.stringify({ text: providerText })}`]),
                model: 'test-model'
            }),
            parseSSEData: jest.fn(dataStr => JSON.parse(dataStr))
        });

        const res = createMockRes();

        await analyzeTextStream({ text: 'hello', context: '', targetLanguage: 'Simplified Chinese' }, res);

        const textFrames = parseWrittenData(res)
            .filter(frame => frame !== '[DONE]')
            .map(frame => JSON.parse(frame).text)
            .filter(Boolean);
        const streamedText = textFrames.join('');

        expect(JSON.parse(streamedText)).toEqual(expect.objectContaining({
            meaning: '你好',
            grammar: '这里是在打招呼。',
            language: 'en',
            furigana: 'hello'
        }));
    });

    it('returns a clear truncation error when the provider stops because the output token limit was reached', async () => {
        getProvider.mockReturnValue({
            callStreamAPI: jest.fn().mockResolvedValue({
                response: createSseResponse([
                    `data: ${JSON.stringify({ text: '{"meaning":"partial' })}`,
                    `data: ${JSON.stringify({ finishReason: 'MAX_TOKENS' })}`
                ]),
                model: 'test-model'
            }),
            parseSSEData: jest.fn(dataStr => JSON.parse(dataStr))
        });

        const res = createMockRes();

        await analyzeTextStream({ text: '生産性', context: '', targetLanguage: 'English' }, res);

        const dataFrames = parseWrittenData(res);
        expect(dataFrames.some(frame => {
            try {
                const parsed = JSON.parse(frame);
                return parsed.error === true && parsed.message.includes('cut off');
            } catch (_err) {
                return false;
            }
        })).toBe(true);
    });
});
