import OpenAI from 'openai';
import { AiRequestContext, AiResponse, ChatMessage, IAiProvider } from './ai.provider';
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
}
