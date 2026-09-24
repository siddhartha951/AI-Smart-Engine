import { describe, it, expect } from 'vitest';
import {
  classifyMessageLanguage,
  decideReplyLanguage,
  languageInstruction,
} from '../../src/modules/ai_agent/language';

describe('merchant agent reply language', () => {
  it('classifies English, Hinglish and Devanagari messages', () => {
    expect(classifyMessageLanguage('What was my revenue last week?')).toBe('english');
    expect(classifyMessageLanguage('pichle hafte ka revenue kitna hai')).toBe('hinglish');
    expect(classifyMessageLanguage('मेरी सेल कितनी हुई?')).toBe('hindi');
  });

  it('does not treat a single casual Hindi word as Hinglish', () => {
    expect(classifyMessageLanguage('acha, show me the top campaigns')).toBe('english');
  });

  it('stays in English until the merchant writes 3 consecutive Hindi/Hinglish messages', () => {
    expect(decideReplyLanguage(['Show sales'])).toBe('english');
    expect(decideReplyLanguage(['Show sales', 'kitna revenue hua hai'])).toBe('english');
    expect(decideReplyLanguage(['kitna revenue hua hai', 'ads ka roas kya hai'])).toBe('english');
    expect(decideReplyLanguage(['kitna revenue hua hai', 'ads ka roas kya hai', 'mujhe top products batao'])).toBe('hinglish');
  });

  it('mirrors Devanagari once the streak is reached', () => {
    expect(decideReplyLanguage(['kitna revenue hua hai', 'ads ka roas kya hai', 'मेरी सेल कितनी हुई?'])).toBe('hindi');
  });

  it('switches straight back to English when the merchant does', () => {
    const history = ['kitna revenue hua hai', 'ads ka roas kya hai', 'mujhe top products batao', 'Now show me refunds for September'];
    expect(decideReplyLanguage(history)).toBe('english');
  });

  it('produces an explicit instruction for each language', () => {
    expect(languageInstruction('english')).toMatch(/professional, executive-level English/);
    expect(languageInstruction('hinglish')).toMatch(/Hinglish/);
    expect(languageInstruction('hindi')).toMatch(/Devanagari/);
  });
});
