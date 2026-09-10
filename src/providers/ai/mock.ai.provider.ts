import { AiRequestContext, AiResponse, ChatMessage, IAiProvider } from './ai.provider';

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
}
