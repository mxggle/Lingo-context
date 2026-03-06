// Create Gemini cached content for system instruction
// Run once to generate a cached content ID, then save it to .env

require('dotenv').config();

const SYSTEM_INSTRUCTION = `You are a language learning assistant. Analyze the given text and provide:
1. Source language detection
2. Difficulty level assessment
3. Key vocabulary and grammar points
4. Cultural context when relevant`;

async function createCachedContent() {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY not set');
        process.exit(1);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}/cachedContents?key=${apiKey}`;

    const body = {
        model: `models/${model}`,
        contents: [{
            role: 'user',
            parts: [{ text: SYSTEM_INSTRUCTION }]
        }],
        ttl: '3600s' // Cache for 1 hour
    };

    console.log('Creating cached content...');
    console.log('Model:', model);
    console.log('TTL: 3600s (1 hour)');

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('Failed to create cached content:', error);
        process.exit(1);
    }

    const data = await response.json();
    const cachedContentName = data.name;

    console.log('\n✓ Cached content created successfully!');
    console.log('\nAdd this to your .env file:');
    console.log(`GEMINI_CACHED_CONTENT_NAME=${cachedContentName}`);
    console.log(`GEMINI_ENABLE_CACHE=true`);
    console.log('\nNote: Cached content expires after 1 hour. Re-run this script to refresh.');
}

createCachedContent().catch(console.error);
