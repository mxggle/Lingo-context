const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Best Neural voice per language
const VOICE_MAP = {
  'en': 'en-US-AriaNeural',
  'ja': 'ja-JP-NanamiNeural',
  'zh': 'zh-CN-XiaoxiaoNeural',
  'ko': 'ko-KR-SunHiNeural',
  'fr': 'fr-FR-DeniseNeural',
  'de': 'de-DE-KatjaNeural',
  'es': 'es-ES-ElviraNeural',
  'pt': 'pt-BR-FranciscaNeural',
  'ru': 'ru-RU-SvetlanaNeural',
  'ar': 'ar-SA-ZariyahNeural',
  'it': 'it-IT-ElsaNeural',
  'nl': 'nl-NL-ColetteNeural',
  'tr': 'tr-TR-EmelNeural',
  'pl': 'pl-PL-AgnieszkaNeural',
  'vi': 'vi-VN-HoaiMyNeural',
  'th': 'th-TH-PremwadeeNeural',
};

async function synthesize(text, lang = 'en') {
  const voice = VOICE_MAP[lang] || VOICE_MAP['en'];
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = await tts.toStream(text);
  return new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data', chunk => chunks.push(chunk));
    audioStream.on('end', () => {
      tts.close();
      resolve(Buffer.concat(chunks));
    });
    audioStream.on('error', err => {
      tts.close();
      reject(err);
    });
    setTimeout(() => {
      tts.close();
      chunks.length > 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Edge TTS timeout'));
    }, 10000);
  });
}

module.exports = { synthesize };
