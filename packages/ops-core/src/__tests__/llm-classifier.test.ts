import { LLMIntentClassifier } from '../llm-classifier';
import type { LLMClassificationResult } from '../llm-classifier';
import { IntentClassifier } from '../intent';

// ── Global fetch mock ────────────────────────────────────────────────────────

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Save and restore env vars across tests. */
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

/** Create a mock Anthropic API response. */
function anthropicResponse(intent: string) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: intent }],
    }),
  };
}

/** Create a mock OpenAI API response. */
function openaiResponse(intent: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: intent } }],
    }),
  };
}

/** Create a mock Ollama API response. */
function ollamaResponse(intent: string) {
  return {
    ok: true,
    json: async () => ({
      message: { content: intent },
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LLMIntentClassifier', () => {
  describe('classify() — no LLM provider', () => {
    it('returns heuristic result when OPS_LLM_PROVIDER is not set', async () => {
      delete process.env.OPS_LLM_PROVIDER;
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classify('Please reply to John');
      expect(result).toBe('reply');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns heuristic result when OPS_LLM_PROVIDER is an invalid value', async () => {
      process.env.OPS_LLM_PROVIDER = 'grok';
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classify('Please reply to John');
      expect(result).toBe('reply');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('classify() — high-confidence heuristic short-circuit', () => {
    it('returns heuristic result without LLM call when confidence is high', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      // Two keywords: 'reply' and 'respond' both match 'reply' intent => high confidence
      const result = await classifier.classify('Please reply and respond to the message');
      expect(result).toBe('reply');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns heuristic result without LLM call for multiple escalation keywords', async () => {
      process.env.OPS_LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classify('URGENT! Please help me escalate this');
      expect(result).toBe('escalate');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('classify() — Anthropic provider', () => {
    it('calls Anthropic API when provider is anthropic and confidence is low', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(anthropicResponse('schedule'));

      // Only one keyword matches => low confidence => triggers LLM
      const result = await classifier.classify('book a room');
      expect(result).toBe('schedule');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(opts.method).toBe('POST');
      expect(opts.headers['x-api-key']).toBe('sk-test-key');
    });

    it('sends the correct request body to Anthropic', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(anthropicResponse('reply'));

      await classifier.classify('some ambiguous text');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.max_tokens).toBe(32);
      expect(body.messages[0].content).toContain('some ambiguous text');
    });
  });

  describe('classify() — OpenAI provider', () => {
    it('calls OpenAI API when provider is openai', async () => {
      process.env.OPS_LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(openaiResponse('post'));

      const result = await classifier.classify('share this on social');
      expect(result).toBe('post');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(opts.headers['Authorization']).toBe('Bearer sk-openai-key');
    });

    it('sends the correct request body to OpenAI', async () => {
      process.env.OPS_LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(openaiResponse('reply'));

      await classifier.classify('something vague');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.max_tokens).toBe(32);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
    });
  });

  describe('classify() — Ollama provider', () => {
    it('calls Ollama API when provider is ollama', async () => {
      process.env.OPS_LLM_PROVIDER = 'ollama';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(ollamaResponse('fulfill'));

      // Use only one keyword ('deliver') so confidence is 'low' and LLM is called
      const result = await classifier.classify('deliver the goods');
      expect(result).toBe('fulfill');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
    });

    it('uses custom OLLAMA_URL when set', async () => {
      process.env.OPS_LLM_PROVIDER = 'ollama';
      process.env.OLLAMA_URL = 'http://my-server:11434';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(ollamaResponse('reply'));

      await classifier.classify('answer the question');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://my-server:11434/api/chat');
    });

    it('does not require an API key for Ollama', async () => {
      process.env.OPS_LLM_PROVIDER = 'ollama';
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(ollamaResponse('ignore'));

      const result = await classifier.classify('junk mail');
      expect(result).toBe('ignore');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('classify() — fallback on LLM failure', () => {
    it('falls back to heuristic when the LLM API returns a non-ok response', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // 'ship' is a single keyword match for 'fulfill' => low confidence => tries LLM => fails => heuristic
      const result = await classifier.classify('ship the package');
      expect(result).toBe('fulfill');
    });

    it('falls back to heuristic when fetch throws a network error', async () => {
      process.env.OPS_LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await classifier.classify('post something');
      expect(result).toBe('post');
    });
  });

  describe('classify() — fallback when API key is missing', () => {
    it('falls back to heuristic when Anthropic API key is not set', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      delete process.env.ANTHROPIC_API_KEY;
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classify('reply to this email');
      expect(result).toBe('reply');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to heuristic when OpenAI API key is not set', async () => {
      process.env.OPS_LLM_PROVIDER = 'openai';
      delete process.env.OPENAI_API_KEY;
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classify('schedule a meeting');
      expect(result).toBe('schedule');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('classifyDetailed() — method metadata', () => {
    it('returns method=heuristic when no LLM is configured', async () => {
      delete process.env.OPS_LLM_PROVIDER;
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classifyDetailed('reply to John');
      expect(result.method).toBe('heuristic');
      expect(result.intent).toBe('reply');
      expect(result.provider).toBeUndefined();
      expect(result.model).toBeUndefined();
    });

    it('returns method=heuristic when heuristic confidence is high', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classifyDetailed(
        'URGENT! Help me now, this is an emergency',
      );
      expect(result.method).toBe('heuristic');
      expect(result.intent).toBe('escalate');
      expect(result.confidence).toBe('high');
    });

    it('returns method=llm with provider and model when LLM is used', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(anthropicResponse('reply'));

      const result = await classifier.classifyDetailed('some text that is ambiguous');
      expect(result.method).toBe('llm');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4-5-20251001');
    });

    it('returns method=llm with openai provider when OpenAI is used', async () => {
      process.env.OPS_LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(openaiResponse('schedule'));

      const result = await classifier.classifyDetailed('plan something for next week');
      expect(result.method).toBe('llm');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
    });

    it('returns method=heuristic when LLM call fails', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockRejectedValueOnce(new Error('API down'));

      const result = await classifier.classifyDetailed('deliver the order');
      expect(result.method).toBe('heuristic');
      expect(result.intent).toBe('fulfill');
    });
  });

  describe('Intent parsing — various LLM response formats', () => {
    beforeEach(() => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    });

    it('parses a clean single-word response: "reply"', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('reply'));

      const result = await classifier.classify('some text');
      expect(result).toBe('reply');
    });

    it('parses a response with trailing period: "Reply."', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('Reply.'));

      const result = await classifier.classify('some text');
      expect(result).toBe('reply');
    });

    it('parses a response with surrounding text: "The intent is: reply"', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('The intent is: reply'));

      const result = await classifier.classify('some text');
      expect(result).toBe('reply');
    });

    it('parses a response with extra whitespace', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('  schedule  '));

      const result = await classifier.classify('some text');
      expect(result).toBe('schedule');
    });

    it('parses a response with mixed case: "ESCALATE"', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('ESCALATE'));

      const result = await classifier.classify('some text');
      expect(result).toBe('escalate');
    });

    it('returns unknown for an unrecognizable response', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('I am not sure what to do'));

      const result = await classifier.classify('some text');
      expect(result).toBe('unknown');
    });

    it('returns low confidence when LLM result is unknown', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('gibberish'));

      const detailed = await classifier.classifyDetailed('some text');
      expect(detailed.intent).toBe('unknown');
      expect(detailed.confidence).toBe('low');
    });

    it('returns high confidence when LLM result is a valid intent', async () => {
      const classifier = new LLMIntentClassifier();
      mockFetch.mockResolvedValueOnce(anthropicResponse('post'));

      const detailed = await classifier.classifyDetailed('some text');
      expect(detailed.intent).toBe('post');
      expect(detailed.confidence).toBe('high');
    });
  });

  describe('constructor — custom heuristic', () => {
    it('accepts a custom IntentClassifier instance', async () => {
      delete process.env.OPS_LLM_PROVIDER;
      const customHeuristic = new IntentClassifier([
        { intent: 'reply', keywords: ['custom-keyword'] },
      ]);
      const classifier = new LLMIntentClassifier(customHeuristic);

      const result = await classifier.classify('this has a custom-keyword');
      expect(result).toBe('reply');
    });
  });

  describe('classify() — no keyword matches (unknown from heuristic)', () => {
    it('returns unknown without LLM call when no provider is configured', async () => {
      delete process.env.OPS_LLM_PROVIDER;
      const classifier = new LLMIntentClassifier();

      const result = await classifier.classify('completely unrelated text about nothing');
      expect(result).toBe('unknown');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls LLM when heuristic returns unknown and provider is configured', async () => {
      process.env.OPS_LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const classifier = new LLMIntentClassifier();

      mockFetch.mockResolvedValueOnce(anthropicResponse('fulfill'));

      const result = await classifier.classify('completely unrelated text about nothing');
      expect(result).toBe('fulfill');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
