/**
 * Natural voice for the AI advice: Gemini text-to-speech (GEMINI_TTS_MODEL,
 * voice GEMINI_TTS_VOICE) turned into a WAV the browser can play.
 *
 * Gemini returns raw 16-bit PCM (24 kHz mono); we add the WAV header. Every
 * spoken text is cached in memory (LRU), so replaying the same advice costs
 * nothing. Uses GEMINI_API_KEY from the backend only; the key is never logged.
 */
import { createHash } from 'node:crypto';
import { classifyGeminiError, createGeminiClient } from './advisor.js';

const MAX_CACHE = 40;
const COOLDOWN_MS = 60_000; // after Gemini says 429, wait before asking again
// How the voice should sound: a calm field advisor, not a news reader
const STYLE = {
  en: 'Read this aloud in a warm, calm and clear voice, like an experienced agronomist kindly advising a farmer. Speak at an easy pace:',
  kn: 'ಇದನ್ನು ಅನುಭವಿ ಕೃಷಿ ತಜ್ಞರು ರೈತರಿಗೆ ಸಲಹೆ ನೀಡುವಂತೆ, ಆತ್ಮೀಯ, ಶಾಂತ ಮತ್ತು ಸ್ಪಷ್ಟ ಧ್ವನಿಯಲ್ಲಿ ಕನ್ನಡದಲ್ಲಿ ಓದಿ:',
};

/** 16-bit mono PCM -> WAV file. */
export function pcmToWav(pcm, sampleRate = 24_000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const rateOf = (mime) => Number(/rate=(\d+)/i.exec(mime ?? '')?.[1]) || 24_000;

/**
 * @param {{config, client?, logger?}} deps  `client` is a GoogleGenAI-shaped fake in tests
 */
export function createVoice({ config, client, logger }) {
  const g = config.gemini;
  const v = config.voice;
  const configured = Boolean(g.apiKey || client);
  const cache = new Map(); // key -> {wav, at}
  let sdk = client ?? null;
  let coolUntil = 0;

  return {
    describe: () => ({ state: configured ? 'configured' : 'not_configured', provider: configured ? 'gemini' : null, model: configured ? v.model : null, voice: configured ? v.voice : null }),

    /** @returns {Promise<{ok: true, wav: Buffer, cached: boolean} | {ok: false, code, message}>} */
    async speak({ text, lang = 'en' }) {
      if (!configured) return { ok: false, code: 'not_configured', message: 'Add GEMINI_API_KEY to backend/.env for the natural voice' };
      const key = createHash('sha1').update(`${v.model}|${v.voice}|${lang}|${text}`).digest('hex');
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key); // refresh LRU position
        cache.set(key, hit);
        return { ok: true, wav: hit, cached: true };
      }
      if (Date.now() < coolUntil) {
        return { ok: false, code: 'rate_limited', message: 'Voice quota reached - try again in a minute', retryAfter: Math.ceil((coolUntil - Date.now()) / 1000) };
      }
      try {
        sdk ??= await createGeminiClient(g);
        const res = await sdk.models.generateContent({
          model: v.model,
          contents: [{ role: 'user', parts: [{ text: `${STYLE[lang] ?? STYLE.en}\n\n${text}` }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.voice } } },
          },
        });
        const part = res?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part) return { ok: false, code: 'no_audio', message: 'Gemini returned no audio' };
        const pcm = Buffer.from(part.inlineData.data, 'base64');
        const wav = /wav/i.test(part.inlineData.mimeType ?? '') ? pcm : pcmToWav(pcm, rateOf(part.inlineData.mimeType));
        cache.set(key, wav);
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
        return { ok: true, wav, cached: false };
      } catch (err) {
        const e = classifyGeminiError(err);
        if (e.code === 'rate_limited') coolUntil = Date.now() + COOLDOWN_MS;
        logger?.warn('voice_failed', { code: e.code });
        return { ok: false, code: e.code, message: e.message };
      }
    },
  };
}
