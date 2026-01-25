
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function reproduce() {
    try {
        const response = await fetch('http://localhost:3000/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: "AP通信",
                context: "AP通信などによりますと",
                mode: "word"
            })
        });
        const data = await response.json();
        console.log('Furigana Response:', data.furigana);
        console.log('Full Data:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error:', err);
    }
}

reproduce();
