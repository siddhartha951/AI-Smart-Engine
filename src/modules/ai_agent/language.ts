/**
 * Reply-language policy for the merchant AI agent.
 *
 * Default is professional English. The agent only switches to Hindi/Hinglish
 * after the merchant has written HINDI_SWITCH_THRESHOLD consecutive messages in
 * Hindi (Devanagari) or Hinglish, and switches back the moment they write English.
 */

export type ReplyLanguage = 'english' | 'hinglish' | 'hindi';

export const HINDI_SWITCH_THRESHOLD = 3;

// Romanised Hindi words that do not collide with common English words
const HINGLISH_MARKERS = new Set([
  'hai', 'hain', 'kya', 'kaise', 'kaisa', 'kaisi', 'kitna', 'kitne', 'kitni', 'mera', 'meri', 'mere',
  'mujhe', 'humko', 'hume', 'hamara', 'hamari', 'batao', 'bataye', 'bataiye', 'dikhao', 'dikhaye',
  'karo', 'karna', 'karni', 'karke', 'kar', 'kr', 'krna', 'raha', 'rahi', 'rahe', 'nahi', 'nahin', 'nhi',
  'aur', 'bhi', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'kab', 'kyu', 'kyun', 'kyon', 'abhi', 'aaj',
  'pichle', 'pichla', 'hafte', 'mahine', 'wala', 'wali', 'wale', 'chahiye', 'kaun', 'kaunsa', 'kaunsi',
  'yeh', 'ye', 'woh', 'vo', 'kuch', 'sab', 'bahut', 'bohot', 'thoda', 'accha', 'acha', 'theek', 'thik',
  'haan', 'ji', 'bhai', 'samjhao', 'dekho', 'dekh', 'hua', 'hui', 'hue', 'gaya', 'gayi', 'tha', 'thi',
]);

export function classifyMessageLanguage(text: string): ReplyLanguage {
  const value = (text || '').trim();
  if (!value) return 'english';

  const devanagari = (value.match(/[ऀ-ॿ]/g) || []).length;
  const letters = (value.match(/[A-Za-zऀ-ॿ]/g) || []).length;
  if (letters > 0 && devanagari / letters >= 0.3) return 'hindi';

  const words = value.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length === 0) return 'english';
  const markers = words.filter(w => HINGLISH_MARKERS.has(w)).length;
  // A single casual word ("acha", "ji") is not enough to call a message Hinglish
  if (markers >= 2 && markers / words.length >= 0.2) return 'hinglish';
  return 'english';
}

/**
 * Decides the reply language from the merchant's messages (oldest → newest,
 * the last one being the message being answered).
 */
export function decideReplyLanguage(userMessages: string[]): ReplyLanguage {
  if (userMessages.length === 0) return 'english';
  const latest = classifyMessageLanguage(userMessages[userMessages.length - 1]);
  if (latest === 'english') return 'english';

  let streak = 0;
  for (let i = userMessages.length - 1; i >= 0; i--) {
    if (classifyMessageLanguage(userMessages[i]) === 'english') break;
    streak++;
  }
  if (streak < HINDI_SWITCH_THRESHOLD) return 'english';
  // Mirror the script of the latest message
  return latest;
}

export function languageInstruction(language: ReplyLanguage): string {
  if (language === 'hindi') {
    return 'REPLY LANGUAGE: The merchant has been writing in Hindi. Reply in clear, professional Hindi (Devanagari). Keep metric names, currency and product names as they appear in the data.';
  }
  if (language === 'hinglish') {
    return 'REPLY LANGUAGE: The merchant has been writing in Hinglish for several messages. Reply in natural, professional Hinglish (Roman script). Keep metric names in English.';
  }
  return 'REPLY LANGUAGE: Reply in clear, professional, executive-level English, even if the message contains an occasional Hindi word.';
}
