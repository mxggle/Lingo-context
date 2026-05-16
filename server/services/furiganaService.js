const path = require('path');
const kuromoji = require('kuromoji');

let tokenizer = null;

const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
kuromoji.builder({ dicPath }).build((err, t) => {
    if (err) {
        console.error('kuromoji init failed:', err.message);
    } else {
        tokenizer = t;
        console.log('kuromoji tokenizer ready');
    }
});

function katakanaToHiragana(str) {
    return str.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function generateFurigana(text) {
    if (!tokenizer) return text;
    const tokens = tokenizer.tokenize(text);
    return tokens.map(token => {
        const { surface_form, reading } = token;
        if (reading && reading !== '*' && reading !== surface_form && /[一-鿿]/.test(surface_form)) {
            return `<ruby>${surface_form}<rt>${katakanaToHiragana(reading)}</rt></ruby>`;
        }
        return surface_form;
    }).join('');
}

module.exports = { generateFurigana };
