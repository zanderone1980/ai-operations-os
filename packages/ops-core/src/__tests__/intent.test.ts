import { IntentClassifier } from '../intent';

describe('IntentClassifier', () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier();
  });

  describe('classify', () => {
    it('classifies "please reply to this email" as reply', () => {
      expect(classifier.classify('please reply to this email')).toBe('reply');
    });

    it('classifies "respond to the customer" as reply', () => {
      expect(classifier.classify('respond to the customer')).toBe('reply');
    });

    it('classifies "schedule a meeting for Monday" as schedule', () => {
      expect(classifier.classify('schedule a meeting for Monday')).toBe('schedule');
    });

    it('classifies "book an appointment" as schedule', () => {
      expect(classifier.classify('book an appointment')).toBe('schedule');
    });

    it('classifies "post this to Twitter" as post', () => {
      expect(classifier.classify('post this to Twitter')).toBe('post');
    });

    it('classifies "publish the blog article" as post', () => {
      expect(classifier.classify('publish the blog article')).toBe('post');
    });

    it('classifies "ship the order" as fulfill', () => {
      expect(classifier.classify('ship the order')).toBe('fulfill');
    });

    it('classifies "process the delivery" as fulfill', () => {
      expect(classifier.classify('process the delivery')).toBe('fulfill');
    });

    it('classifies "this is spam" as ignore', () => {
      expect(classifier.classify('this is spam')).toBe('ignore');
    });

    it('classifies "unsubscribe from newsletter" as ignore', () => {
      expect(classifier.classify('unsubscribe from newsletter')).toBe('ignore');
    });

    it('classifies "urgent help needed" as escalate', () => {
      expect(classifier.classify('urgent help needed')).toBe('escalate');
    });

    it('classifies "escalate to manager" as escalate', () => {
      expect(classifier.classify('escalate to manager')).toBe('escalate');
    });

    it('returns unknown for unrecognized text', () => {
      expect(classifier.classify('the weather is nice today')).toBe('unknown');
    });

    it('is case-insensitive', () => {
      expect(classifier.classify('PLEASE REPLY NOW')).toBe('reply');
      expect(classifier.classify('SCHEDULE A MEETING')).toBe('schedule');
      expect(classifier.classify('This Is SPAM')).toBe('ignore');
    });

    it('handles empty string as unknown', () => {
      expect(classifier.classify('')).toBe('unknown');
    });
  });

  describe('classifyDetailed', () => {
    it('returns high confidence when multiple keywords match', () => {
      const result = classifier.classifyDetailed('urgent emergency help');
      expect(result.intent).toBe('escalate');
      expect(result.confidence).toBe('high');
      expect(result.matchedKeywords.length).toBeGreaterThanOrEqual(2);
    });

    it('returns low confidence for a single keyword match', () => {
      const result = classifier.classifyDetailed('please reply');
      expect(result.intent).toBe('reply');
      expect(result.confidence).toBe('low');
      expect(result.matchedKeywords).toEqual(['reply']);
    });

    it('returns none confidence for unknown intent', () => {
      const result = classifier.classifyDetailed('random gibberish');
      expect(result.intent).toBe('unknown');
      expect(result.confidence).toBe('none');
      expect(result.matchedKeywords).toEqual([]);
    });

    it('matches "get back to" as a multi-word keyword', () => {
      const result = classifier.classifyDetailed('get back to the client about pricing');
      expect(result.intent).toBe('reply');
      expect(result.matchedKeywords).toContain('get back to');
    });

    it('returns the first matching intent when text matches multiple intents', () => {
      // "urgent" maps to escalate (first in priority), "reply" maps to reply
      // escalate has higher priority in the keyword table
      const result = classifier.classifyDetailed('urgent reply needed');
      expect(result.intent).toBe('escalate');
    });
  });

  describe('custom keyword table', () => {
    it('uses custom keywords when provided', () => {
      const custom = new IntentClassifier([
        { intent: 'reply', keywords: ['custom-keyword'] },
      ]);

      expect(custom.classify('use the custom-keyword')).toBe('reply');
      expect(custom.classify('reply to this')).toBe('unknown'); // not in custom table
    });
  });
});
