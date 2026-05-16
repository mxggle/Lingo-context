const express = require('express');
const router = express.Router();
const { getProvider } = require('../services/providers');
const { normalizeTargetLanguage } = require('../targetLanguage');

// In-memory LRU-style cache: key = "word::lang", max 500 entries
const definitionCache = new Map();
const CACHE_MAX = 500;

function cacheGet(key) {
    if (!definitionCache.has(key)) return null;
    // Move to end (most recently used)
    const val = definitionCache.get(key);
    definitionCache.delete(key);
    definitionCache.set(key, val);
    return val;
}

function cacheSet(key, val) {
    if (definitionCache.size >= CACHE_MAX) {
        // Evict least recently used (first entry)
        definitionCache.delete(definitionCache.keys().next().value);
    }
    definitionCache.set(key, val);
}

const LOCALE_TO_LANGUAGE = {
    'zh_CN': 'Simplified Chinese',
    'zh_TW': 'Traditional Chinese',
    'ja': 'Japanese',
    'en': 'English',
};

router.post('/', async (req, res) => {
    const { text, nativeLanguage } = req.body;
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text required' });
    }

    const defLanguage = nativeLanguage
        ? (LOCALE_TO_LANGUAGE[nativeLanguage] || normalizeTargetLanguage(req.user?.target_language || 'English').name)
        : normalizeTargetLanguage(req.user?.target_language || 'English').name;
    const cacheKey = `${text.slice(0, 200).toLowerCase()}::${defLanguage}`;

    const cached = cacheGet(cacheKey);
    if (cached) {
        return res.json({ meanings: cached });
    }

    const aiProvider = req.user?.ai_provider || process.env.AI_PROVIDER || 'gemini';
    const provider = getProvider(aiProvider);

    const systemInstruction = `You are a dictionary. Return only valid JSON, no other text. Always respond in ${defLanguage} only.`;
    const prompt = `Translate "${text.slice(0, 200)}" into ${defLanguage}. Give 1-2 very short translations.
JSON: {"meanings": ["${defLanguage}_word1", "${defLanguage}_word2"]}
CRITICAL: Output ONLY in ${defLanguage}. Do NOT use English unless ${defLanguage} is English. Single word or short phrase only.`;

    try {
        const { contentText } = await provider.callAPI(systemInstruction, prompt, { skipCache: true, noThinking: true, maxOutputTokens: 100 });
        const data = JSON.parse(contentText.replace(/```json\n?|```/g, '').trim());
        const meanings = Array.isArray(data.meanings) ? data.meanings.slice(0, 3) : [];
        cacheSet(cacheKey, meanings);
        res.json({ meanings });
    } catch (e) {
        res.json({ meanings: [] });
    }
});

module.exports = router;
