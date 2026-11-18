/**
 * Model Router (spec R11.1, ADR 0015): the small model only decides whether a question is off-topic
 * (weather, coding, maths, chit-chat); those get one fixed polite sentence that no model writes. Every question about the place goes
 * to the big model. The small model never answers place questions and never summarises documents for the big one
 * (the prototype showed both make things up). Walk/gesture commands are caught earlier by the rule-based parser,
 * and repeated questions by the answer cache.
 */
import { createChat } from './companion/chat.mjs';

export const DEFAULT_ROUTER_MODEL = 'scb10x/llama3.2-typhoon2-3b-instruct';

const LABEL = 'Label a visitor message in a heritage-park tour app. Reply JSON {"type": "place"|"offtopic"}.\n'
  + 'place = anything about the park, its buildings, history, people, services or facilities (toilets, tickets, parking, food count as place), or a greeting.\n'
  + 'offtopic = clearly unrelated to the park (weather forecast, coding, maths, news, other places).';

const OFFTOPIC = {
  th: 'ผมช่วยได้เฉพาะเรื่องในอุทยานนี้ครับ ลองถามเรื่องเรือน ศาลา หรือประวัติของที่นี่ได้เลยครับ',
  en: 'I can only help with this park. Try asking about its houses, pavilions or history.'
};

/** null when ROUTER_SMALL_MODEL=off: then the big model answers off-topic questions itself. */
export function createRouter({ model = process.env.ROUTER_SMALL_MODEL ?? DEFAULT_ROUTER_MODEL, small } = {}) {
  if (!small && String(model).toLowerCase() === 'off') return null;
  small ??= createChat({ model, timeoutMs: 10_000 });
  return {
    model: small.model,
    /** true only when the small model clearly says off-topic; any failure counts as a place question. */
    async isOfftopic(question) {
      try {
        const raw = await small.chat([{ role: 'system', content: LABEL }, { role: 'user', content: question }], { json: true, maxTokens: 20 });
        // Read the label itself: the model sometimes adds fields, and the token limit can cut the JSON off.
        return /"type"\s*:\s*"offtopic"/.test(raw);
      } catch { return false; }
    },
    /** A fixed sentence: in testing the small model's own "polite reply" made up today's weather. */
    offtopicReply: async (question, lang = 'th') => OFFTOPIC[lang === 'en' ? 'en' : 'th']
  };
}
