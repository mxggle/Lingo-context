const { normalizeAnalysisResult } = require('../services/normalizeAnalysisResult');

describe('normalizeAnalysisResult.js', () => {
    it('combines context notes and word analysis into the client grammar field', () => {
        const result = normalizeAnalysisResult({
            source_language: 'ja',
            translation: '并不局限于',
            explanation: {
                mode: 'word_by_word',
                contextual_note: '这里的「限らない」用于否定“只限于某一种情况”的理解。',
                word_analysis: [
                    {
                        word: '限ら',
                        reading: 'かぎら',
                        role: '动词「限る」的未然形',
                        meaning: '限制、限定'
                    },
                    {
                        word: 'ない',
                        reading: null,
                        role: '否定助动词',
                        meaning: '不、没有'
                    }
                ]
            },
            nuance_note: '「とは限らない」常表示“未必/不一定”。',
            segments: [{ text: '限らない', reading: 'かぎらない' }],
            audio_text: '限らない'
        }, '限らない');

        expect(result.meaning).toBe('并不局限于');
        expect(result.grammar).toContain('这里的「限らない」用于否定');
        expect(result.grammar).toContain('限ら: 限制、限定 (动词「限る」的未然形)');
        expect(result.grammar).toContain('ない: 不、没有 (否定助动词)');
        expect(result.grammar).toContain('「とは限らない」常表示“未必/不一定”。');
    });
});
