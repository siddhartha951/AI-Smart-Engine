import { ShopifyProduct } from '../shopify/shopify.adapter';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiResponse {
  content: string;
  recommended_product_ids: string[];
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface AiRequestContext {
  storeId: string;
  sessionId: string;
  catalogSubset: ShopifyProduct[];
  storePolicies: {
    delivery_policy: string;
    returns_policy: string;
    faq_content: string;
  };
  assistantSettings: {
    assistant_name: string;
    allowed_topics: string[];
  };
}

export interface IAiProvider {
  generateResponse(
    chatHistory: ChatMessage[],
    context: AiRequestContext
  ): Promise<AiResponse>;
}
