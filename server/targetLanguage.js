const TARGET_LANGUAGE_CONFIG = {
    english: {
        name: 'English',
        promptLabel: 'English',
        promptDetails: 'Use natural English.',
        requiredRegex: null
    },
    'simplified chinese': {
        name: 'Simplified Chinese',
        promptLabel: 'Simplified Chinese (zh-CN, 简体中文)',
        promptDetails: 'Use Simplified Chinese only. Use simplified characters, not Traditional Chinese. Do not switch explanatory sentences into English.',
        requiredRegex: /[\u3400-\u4DBF\u4E00-\u9FFF]/
    },
    'traditional chinese': {
        name: 'Traditional Chinese',
        promptLabel: 'Traditional Chinese (zh-TW, 繁體中文)',
        promptDetails: 'Use Traditional Chinese only. Use traditional characters, not Simplified Chinese. Do not switch explanatory sentences into English.',
        requiredRegex: /[\u3400-\u4DBF\u4E00-\u9FFF]/
    },
    japanese: {
        name: 'Japanese',
        promptLabel: 'Japanese (ja-JP, 日本語)',
        promptDetails: 'Use natural Japanese.',
        requiredRegex: null
    }
};

function normalizeTargetLanguage(targetLanguage) {
    const raw = String(targetLanguage || 'English').trim();
    const key = raw.toLowerCase();
    return TARGET_LANGUAGE_CONFIG[key] || {
        name: raw || 'English',
        promptLabel: raw || 'English',
        promptDetails: `Use ${raw || 'English'} for all explanatory output.`,
        requiredRegex: null
    };
}

function getTargetFieldsText(result) {
    const wordAnalysisText = Array.isArray(result?.explanation?.word_analysis)
        ? result.explanation.word_analysis
            .map(item => [item?.role, item?.meaning].filter(Boolean).join(' '))
            .join(' ')
        : '';

    return [
        result?.meaning,
        result?.grammar,
        result?.translation,
        result?.explanation?.contextual_note,
        wordAnalysisText,
        result?.nuance_note
    ].filter(Boolean).join(' ');
}

function shouldRetryForLanguageMismatch(result, targetLanguage) {
    const config = normalizeTargetLanguage(targetLanguage);
    if (!config.requiredRegex) return false;

    const fieldsText = getTargetFieldsText(result);
    if (!fieldsText.trim()) return false;

    return !config.requiredRegex.test(fieldsText);
}

module.exports = {
    normalizeTargetLanguage,
    shouldRetryForLanguageMismatch
};
