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
    });
});
