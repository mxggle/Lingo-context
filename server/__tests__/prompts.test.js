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

        it('should require context-aware word explanations and grammar notes for single selections', () => {
            const instruction = getSystemInstruction('Simplified Chinese');

            expect(instruction).toContain('For word_by_word mode, contextual_note is still required');
            expect(instruction).toContain('why the selected meaning fits this exact context');
            expect(instruction).toContain('grammar pattern, conjugation, particles, morphology, collocation, or register');
            expect(instruction).toContain('Do not provide a bare dictionary definition');
        });
    });

    describe('generatePrompt', () => {
        it('should return a JSON string with the default target language', () => {
            const promptStr = generatePrompt('hello', 'hello world');
            const promptObj = JSON.parse(promptStr);
            expect(promptObj).toEqual({
                selection: 'hello',
                context: 'hello world',
                target_language: 'English',
                is_single_sentence: true
            });
        });

        it('should return a JSON string with the specified target language', () => {
            const promptStr = generatePrompt('bonjour', 'bonjour le monde', 'French');
            const promptObj = JSON.parse(promptStr);
            expect(promptObj).toEqual({
                selection: 'bonjour',
                context: 'bonjour le monde',
                target_language: 'French',
                is_single_sentence: true
            });
        });

        it('should write the canonical prompt label for Simplified Chinese', () => {
            const promptStr = generatePrompt('hello', 'hello world', 'Simplified Chinese');
            const promptObj = JSON.parse(promptStr);
            expect(promptObj).toEqual({
                selection: 'hello',
                context: 'hello world',
                target_language: 'Simplified Chinese (zh-CN, 简体中文)',
                is_single_sentence: true
            });
        });

        it('should strip legacy website and description metadata from context', () => {
            const legacyContext = '[页面标题: AIに任せる時代は終わり?知らないと損する3つの真実｜ryosan💪]\n' +
                '[网站: note.com]\n' +
                '[描述: 「AIに頼めばコードも文章も一瞬で終わる」そう思って満足してないか?実はその使い方、すでに古い。元Tesla AI責任者でOpenAI創業メンバーでもあるAndrej Karpathyが語った「これからのAI活用」の本質と、明日から仕事の景色が変わる具体的な習慣を、まるっと噛み砕いて伝えるぜ。   ソフトウェアは今、3つ目の時代に突入している  いきなり結論から言う。  今のソフトウェア開発は「S]\n' +
                'Agentic Engineering(エージェント工学):仕様、設計、検証、セキュリティまできっちり詰めて、AIエージェント(自律的にタスクをこなすAI)を「監督」するスタイル。プロ品質を保ったまま、AIの速度を活かす。';

            const promptObj = JSON.parse(generatePrompt('Agentic Engineering', legacyContext, 'Simplified Chinese'));

            expect(promptObj.context).toContain('[页面标题: AIに任せる時代は終わり?知らないと損する3つの真実｜ryosan💪]');
            expect(promptObj.context).toContain('Agentic Engineering(エージェント工学):仕様、設計、検証、セキュリティまできっちり詰めて');
            expect(promptObj.context).not.toContain('[网站:');
            expect(promptObj.context).not.toContain('[描述:');
            expect(promptObj.context).not.toContain('note.com');
            expect(promptObj.context).not.toContain('AIに頼めばコードも文章も一瞬で終わる');
        });
    });
});
