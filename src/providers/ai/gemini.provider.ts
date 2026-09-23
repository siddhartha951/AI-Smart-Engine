import { z } from 'zod';
import {
  AdCreativeContext,
  AdCreativeGenerationResult,
  AdCreativeVariation,
  AdImageContext,
  AdImageGenerationResult,
  AiRequestContext,
  AiResponse,
  ChatMessage,
  IAiProvider,
  StructuredAiOptions,
  StructuredAiResult,
  TextAiResult,
} from './ai.provider';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';
import { MockAiProvider } from './mock.ai.provider';
import { extractAndParseJson } from './ai.utils';

export class GeminiAiProvider implements IAiProvider {
  private apiKey: string;
  private model: string;
  private mockFallback: MockAiProvider;

  constructor() {
    const env = getEnvConfig();
    this.apiKey = env.GEMINI_API_KEY || (process.env.GOOGLE_AI_API_KEY ?? '');
    this.model = env.GEMINI_MODEL || 'gemini-2.0-flash';
    this.mockFallback = new MockAiProvider();
  }

  private getEndpoint(model: string = this.model, method: string = 'generateContent'): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${this.apiKey}`;
  }

  async generateResponse(
    chatHistory: ChatMessage[],
    context: AiRequestContext
  ): Promise<AiResponse> {
    if (!this.apiKey) {
      const env = getEnvConfig();
      if (env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'mock') {
        logger.warn('GeminiAiProvider: No GEMINI_API_KEY found, falling back to OpenAI provider');
        const { OpenAiProvider } = await import('./openai.provider');
        const openAi = new OpenAiProvider();
        return openAi.generateResponse(chatHistory, context);
      }
      logger.warn('GeminiAiProvider: No GEMINI_API_KEY found, falling back to mock provider');
      return this.mockFallback.generateResponse(chatHistory, context);
    }

    const customPromptSection = context.assistantSettings.custom_prompt?.trim()
      ? `\nMerchant Persona & Custom Instructions:\n${context.assistantSettings.custom_prompt.trim()}\n`
      : '';

    const knowledgeBaseSection = context.assistantSettings.knowledge_base?.trim()
      ? `\nStore Knowledge Base & Training Material:\n${context.assistantSettings.knowledge_base.trim()}\n`
      : '';

    const quickLinks = (context.assistantSettings.quick_action_pills || []).filter(p => p.enabled !== false && (p.url || p.image_url));
    const quickLinksSection = quickLinks.length > 0
      ? `\nStore Quick Navigation & Action Links:\n${quickLinks.map(p => `- ${p.label}: ${p.url || p.image_url}`).join('\n')}\n`
      : '';

    const catalogSummary = (context.catalogSubset || []).map(p => ({
      id: p.id,
      title: p.title,
      price: p.price,
      currency: p.currency || 'INR',
      category: p.category || '',
      is_bestseller: p.is_bestseller || false,
      tags: p.tags || [],
      key_benefits_or_description: p.description ? p.description.slice(0, 350) : '',
    }));

    const systemPrompt = `
You are "${context.assistantSettings.assistant_name}", an intelligent shopping assistant for this Shopify store.
Your goal is to help customers find products, answer questions, and provide a delightful shopping experience.
${customPromptSection}
${knowledgeBaseSection}
${quickLinksSection}
Strict Guidelines:
1. ONLY recommend products from the "Available Catalog Subset" provided below.
2. NEVER invent or hallucinate products, prices, or inventory.
3. If the user asks for products not in the subset, politely explain what is currently in stock or suggest closest alternative.
4. Allowed topics: ${context.assistantSettings.allowed_topics.join(', ')}.
5. Store Policies:
   - Delivery: ${context.storePolicies.delivery_policy}
   - Returns: ${context.storePolicies.returns_policy}
   - FAQ: ${context.storePolicies.faq_content}
6. If the customer asks about order tracking, returns, shipping, size guides, or human support, provide a helpful answer and share the exact store action link from "Store Quick Navigation & Action Links".

CRITICAL DISPLAY & FORMATTING GUIDELINES:
1. STRUCTURE YOUR ANSWER BEAUTIFULLY:
   - Start with 1 warm, empathetic sentence addressing the customer's specific question or problem.
   - If recommending product(s), explain WHY they help using 2 to 3 concise, clear bullet points (e.g. • Key benefit 1, • Key benefit 2).
   - End with a friendly, short 1-line closing or call-to-action (e.g. "Check out the option below! Let me know if you need help choosing a size or variant.").
2. AVOID REPETITION & BULKY TEXT:
   - DO NOT repeat the entire product title or long product subtitle inside the text (the full title and direct purchase card appear below automatically!).
   - Use clean spacing and line breaks between your greeting, bullet points, and closing.
   - DO NOT output raw markdown image tags or markdown links.
3. BESTSELLERS:
   - If the shopper asks general questions like "what are your best products?" or "recommend something", prioritize items marked with \`is_bestseller: true\`.
4. Respond in JSON format with two fields:
  {
    "message": "Your structured, warm answer here",
    "recommended_product_ids": ["product-id-1", "product-id-2"]
  }
  If no specific products are recommended, provide an empty array [].

Available Catalog Subset (JSON):
${JSON.stringify(catalogSummary, null, 2)}
`.trim();

    const contents = chatHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    try {
      const response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          generationConfig: {
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const json = (await response.json()) as any;
      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const usage = json?.usageMetadata;

      let finalContent = '';
      let recommendedIds: string[] = [];

      try {
        const parsed = extractAndParseJson<{ message?: string; recommended_product_ids?: string[] }>(rawText);
        finalContent = parsed.message || rawText;
        const validIds = new Set(context.catalogSubset.map((p) => p.id));
        recommendedIds = (parsed.recommended_product_ids || []).filter((id) => validIds.has(id));
      } catch (_parseErr) {
        finalContent = rawText;
      }

      const inputTokens = usage?.promptTokenCount || 100;
      const outputTokens = usage?.candidatesTokenCount || 50;
      const costUsd = (inputTokens * 0.10 / 1000000) + (outputTokens * 0.40 / 1000000);

      return {
        content: finalContent,
        recommended_product_ids: recommendedIds,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
      };
    } catch (err: any) {
      logger.warn('GeminiAiProvider.generateResponse failed, attempting OpenAI fallback:', { error: err.message });
      const env = getEnvConfig();
      if (env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'mock') {
        try {
          const { OpenAiProvider } = await import('./openai.provider');
          const openAi = new OpenAiProvider();
          return await openAi.generateResponse(chatHistory, context);
        } catch (openAiErr: any) {
          logger.warn('Gemini fallback to OpenAI also failed:', { error: openAiErr.message });
        }
      }
      return this.mockFallback.generateResponse(chatHistory, context);
    }
  }

  async generateAdCreatives(
    context: AdCreativeContext
  ): Promise<AdCreativeGenerationResult> {
    if (!this.apiKey) {
      logger.warn('GeminiAiProvider: No GEMINI_API_KEY found, falling back to mock provider');
      return this.mockFallback.generateAdCreatives(context);
    }

    const { product, platform, objective } = context;
    const currency = product.currency || 'INR';
    const priceFormatted = `${currency} ${Number(product.price || 0).toFixed(2)}`;
    const platformLabel = platform === 'instagram' ? 'Instagram Feed & Stories' : 'Facebook News Feed';

    const systemPrompt = `
You are an expert direct-response ad copywriter specializing in Meta advertising (${platformLabel}) for e-commerce stores.
Generate 3 high-converting ad creative variations for the selected merchant product.
STRICT ANTI-HALLUCINATION & FACTUAL GROUNDING CONSTRAINTS:
1. ONLY use factual details directly supplied in the product context (title, price, category).
2. DO NOT fabricate false discounts, certifications, or ungrounded guarantees.
3. Output MUST be valid JSON with a "variations" array containing exactly 3 objects:
   - "hook": Catchy first line or pattern interrupt (1 sentence).
   - "primary_text": Compelling body text (2-3 sentences).
   - "headline": Punchy headline under 60 characters.
   - "cta": Call to action button text for objective: ${objective}.
`.trim();

    const userPrompt = `
Product Details:
- Title: ${product.title}
- Category: ${product.category || 'General Merchandise'}
- Price: ${priceFormatted}
${product.handle ? `- Handle: ${product.handle}` : ''}
${context.storeName ? `- Store: ${context.storeName}` : ''}
Campaign Objective: ${objective}
Target Platform: ${platformLabel}
`.trim();

    try {
      const response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const json = (await response.json()) as any;
      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsed = extractAndParseJson<{ variations: AdCreativeVariation[] }>(rawText);

      const variationSchema = z.object({
        hook: z.string().min(1),
        primary_text: z.string().min(1),
        headline: z.string().min(1),
        cta: z.string().min(1),
      });

      const responseSchema = z.object({
        variations: z.array(variationSchema).min(1),
      });

      const validated = responseSchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn('Gemini ad creatives schema mismatch, falling back to mock:', { error: validated.error.message });
        return this.mockFallback.generateAdCreatives(context);
      }

      const usage = json?.usageMetadata;
      const inputTokens = usage?.promptTokenCount || 100;
      const outputTokens = usage?.candidatesTokenCount || 80;
      const costUsd = (inputTokens * 0.10 / 1000000) + (outputTokens * 0.40 / 1000000);

      return {
        variations: validated.data.variations.slice(0, 3),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        model: this.model,
      };
    } catch (err: any) {
      logger.warn('GeminiAiProvider.generateAdCreatives failed, falling back:', err.message);
      return this.mockFallback.generateAdCreatives(context);
    }
  }

  async generateAdImage(
    context: AdImageContext
  ): Promise<AdImageGenerationResult> {
    const { product, prompt, hook, headline, platform, style } = context;

    let styleDescription = 'Masterpiece commercial product photography in a high-end studio with clean, crisp lighting.';
    if (style === 'lifestyle') {
      styleDescription = 'Modern lifestyle in-situ product photography with warm organic ambient light.';
    } else if (style === 'vibrant_gradient') {
      styleDescription = 'Trendy contemporary e-commerce aesthetic with bold, vibrant gradient studio backdrop.';
    } else if (style === 'minimalist_luxury') {
      styleDescription = 'Ultra-minimalist luxury aesthetic with soft cinematic shadows and neutral stone tones.';
    }

    const platformLabel = platform === 'instagram' ? 'Instagram 1:1 feed' : 'Facebook News Feed';
    const customContext = prompt
      ? `Specific Direction: ${prompt}.`
      : (hook ? `Marketing Angle: "${hook}".` : '');
    const headlineContext = headline ? `Headline Theme: "${headline}".` : '';

    const imagenPrompt = `Commercial advertisement product photography for an e-commerce store. Product: "${product.title}" (${product.category || 'Quality Goods'}). ${styleDescription} ${customContext} ${headlineContext} Designed for ${platformLabel} sponsored advertisement. Ultra-sharp focus on the product, photorealistic textures, 8k resolution, masterwork commercial advertising visual, professional color grading. Strictly NO text, NO typography, NO watermark, NO logo overlay, clean centered composition.`.trim();

    if (this.apiKey) {
      const candidateModels = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001'];
      for (const m of candidateModels) {
        try {
          logger.info(`Generating AI ad image via Google Imagen 3 (${m}) for "${product.title}"`);
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:predict?key=${this.apiKey}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: imagenPrompt }],
              parameters: {
                sampleCount: 1,
                aspectRatio: '1:1',
                outputMimeType: 'image/jpeg',
              },
            }),
          });

          if (response.ok) {
            const data = (await response.json()) as any;
            const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
            if (b64) {
              return {
                image_url: `data:image/jpeg;base64,${b64}`,
                revised_prompt: imagenPrompt,
                model: m,
                estimated_cost_usd: 0.030,
              };
            }
          } else {
            const errText = await response.text();
            logger.warn(`Google Imagen (${m}) returned ${response.status}: ${errText}`);
          }
        } catch (imgErr: any) {
          logger.warn(`Google Imagen (${m}) attempt failed:`, { error: imgErr.message });
        }
      }
    }

    // Resilient fallback via MockAiProvider / dynamic visual
    if (getEnvConfig().NODE_ENV === 'production') {
      // Never serve a generic stock photo as an "AI generated" visual in production.
      throw new Error('Google Imagen 3 is unavailable and no fallback image provider is configured.');
    }
    logger.warn('Gemini Imagen 3 not available or no key, falling back to mock / commercial visual');
    return this.mockFallback.generateAdImage(context);
  }

  async generateStructuredJson<T>(
    prompt: string,
    schema: any,
    options?: StructuredAiOptions
  ): Promise<StructuredAiResult<T>> {
    const isProduction = getEnvConfig().NODE_ENV === 'production';
    if (!this.apiKey) {
      if (isProduction) {
        // Never serve canned mock audit data in production; surface the failure honestly.
        throw new Error('GEMINI_API_KEY is not configured, so AI analysis is unavailable.');
      }
      logger.warn('GeminiAiProvider: No GEMINI_API_KEY found, falling back to mock structured JSON');
      return this.mockFallback.generateStructuredJson<T>(prompt, schema, options);
    }

    const systemPrompt =
      options?.systemPrompt ||
      'You are an expert e-commerce intelligence AI. You MUST reply with valid JSON matching the requested schema. Ground all recommendations strictly in provided data and never fabricate metrics.';

    try {
      const response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: options?.temperature ?? 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const json = (await response.json()) as any;
      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsed = extractAndParseJson<T>(rawText);

      let validatedData: T = parsed;
      if (schema && typeof schema.safeParse === 'function') {
        const validation = schema.safeParse(parsed);
        if (validation.success) {
          validatedData = validation.data;
        } else {
          logger.warn('Gemini structured JSON schema mismatch, attempting tolerant parse:', { error: validation.error.message });
          // If schema.parse is available, we try or fallback
          try {
            validatedData = schema.parse(parsed);
          } catch (_parseErr) {
            logger.warn('Tolerant schema parse failed');
            if (isProduction) {
              // Never serve canned mock audit data in production; surface the failure honestly.
              throw new Error('AI provider response did not match the required schema.');
            }
            logger.warn('Falling back to mock provider (non-production)');
            return this.mockFallback.generateStructuredJson<T>(prompt, schema, options);
          }
        }
      }

      const usage = json?.usageMetadata;
      const inputTokens = usage?.promptTokenCount || 150;
      const outputTokens = usage?.candidatesTokenCount || 100;
      const costUsd = (inputTokens * 0.10 / 1000000) + (outputTokens * 0.40 / 1000000);

      return {
        data: validatedData,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        model: this.model,
      };
    } catch (err: any) {
      logger.warn('GeminiAiProvider.generateStructuredJson error:', { error: err.message });
      if (isProduction) {
        // Never serve canned mock audit data in production; surface the failure honestly.
        throw err;
      }
      return this.mockFallback.generateStructuredJson<T>(prompt, schema, options);
    }
  }

  async generateText(
    prompt: string,
    options?: StructuredAiOptions
  ): Promise<TextAiResult> {
    if (!this.apiKey) {
      logger.warn('GeminiAiProvider: No GEMINI_API_KEY found, falling back to mock text');
      return this.mockFallback.generateText(prompt, options);
    }

    const systemPrompt = options?.systemPrompt || 'You are an expert e-commerce intelligence AI.';

    try {
      const response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const json = (await response.json()) as any;
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const usage = json?.usageMetadata;

      const inputTokens = usage?.promptTokenCount || 100;
      const outputTokens = usage?.candidatesTokenCount || 80;
      const costUsd = (inputTokens * 0.10 / 1000000) + (outputTokens * 0.40 / 1000000);

      return {
        text,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        model: this.model,
      };
    } catch (err: any) {
      logger.warn('GeminiAiProvider.generateText error:', { error: err.message });
      return this.mockFallback.generateText(prompt, options);
    }
  }
}
