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

// Split a kuromoji token into ruby HTML by aligning the reading to each kanji run.
// e.g. "食べ物" + "たべもの" → <ruby>食<rt>た</rt></ruby>べ<ruby>物<rt>もの</rt></ruby>
// e.g. "推し" + "おし" → <ruby>推<rt>お</rt></ruby>し
// e.g. "発表" + "はっぴょう" → <ruby>発表<rt>はっぴょう</rt></ruby>
// For complex mixed tokens (katakana/ASCII after kanji), only annotates the leading kanji.
function tokenToRuby(surface, reading) {
    if (!/[一-鿿]/.test(surface)) return surface;

    let html = '';
    let readingPos = 0;
    let i = 0;

    while (i < surface.length) {
        if (/[一-鿿]/.test(surface[i])) {
            // Collect consecutive kanji
            const kanjiStart = i;
            while (i < surface.length && /[一-鿿]/.test(surface[i])) i++;
            const kanjiPart = surface.slice(kanjiStart, i);

            // Collect trailing hiragana immediately after the kanji run
            let kanaAfter = '';
            let j = i;
            while (j < surface.length && /[ぁ-ゖ]/.test(surface[j])) {
                kanaAfter += surface[j++];
            }

            const remaining = reading.slice(readingPos);

            if (kanaAfter) {
                // Find where kanaAfter first appears in remaining reading, starting at pos 1
                // so the kanji always gets at least one mora.
                const matchIdx = remaining.indexOf(kanaAfter, 1);
                if (matchIdx > 0) {
                    html += `<ruby>${kanjiPart}<rt>${remaining.slice(0, matchIdx)}</rt></ruby>`;
                    html += kanaAfter;
                    readingPos += matchIdx + kanaAfter.length;
                    i = j;
                } else {
                    // Can't split cleanly – wrap kanji+kana together as fallback
                    html += `<ruby>${kanjiPart}${kanaAfter}<rt>${remaining}</rt></ruby>`;
                    readingPos = reading.length;
                    i = j;
                }
            } else {
                // Nothing (or non-hiragana) follows this kanji run: give it all remaining reading
                html += `<ruby>${kanjiPart}<rt>${remaining}</rt></ruby>`;
                readingPos = reading.length;
            }
        } else {
            // Non-kanji character: pass through and advance reading position for hiragana
            const ch = surface[i++];
            html += ch;
            if (/[ぁ-ゖ]/.test(ch) && readingPos < reading.length && reading[readingPos] === ch) {
                readingPos++;
            }
        }
    }

    return html;
}

function generateFurigana(text) {
    if (!tokenizer) return text;
    const tokens = tokenizer.tokenize(text);
    return tokens.map(token => {
        const { surface_form, reading } = token;
        if (!reading || reading === '*' || reading === surface_form) return surface_form;
        if (!/[一-鿿]/.test(surface_form)) return surface_form;
        return tokenToRuby(surface_form, katakanaToHiragana(reading));
    }).join('');
}

module.exports = { generateFurigana };
