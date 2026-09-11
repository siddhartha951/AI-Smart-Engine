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
} from './ai.provider';

export class MockAiProvider implements IAiProvider {
  async generateResponse(
    chatHistory: ChatMessage[],
    context: AiRequestContext
  ): Promise<AiResponse> {
    const lastUserMessage = [...chatHistory].reverse().find((m) => m.role === 'user');
    const userText = lastUserMessage?.content.toLowerCase() || '';

    let recommendedIds: string[] = [];
    let content = `Hello from ${context.assistantSettings.assistant_name} (Mock AI). `;

    // Simple mock logic: recommend products if they match a word in the user's message
    if (context.catalogSubset.length > 0) {
      const matches = context.catalogSubset.filter(
        (p) => userText.includes(p.category.toLowerCase()) || userText.includes(p.title.toLowerCase().split(' ')[0])
      );

      if (matches.length > 0) {
        content += `I found some great options for you based on our catalog:`;
        recommendedIds = matches.map((m) => m.id);
      } else {
        content += `I can help you with topics like: ${context.assistantSettings.allowed_topics.join(', ')}.`;
      }
    } else {
      content += `I'm sorry, I don't see any products matching your criteria in stock right now.`;
    }

    return {
      content,
      recommended_product_ids: recommendedIds,
      input_tokens: 150, // mock usage
      output_tokens: 50,
      estimated_cost_usd: 0.0001,
    };
  }

  async generateAdCreatives(
    context: AdCreativeContext
  ): Promise<AdCreativeGenerationResult> {
    const { product, platform, objective } = context;
    const currency = product.currency || 'GBP';
    const priceFormatted = `${currency} ${Number(product.price || 0).toFixed(2)}`;
    const category = product.category || 'collection';
    const isInsta = platform === 'instagram';

    const objLabel = objective.replace('_', ' ');

    // 3 grounded variations
    const variations: AdCreativeVariation[] = [
      {
        hook: isInsta
          ? `✨ Elevate your everyday essentials with our ${product.title}.`
          : `Looking for top-rated ${category}? Discover the ${product.title}.`,
        primary_text: `Crafted for quality and authentic everyday performance. The ${product.title} from our ${category} lineup is available now for ${priceFormatted}. Clean design, dependable craftsmanship, and grounded in genuine materials. Explore today.`,
        headline: `${product.title} — Official Store`,
        cta: objective === 'product_sales' ? 'Shop Now' : (objective === 'retargeting' ? 'Complete Your Order' : 'Learn More'),
      },
      {
        hook: isInsta
          ? `Stop scrolling: Meet the ${product.title}. 🔥`
          : `Upgrade your ${category} experience with the ${product.title}.`,
        primary_text: `Whether you're shopping for yourself or searching for the perfect addition to your ${category} lineup, the ${product.title} delivers authentic value at ${priceFormatted}. See full product details and order directly through our store.`,
        headline: `Order ${product.title} Today | ${priceFormatted}`,
        cta: objective === 'product_sales' ? 'Shop Now' : (objective === 'traffic' ? 'Explore Collection' : 'Claim Yours'),
      },
      {
        hook: objective === 'retargeting'
          ? `Still thinking about the ${product.title}? It's waiting for you.`
          : `Meet the ${product.title}: Pure quality in ${category}.`,
        primary_text: `Don't miss out on genuine quality. The ${product.title} is available now for ${priceFormatted}. Browse authentic specifications, store policies, and complete your purchase securely.`,
        headline: `Genuine ${product.title} | ${objLabel.toUpperCase()}`,
        cta: objective === 'product_launch' ? 'Be First To Shop' : 'Shop Now',
      },
    ];

    return {
      variations,
      input_tokens: 250,
      output_tokens: 150,
      estimated_cost_usd: 0.0002,
      model: 'mock-gpt-4o-mini',
    };
  }

  async generateAdImage(
    context: AdImageContext
  ): Promise<AdImageGenerationResult> {
    const { product } = context;
    const cat = (product.category || '').toLowerCase();

    let mockUrl = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1024&auto=format&fit=crop&q=80'; // Watch
    if (cat.includes('audio') || cat.includes('earbud') || cat.includes('headphone')) {
      mockUrl = 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=1024&auto=format&fit=crop&q=80';
    } else if (cat.includes('decor') || cat.includes('vase') || cat.includes('home')) {
      mockUrl = 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=1024&auto=format&fit=crop&q=80';
    } else if (cat.includes('bed') || cat.includes('blanket')) {
      mockUrl = 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=1024&auto=format&fit=crop&q=80';
    }

    return {
      image_url: mockUrl,
      revised_prompt: `Commercial product advertising studio shot for ${product.title} (${product.category || 'General'})`,
      model: 'mock-dall-e-3',
      estimated_cost_usd: 0.040,
    };
  }
}
