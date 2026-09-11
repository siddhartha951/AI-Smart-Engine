import OpenAI from 'openai';
import { z } from 'zod';
import {
  AdCreativeContext,
  AdCreativeGenerationResult,
  AiRequestContext,
  AiResponse,
  ChatMessage,
  IAiProvider,
} from './ai.provider';
import { getEnvConfig } from '../../config/env';

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

    const systemPrompt = `
You are "${context.assistantSettings.assistant_name}", an AI shopping assistant for a Shopify store.
Your goal is to help customers find products, answer questions about the store, and provide a great shopping experience.
${customPromptSection}
${knowledgeBaseSection}
Strict Rules:
1. ONLY recommend products from the "Available Catalog Subset" below.
2. NEVER invent or hallucinate products, prices, or stock.
3. If the user asks for something not in the subset, politely explain you don't have it right now.
4. You may discuss topics: ${context.assistantSettings.allowed_topics.join(', ')}.
5. Store Policies to reference if asked: 
   - Delivery: ${context.storePolicies.delivery_policy}
   - Returns: ${context.storePolicies.returns_policy}
   - FAQ: ${context.storePolicies.faq_content}

CRITICAL DISPLAY & FORMATTING RULES:
- DO NOT write raw markdown image tags like \`![alt](image_url)\` or links like \`[View Product](product_url)\` in your response text.
- DO NOT output bulleted lists of URLs or images.
- Write a short, warm, natural conversational introduction (1-2 sentences) about the recommended product(s).
- ALWAYS call the \`recommend_products\` function with the corresponding product ID(s) from the subset. The system will automatically render interactive Product Cards with image, price, and direct checkout buttons below your message!

Available Catalog Subset (JSON):
${JSON.stringify(context.catalogSubset, null, 2)}
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
        parsed = JSON.parse(rawContent);
      } catch (jsonErr: any) {
        throw new Error(`Failed to parse AI response as JSON: ${jsonErr.message}`);
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
        throw new Error(`Malformed AI creative output: ${validated.error.issues.map(i => i.message).join(', ')}`);
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
      if (
        err?.status === 429 ||
        err?.message?.includes('429') ||
        err?.message?.includes('credits') ||
        err?.message?.includes('quota')
      ) {
        const isInsta = platform === 'instagram';
        const objLabel = objective.replace('_', ' ');
        return {
          variations: [
            {
              hook: isInsta
                ? `✨ Elevate your everyday style with our ${product.title}.`
                : `Looking for top-rated ${product.category || 'essentials'}? Discover the ${product.title}.`,
              primary_text: `Crafted for dependable quality. The ${product.title} is available now for ${priceFormatted}. Explore authentic specifications and order directly from our store today.`,
              headline: `${product.title} — Official Store`,
              cta: objective === 'product_sales' ? 'Shop Now' : (objective === 'retargeting' ? 'Complete Your Order' : 'Learn More'),
            },
            {
              hook: isInsta
                ? `Stop scrolling: Meet the ${product.title}. 🔥`
                : `Upgrade your daily routine with the ${product.title}.`,
              primary_text: `Delivering authentic value and dependable craftsmanship at ${priceFormatted}. See full product details and order directly through our store.`,
              headline: `Order ${product.title} Today | ${priceFormatted}`,
              cta: objective === 'product_sales' ? 'Shop Now' : 'Explore Collection',
            },
            {
              hook: objective === 'retargeting'
                ? `Still thinking about the ${product.title}? It's waiting for you.`
                : `Meet the ${product.title}: Pure quality in ${product.category || 'store'}.`,
              primary_text: `Don't miss out on genuine quality. The ${product.title} is available now for ${priceFormatted}. Complete your purchase securely.`,
              headline: `Genuine ${product.title} | ${objLabel.toUpperCase()}`,
              cta: objective === 'product_launch' ? 'Be First To Shop' : 'Shop Now',
            },
          ],
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          model: 'fallback-gpt-4o-mini',
        };
      }
      throw err;
    }
  }
}
