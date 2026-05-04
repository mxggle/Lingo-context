const { getSystemInstruction, generatePrompt } = require('../prompts');

describe('prompts.js', () => {
    describe('getSystemInstruction', () => {
        it('should return system instruction with default English language', () => {
            const instruction = getSystemInstruction();
            expect(typeof instruction).toBe('string');
            expect(instruction).toContain('fields MUST be written ENTIRELY in English');
        });

        it('should return system instruction with specified target language', () => {
            const instruction = getSystemInstruction('French');
            expect(typeof instruction).toBe('string');
            expect(instruction).toContain('fields MUST be written ENTIRELY in French');
        });

        it('should use canonical zh-CN wording for Simplified Chinese', () => {
            const instruction = getSystemInstruction('Simplified Chinese');
            expect(typeof instruction).toBe('string');
            expect(instruction).toContain('Simplified Chinese (zh-CN, 简体中文)');
            expect(instruction).toContain('Use Simplified Chinese only');
        });
    });

    describe('generatePrompt', () => {
        it('should return a JSON string with the default target language', () => {
            const promptStr = generatePrompt('hello', 'hello world');
            const promptObj = JSON.parse(promptStr);
            expect(promptObj).toEqual({
                selection: 'hello',
                context: 'hello world',
                target_language: 'English'
            });
        });

        it('should return a JSON string with the specified target language', () => {
            const promptStr = generatePrompt('bonjour', 'bonjour le monde', 'French');
            const promptObj = JSON.parse(promptStr);
            expect(promptObj).toEqual({
                selection: 'bonjour',
                context: 'bonjour le monde',
                target_language: 'French'
            });
        });

        it('should write the canonical prompt label for Simplified Chinese', () => {
            const promptStr = generatePrompt('hello', 'hello world', 'Simplified Chinese');
            const promptObj = JSON.parse(promptStr);
            expect(promptObj).toEqual({
                selection: 'hello',
                context: 'hello world',
                target_language: 'Simplified Chinese (zh-CN, 简体中文)'
            });
        });
    });
});
