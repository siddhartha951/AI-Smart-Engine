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
    custom_prompt?: string;
    knowledge_base?: string;
    support_contact?: string;
  };
}

export interface AdCreativeVariation {
  hook: string;
  primary_text: string;
  headline: string;
  cta: string;
}

export interface AdCreativeContext {
  storeId: string;
  platform: 'facebook' | 'instagram';
  objective: 'product_sales' | 'traffic' | 'retargeting' | 'product_launch';
  product: {
    id: string;
    title: string;
    price: number;
    currency: string;
    category?: string;
    handle?: string;
    product_url?: string;
    image_url?: string;
  };
  storeName?: string;
}

export interface AdCreativeGenerationResult {
  variations: AdCreativeVariation[];
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  model: string;
}

export interface IAiProvider {
  generateResponse(
    chatHistory: ChatMessage[],
    context: AiRequestContext
  ): Promise<AiResponse>;

  generateAdCreatives(
    context: AdCreativeContext
  ): Promise<AdCreativeGenerationResult>;
}
