const express = require('express');
const router = express.Router();
const { getProvider } = require('../services/providers');
const { normalizeTargetLanguage } = require('../targetLanguage');

router.post('/', async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text required' });
    }

    const targetLanguage = normalizeTargetLanguage(req.user?.target_language || 'English').name;
    const aiProvider = req.user?.ai_provider || process.env.AI_PROVIDER || 'gemini';
    const provider = getProvider(aiProvider);

    const systemInstruction = 'You are a concise dictionary. Return only valid JSON, no other text.';
    const prompt = `Define the word or phrase "${text.slice(0, 200)}" in ${targetLanguage}.
Return exactly this JSON: {"meanings": ["meaning1", "meaning2"]}
Rules: 2-3 main meanings only. Each meaning under 20 words. No examples, no grammar labels.`;

    try {
        const { contentText } = await provider.callAPI(systemInstruction, prompt, { skipCache: true });
        const data = JSON.parse(contentText.replace(/```json\n?|```/g, '').trim());
        const meanings = Array.isArray(data.meanings) ? data.meanings.slice(0, 3) : [];
        res.json({ meanings });
    } catch (e) {
        res.json({ meanings: [] });
    }
});

module.exports = router;
