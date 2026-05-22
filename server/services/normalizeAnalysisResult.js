function formatWordAnalysis(wordAnalysis) {
    if (!Array.isArray(wordAnalysis) || wordAnalysis.length === 0) {
        return null;
    }

    return wordAnalysis
        .map(item => {
            const word = item.word || '';
            const meaning = item.meaning || '';
            const role = item.role ? ` (${item.role})` : '';
            return `${word}: ${meaning}${role}`.trim();
        })
        .filter(Boolean)
        .join('\n');
}

function formatExplanation(explanation, nuanceNote) {
    if (!explanation) {
        return null;
    }

    const parts = [
        explanation.contextual_note,
        formatWordAnalysis(explanation.word_analysis),
        nuanceNote
    ];

    const text = parts
        .map(part => (typeof part === 'string' ? part.trim() : part))
        .filter(Boolean)
        .join('\n\n');

    return text || null;
}

function buildFurigana(result, originalText) {
    const isJapanese = result.language === 'ja' || result.source_language === 'ja';
    const hasReadings = Array.isArray(result.segments) &&
        result.segments.some(segment => segment.reading && segment.reading !== segment.text);

    if (!isJapanese || !hasReadings) {
        return result.furigana || originalText;
    }

    return result.segments.map(segment => {
        if (segment.reading && segment.reading !== segment.text) {
            return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
        }
        return segment.text;
    }).join('');
}

function normalizeAnalysisResult(result, originalText) {
    const normalized = { ...result };

    if (normalized.source_language && !normalized.language) {
        normalized.language = normalized.source_language;
    }

    if (!normalized.meaning && normalized.translation) {
        normalized.meaning = normalized.translation;
    }

    if (!normalized.grammar && normalized.explanation) {
        normalized.grammar = formatExplanation(normalized.explanation, normalized.nuance_note);
    }

    normalized.furigana = buildFurigana(normalized, originalText);

    return normalized;
}

module.exports = { normalizeAnalysisResult };
