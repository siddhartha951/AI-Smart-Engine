import OpenAI from 'openai';
import { z } from 'zod';
import {
  AdCreativeContext,
  AdCreativeGenerationResult,
  AdImageContext,
  AdImageGenerationResult,
  AiRequestContext,
  AiResponse,
  ChatMessage,
  IAiProvider,
} from './ai.provider';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';
import { MockAiProvider } from './mock.ai.provider';
import { extractAndParseJson } from './ai.utils';

export class OpenAiProvider implements IAiProvider {
  private openai: OpenAI;

  constructor() {
    const env = getEnvConfig();
    this.openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }

  async generateResponse(
    chatHistory: ChatMessage[],
    context: AiRequestContext
  ): Promise<AiResponse> {
    const env = getEnvConfig();

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
You are "${context.assistantSettings.assistant_name}", an AI shopping assistant for a Shopify store.
Your goal is to help customers find products, answer questions about the store, and provide a great shopping experience.
${customPromptSection}
${knowledgeBaseSection}
${quickLinksSection}
Strict Rules:
1. ONLY recommend products from the "Available Catalog Subset" below.
2. NEVER invent or hallucinate products, prices, or stock.
3. If the user asks for something not in the subset, politely explain what is available or suggest closest alternative.
4. You may discuss topics: ${context.assistantSettings.allowed_topics.join(', ')}.
5. Store Policies to reference if asked: 
   - Delivery: ${context.storePolicies.delivery_policy}
   - Returns: ${context.storePolicies.returns_policy}
   - FAQ: ${context.storePolicies.faq_content}
6. If the shopper asks about order tracking, returns, shipping, size guides, or human support, provide a concise, warm answer and share the exact store action link from the "Store Quick Navigation & Action Links" above.

CRITICAL DISPLAY & FORMATTING GUIDELINES:
1. STRUCTURE YOUR ANSWER BEAUTIFULLY:
   - Start with 1 warm, empathetic sentence addressing the customer's specific question or problem.
   - If recommending product(s), explain WHY they help using 2 to 3 concise, clear bullet points (e.g. • Key benefit 1, • Key benefit 2).
   - End with a friendly, short 1-line closing or call-to-action (e.g. "Check out the option below! Let me know if you need help with anything else.").
2. AVOID REPETITION & BULKY TEXT:
   - DO NOT repeat the entire product title or long product subtitle inside the text (the full title and direct purchase card appear below automatically!).
   - Use clean spacing and line breaks between your greeting, bullet points, and closing.
   - DO NOT output raw markdown image tags or markdown links.
3. TOOL CALL & BESTSELLERS:
   - ALWAYS call the \`recommend_products\` function with the corresponding product ID(s) from the subset.
   - If the shopper asks general questions like "what are your best products?" or "recommend something", prioritize items marked with \`is_bestseller: true\`.

Available Catalog Subset (JSON):
${JSON.stringify(catalogSummary, null, 2)}
`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        tools: [
          {
            type: 'function',
            function: {
              name: 'recommend_products',
              description: 'Recommend specific products to the user based on their request. Use this whenever you mention products.',
              parameters: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    description: 'The conversational response to the user',
                  },
                  product_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of product IDs from the catalog subset to show to the user as cards',
                  },
                },
                required: ['message', 'product_ids'],
              },
            },
          },
        ],
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      const usage = response.usage;

      let finalContent = choice.message.content || '';
      let recommendedIds: string[] = [];

      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        const toolCall = choice.message.tool_calls[0];
        if (toolCall.type === 'function' && toolCall.function.name === 'recommend_products') {
          const args = JSON.parse(toolCall.function.arguments);
          finalContent = args.message;
          
          // Ensure recommended IDs actually exist in the subset
          const validIds = context.catalogSubset.map(p => p.id);
          recommendedIds = (args.product_ids || []).filter((id: string) => validIds.includes(id));
        }
      }

      // Sanitize any accidental markdown images or links that the model might generate
      finalContent = finalContent
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[(?:View Product|Check out|Buy now|Product).*?\]\(.*?\)/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // If function was not called or recommendedIds is empty, check if finalContent or user query matches catalog items
      if (recommendedIds.length === 0 && context.catalogSubset.length > 0) {
        const lastUserMsg = [...chatHistory].reverse().find(m => m.role === 'user')?.content.toLowerCase() || '';
        const found = context.catalogSubset.filter(p => {
          const title = p.title.toLowerCase();
          const handle = (p.handle || '').toLowerCase();
          const cat = (p.category || '').toLowerCase();
          return (
            (title && finalContent.toLowerCase().includes(title)) ||
            (handle && finalContent.toLowerCase().includes(handle)) ||
            (cat && lastUserMsg.includes(cat))
          );
        });
        if (found.length > 0) {
          recommendedIds = found.slice(0, 4).map(p => p.id);
        }
      }

      // Rough estimated cost calculation for tracking (e.g., gpt-4o-mini is ~$0.15/1M input, $0.60/1M output)
      const inputTokens = usage?.prompt_tokens || 0;
      const outputTokens = usage?.completion_tokens || 0;
      const costUsd = (inputTokens * 0.15 / 1000000) + (outputTokens * 0.60 / 1000000);

      return {
        content: finalContent,
        recommended_product_ids: recommendedIds,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
      };
    } catch (err: any) {
      if (
        err?.status === 429 ||
        err?.message?.includes('429') ||
        err?.message?.includes('credits') ||
        err?.message?.includes('quota')
      ) {
        const contact = context.assistantSettings.support_contact || 'our store support';
        const fallbackIds = context.catalogSubset.slice(0, 2).map((p) => p.id);
        return {
          content: `Hi! I am currently experiencing high demand. Please feel free to browse our store collections, check our delivery and returns policies, or reach out to our team at ${contact}!`,
          recommended_product_ids: fallbackIds,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
        };
      }
      throw err;
    }
  }

  async generateAdCreatives(
    context: AdCreativeContext
  ): Promise<AdCreativeGenerationResult> {
    const env = getEnvConfig();
    const { product, platform, objective } = context;
    const currency = product.currency || 'GBP';
    const priceFormatted = `${currency} ${Number(product.price || 0).toFixed(2)}`;
    const platformLabel = platform === 'instagram' ? 'Instagram Feed & Stories' : 'Facebook News Feed';

    const systemPrompt = `
You are an expert direct-response ad copywriter specializing in Meta advertising (${platformLabel}) for e-commerce stores.
Your objective is to generate 3 high-converting ad creative variations for the selected merchant product.

STRICT ANTI-HALLUCINATION & FACTUAL GROUNDING CONSTRAINTS:
1. ONLY use factual details directly supplied in the product context below (title, price, category).
2. DO NOT invent product specifications, technical claims, organic/eco certifications, awards, ingredients, or health claims unless explicitly stated.
3. DO NOT fabricate discounts, promotional percentage cuts (e.g. "50% off", "BOGO"), or free gifts.
4. DO NOT make ungrounded shipping promises (e.g. "Free Next-Day Delivery") or money-back guarantees.
5. The copy must feel authentic, compelling, and compliant with Meta Advertising Standards.

Output must be a valid JSON object containing an array "variations" of exactly 3 objects with keys:
- "hook": Catchy first line or pattern interrupt (1 sentence).
- "primary_text": Compelling body text (2-3 sentences) describing the product accurately and driving action.
- "headline": Punchy headline for the link card (under 60 characters).
- "cta": Contextual call-to-action button text appropriate for the objective (${objective}).

Example JSON structure:
{
  "variations": [
    {
      "hook": "...",
      "primary_text": "...",
      "headline": "...",
      "cta": "..."
    }
  ]
}
`;

    const userPrompt = `
Product Details:
- Title: ${product.title}
- Category: ${product.category || 'General Merchandise'}
- Regular Price: ${priceFormatted}
${product.handle ? `- Product URL Handle: ${product.handle}` : ''}
${context.storeName ? `- Store / Brand: ${context.storeName}` : ''}

Target Platform: ${platformLabel}
Campaign Objective: ${objective}

Generate 3 diverse, highly engaging creative variations tailored to this product and objective now. Output pure JSON only.
`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const choice = response.choices[0];
      const usage = response.usage;
      const rawContent = choice.message.content || '{}';

      let parsed: any;
      try {
        parsed = extractAndParseJson(rawContent);
      } catch (jsonErr: any) {
        logger.warn('Failed to parse ad creatives JSON, activating fallback:', jsonErr.message);
        const mockFallback = new MockAiProvider();
        return mockFallback.generateAdCreatives(context);
      }

      const variationSchema = z.object({
        hook: z.string().min(1, 'Hook is required'),
        primary_text: z.string().min(1, 'Primary text is required'),
        headline: z.string().min(1, 'Headline is required'),
        cta: z.string().min(1, 'CTA is required'),
      });

      const responseSchema = z.object({
        variations: z.array(variationSchema).min(1, 'At least 1 variation required'),
      });

      const validated = responseSchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn('Malformed ad creative output from OpenAI, activating fallback:', { error: validated.error.message });
        const mockFallback = new MockAiProvider();
        return mockFallback.generateAdCreatives(context);
      }

      const inputTokens = usage?.prompt_tokens || 0;
      const outputTokens = usage?.completion_tokens || 0;
      const costUsd = (inputTokens * 0.15 / 1000000) + (outputTokens * 0.60 / 1000000);

      return {
        variations: validated.data.variations.slice(0, 3),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
      };
    } catch (err: any) {
      logger.warn('OpenAiProvider.generateAdCreatives error, activating fallback:', err?.message || err);
      const mockFallback = new MockAiProvider();
      return mockFallback.generateAdCreatives(context);
    }
  }

  async generateAdImage(
    context: AdImageContext
  ): Promise<AdImageGenerationResult> {
    const env = getEnvConfig();
    const { product, platform, style, prompt: userPrompt, hook, headline } = context;
    const platformLabel = platform === 'instagram' ? 'Instagram Feed & Story' : 'Meta / Facebook Ads';

    let styleDescription = 'High-end commercial studio product photography with clean lighting, elegant studio backdrop, and soft ambient reflections.';
    if (style === 'lifestyle') {
      styleDescription = 'Aesthetic contemporary lifestyle product photography in a bright modern home setting with natural warm sunlight and organic textures.';
    } else if (style === 'vibrant_gradient') {
      styleDescription = 'Eye-catching modern commercial banner with vibrant colorful gradient lighting, high energy, and sleek direct-response aesthetic.';
    } else if (style === 'minimalist_luxury') {
      styleDescription = 'Editorial minimalist luxury product composition with architectural geometric shadows, muted tones, and ultra-clean styling.';
    }

    const customContext = userPrompt
      ? `Specific Direction: ${userPrompt}.`
      : (hook ? `Marketing Angle / Hook: "${hook}".` : '');

    const headlineContext = headline ? `Headline Theme: "${headline}".` : '';

    const dallEPrompt = `Commercial advertisement product photography for an e-commerce store. Product: "${product.title}" (${product.category || 'Quality Goods'}). ${styleDescription} ${customContext} ${headlineContext} Designed for ${platformLabel} sponsored advertisement. Ultra-sharp focus on the product, photorealistic textures, 8k resolution, masterwork commercial advertising visual, professional color grading. Strictly NO text, NO typography, NO watermark, NO logo overlay, clean centered composition.`.trim();

    try {
      logger.info(`Generating AI ad image via OpenAI for product "${product.title}"`);

      const candidateModels = ['gpt-image-1.5', 'gpt-image-1', 'dall-e-3'];
      let lastErr: any = null;
      let imageUrl: string | undefined;
      let revisedPrompt: string | undefined;
      let usedModel = candidateModels[0];

      for (const m of candidateModels) {
        try {
          const response = await this.openai.images.generate({
            model: m,
            prompt: dallEPrompt,
            n: 1,
            size: '1024x1024',
          });
          const datum: any = response?.data?.[0];
          // NOTE: the gpt-image-1 family returns `b64_json` (no hosted URL);
          // dall-e models return `url`. Accept either so successful
          // generations are never discarded as failures.
          const url = datum?.url
            || (datum?.b64_json ? `data:image/png;base64,${datum.b64_json}` : undefined);
          if (url) {
            imageUrl = url;
            revisedPrompt = datum?.revised_prompt;
            usedModel = m;
            break;
          }
          lastErr = new Error(`Model ${m} returned an empty image response.`);
        } catch (mErr: any) {
          lastErr = mErr;
          if (mErr?.message?.includes('does not exist') || mErr?.code === 'invalid_value') {
            continue; // try next candidate model
          }
          throw mErr; // If billing/quota or other fatal error, exit loop
        }
      }

      if (!imageUrl) {
        throw lastErr || new Error('OpenAI returned empty image response.');
      }

      return {
        image_url: imageUrl,
        revised_prompt: revisedPrompt || dallEPrompt,
        model: usedModel,
        estimated_cost_usd: 0.040,
      };
    } catch (err: any) {
      logger.warn(`OpenAI image generation unavailable (${err?.status || err?.code || 'error'}: ${err?.message || err}). Checking Google Imagen 3 fallback...`);

      // Try Google Imagen 3 if GEMINI_API_KEY is available
      const geminiKey = env.GEMINI_API_KEY || (process.env.GOOGLE_AI_API_KEY ?? '');
      if (geminiKey) {
        try {
          logger.info(`Attempting Google Imagen 3 fallback for product "${product.title}"`);
          const imgUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiKey}`;
          const res = await fetch(imgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: dallEPrompt }],
              parameters: { sampleCount: 1, aspectRatio: '1:1', outputMimeType: 'image/jpeg' },
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as any;
            const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
            if (b64) {
              return {
                image_url: `data:image/jpeg;base64,${b64}`,
                revised_prompt: dallEPrompt,
                model: 'imagen-3.0-generate-002',
                estimated_cost_usd: 0.030,
                notice: '✨ Generated via Google Imagen 3 engine',
              };
            }
          } else {
            const errBody = await res.text();
            logger.warn(`Google Imagen 3 returned ${res.status}: ${errBody}`);
          }
        } catch (gemErr: any) {
          logger.warn('Google Imagen 3 attempt failed:', gemErr?.message || gemErr);
        }
      }

      const isQuotaOrCredits =
        err?.status === 429 ||
        err?.code === 'credit_balance_exhausted' ||
        err?.type === 'insufficient_quota' ||
        err?.message?.includes('credits') ||
        err?.message?.includes('quota') ||
        err?.message?.includes('billing');

      // Last resort: free Flux engine via pollinations.ai. The URL is verified
      // server-side before it reaches the merchant, so a broken or
      // rate-limited upstream never surfaces as a broken image in the studio.
      const seed = Math.floor(Math.random() * 900000) + 100000;
      const cleanPrompt = encodeURIComponent(`Commercial advertising visual of ${product.title}, ${product.category || 'fashion'}, professional studio lighting, 8k resolution, photorealistic commercial product photography`);
      const aiGeneratedUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=1024&height=1024&nologo=true&model=flux&seed=${seed}`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        let verifyRes: Response;
        try {
          verifyRes = await fetch(aiGeneratedUrl, { signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        const contentType = verifyRes.headers.get('content-type') || '';
        if (!verifyRes.ok || !contentType.startsWith('image/')) {
          throw new Error(`Pollinations returned ${verifyRes.status} (${contentType || 'non-image response'})`);
        }
      } catch (verifyErr: any) {
        logger.warn('Pollinations Flux fallback verification failed:', verifyErr?.message || verifyErr);
        throw new Error(
          'All AI image providers failed. ' +
          (isQuotaOrCredits
            ? 'Your OpenAI API key has no credits — add credits at platform.openai.com/billing, or set GEMINI_API_KEY (free tier) to use Google Imagen 3.'
            : `Last provider error: ${err?.message || err}`)
        );
      }

      const notice = isQuotaOrCredits
        ? '✨ AI visual generated via free Flux engine (OpenAI key has no credits — add credits at platform.openai.com/billing for premium models, or set GEMINI_API_KEY).'
        : `✨ AI visual generated via free Flux engine (${err?.message || 'OpenAI API limit'}).`;

      return {
        image_url: aiGeneratedUrl,
        revised_prompt: dallEPrompt,
        model: 'flux-ai-engine',
        estimated_cost_usd: 0,
        notice,
      };
    }
  }

  async generateStructuredJson<T>(
    prompt: string,
    schema: any,
    options?: any
  ): Promise<{ data: T; input_tokens: number; output_tokens: number; estimated_cost_usd: number; model: string }> {
    const env = getEnvConfig();
    const model = env.OPENAI_MODEL || 'gpt-4o-mini';
    const temperature = options?.temperature ?? 0.3;
    const systemPrompt =
      options?.systemPrompt ||
      'You are an expert e-commerce intelligence AI. You MUST reply with valid JSON matching the requested schema. Ground all recommendations strictly in provided data and never fabricate metrics.';

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages,
        temperature,
        response_format: { type: 'json_object' },
      });

      const choice = response.choices[0];
      const raw = choice.message.content || '{}';
      let parsed: any;
      try {
        parsed = extractAndParseJson<any>(raw);
      } catch (err: any) {
        logger.warn('Failed to parse OpenAI JSON response:', err.message);
        if (env.NODE_ENV === 'production') {
          // Never serve canned mock audit data in production; surface the failure honestly.
          throw new Error(`AI provider returned an unparseable response: ${err.message}`);
        }
        logger.warn('Activating mock fallback engine (non-production)');
        const mockFallback = new MockAiProvider();
        return mockFallback.generateStructuredJson<T>(prompt, schema, options);
      }

      let validated: any = parsed;
      if (schema && typeof schema.safeParse === 'function') {
        const vRes = schema.safeParse(parsed);
        if (vRes.success) {
          validated = vRes.data;
        } else {
          logger.warn(`OpenAiProvider: Schema mismatch (${vRes.error.message}), attempting tolerant parse`);
          try {
            validated = schema.parse(parsed);
          } catch (_parseErr) {
            logger.warn('Tolerant schema parse failed');
            if (env.NODE_ENV === 'production') {
              // Never serve canned mock audit data in production; surface the failure honestly.
              throw new Error('AI provider response did not match the required schema.');
            }
            logger.warn('Activating mock fallback engine (non-production)');
            const mockFallback = new MockAiProvider();
            return mockFallback.generateStructuredJson<T>(prompt, schema, options);
          }
        }
      }

      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      const costUsd = (inputTokens * 0.15 / 1000000) + (outputTokens * 0.60 / 1000000);

      return {
        data: validated as T,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        model,
      };
    } catch (err: any) {
      logger.warn('OpenAiProvider.generateStructuredJson error:', err?.message || err);
      if (env.NODE_ENV === 'production') {
        // Never serve canned mock audit data in production; surface the failure honestly.
        throw err;
      }
      logger.warn('Activating mock fallback engine (non-production)');
      const mockFallback = new MockAiProvider();
      return mockFallback.generateStructuredJson<T>(prompt, schema, options);
    }
  }

  async generateText(
    prompt: string,
    options?: any
  ): Promise<{ text: string; input_tokens: number; output_tokens: number; estimated_cost_usd: number; model: string }> {
    const env = getEnvConfig();
    const model = env.OPENAI_MODEL || 'gpt-4o-mini';
    const temperature = options?.temperature ?? 0.7;
    const systemPrompt = options?.systemPrompt || 'You are an expert e-commerce intelligence AI.';

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages,
        temperature,
      });

      const choice = response.choices[0];
      const text = choice.message.content || '';
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      const costUsd = (inputTokens * 0.15 / 1000000) + (outputTokens * 0.60 / 1000000);

      return {
        text,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        model,
      };
    } catch (err: any) {
      logger.warn('OpenAiProvider.generateText error, activating fallback engine:', err?.message || err);
      const mockFallback = new MockAiProvider();
      return mockFallback.generateText(prompt, options);
    }
  }
}
