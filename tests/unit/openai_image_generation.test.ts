import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAiProvider } from '../../src/providers/ai/openai.provider';
import { resetEnvConfig } from '../../src/config/env';
import type { AdImageContext } from '../../src/providers/ai/ai.provider';

function makeContext(): AdImageContext {
  return {
    product: { id: 'prod_1', title: 'Wireless Earbuds', category: 'Electronics' },
    platform: 'facebook',
    style: 'commercial_studio',
  };
}

describe('OpenAiProvider.generateAdImage', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-dummy-key';
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    resetEnvConfig();
    vi.restoreAllMocks();
  });

  it('accepts b64_json responses from gpt-image models (no hosted URL)', async () => {
    const provider = new OpenAiProvider();
    const fakeB64 = Buffer.from('fake-png-bytes').toString('base64');
    vi.spyOn((provider as any).openai.images, 'generate').mockResolvedValue({
      data: [{ b64_json: fakeB64 }],
    } as any);

    const result = await provider.generateAdImage(makeContext());

    expect(result.image_url).toBe(`data:image/png;base64,${fakeB64}`);
    expect(result.model).toBe('gpt-image-1.5');
  });

  it('still accepts hosted url responses from dall-e style models', async () => {
    const provider = new OpenAiProvider();
    const generate = vi.spyOn((provider as any).openai.images, 'generate');
    // gpt-image-1.5 and gpt-image-1 do not exist in this stub -> 404-style error
    generate
      .mockRejectedValueOnce(Object.assign(new Error('The model `gpt-image-1.5` does not exist'), { code: 'invalid_value' }))
      .mockRejectedValueOnce(Object.assign(new Error('The model `gpt-image-1` does not exist'), { code: 'invalid_value' }))
      .mockResolvedValueOnce({ data: [{ url: 'https://example.com/img.png' }] } as any);

    const result = await provider.generateAdImage(makeContext());

    expect(result.image_url).toBe('https://example.com/img.png');
    expect(result.model).toBe('dall-e-3');
  });

  it('throws an honest error when every provider fails (no silent broken image)', async () => {
    const provider = new OpenAiProvider();
    vi.spyOn((provider as any).openai.images, 'generate').mockRejectedValue(
      Object.assign(new Error('insufficient_quota: you exceeded your current quota'), { status: 429 })
    );
    // Pollinations verification fails too
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(provider.generateAdImage(makeContext())).rejects.toThrow(
      'All AI image providers failed'
    );
  }, 30000);
});
