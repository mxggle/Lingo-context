const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
    const { word, lang } = req.query;
    if (!word) return res.status(400).json({ error: 'word required' });

    try {
        if (lang === 'ja') {
            const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`;
            const r = await fetch(url, { headers: { 'User-Agent': 'LingoContext/1.0' } });
            if (!r.ok) return res.json({ definitions: [] });

            const jishoData = await r.json();
            const entries = jishoData.data?.slice(0, 3) || [];

            const definitions = entries.map(entry => {
                const reading = entry.japanese?.[0]?.reading || null;
                const meanings = entry.senses
                    ?.slice(0, 3)
                    .flatMap(s => s.english_definitions?.slice(0, 2) || []) || [];
                return { reading, meanings };
            }).filter(d => d.meanings.length > 0);

            return res.json({ definitions });
        }

        if (lang === 'en') {
            const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
            const r = await fetch(url, { headers: { 'User-Agent': 'LingoContext/1.0' } });
            if (!r.ok) return res.json({ definitions: [] });

            const data = await r.json();
            const entry = Array.isArray(data) ? data[0] : null;
            if (!entry) return res.json({ definitions: [] });

            const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || null;
            const definitions = entry.meanings?.slice(0, 3).map(meaning => ({
                reading: phonetic,
                partOfSpeech: meaning.partOfSpeech || null,
                meanings: meaning.definitions?.slice(0, 3).map(d => d.definition) || []
            })).filter(d => d.meanings.length > 0) || [];

            return res.json({ definitions });
        }

        res.json({ definitions: [] });
    } catch (e) {
        res.json({ definitions: [] });
    }
});

module.exports = router;
