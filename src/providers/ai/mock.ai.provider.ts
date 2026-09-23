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
    let content = `Hello! I am ${context.assistantSettings.assistant_name}, your shopping assistant. `;

    const isGreeting = /^(hi|hello|hey|greetings|how are you|good morning|good evening|good afternoon)/i.test(userText.trim());

    // Check for quick action intents first
    const pills = context.assistantSettings.quick_action_pills || [];
    const trackPill = pills.find(p => p.id === 'track_order' && p.enabled !== false);
    const returnPill = pills.find(p => p.id === 'return_policy' && p.enabled !== false);
    const sizePill = pills.find(p => p.id === 'size_guide' && p.enabled !== false);
    const whatsappPill = pills.find(p => p.id === 'whatsapp_support' && p.enabled !== false);

    if (userText.includes('track') || userText.includes('order status')) {
      if (trackPill?.url) {
        content += `You can track your order status live here: ${trackPill.url}. Please have your Order ID or tracking number ready!`;
      } else {
        content += `To track your order, please refer to your confirmation email or contact our team at ${context.assistantSettings.support_contact || 'support'}.`;
      }
      return { content, recommended_product_ids: [], input_tokens: 50, output_tokens: 30, estimated_cost_usd: 0.0001 };
    }

    if (userText.includes('return') || userText.includes('exchange') || userText.includes('refund')) {
      const returnInfo = context.storePolicies.returns_policy || 'Please refer to our return & exchange guidelines.';
      const linkInfo = returnPill?.url ? ` Full policy details: ${returnPill.url}` : '';
      content += `${returnInfo}${linkInfo}`;
      return { content, recommended_product_ids: [], input_tokens: 50, output_tokens: 30, estimated_cost_usd: 0.0001 };
    }

    if (userText.includes('size') || userText.includes('fit guide') || userText.includes('size guide')) {
      const sizeTarget = sizePill?.image_url || sizePill?.url;
      if (sizeTarget) {
        content += `Here is our size guide to help you find the right fit: ${sizeTarget}. Feel free to ask if you need sizing advice!`;
      } else {
        content += `Our products generally fit true to size. Let me know which item you're interested in and I can help you with sizing!`;
      }
      return { content, recommended_product_ids: [], input_tokens: 50, output_tokens: 30, estimated_cost_usd: 0.0001 };
    }

    const revertDuration = context.assistantSettings.ticket_revert_duration || 'within 24 hours';
    if (userText.includes('ticket') || userText.includes('human') || userText.includes('agent') || userText.includes('support team')) {
      content = `I will open a support ticket for you right away. Our team will review this chat transcript and revert to your email ${revertDuration}.`;
      return {
        content,
        recommended_product_ids: [],
        input_tokens: 50,
        output_tokens: 30,
        estimated_cost_usd: 0.0001,
        should_escalate_ticket: true,
        ticket_subject: 'Customer Support Request',
        ticket_reason: 'Customer requested support ticket or human help',
      };
    }

    if (userText.includes('whatsapp')) {
      if (whatsappPill?.url) {
        content += `You can reach our team directly on WhatsApp here: ${whatsappPill.url}. We are here to assist you!`;
      } else {
        content += `You can reach our store support team at ${context.assistantSettings.support_contact || 'support'}.`;
      }
      return { content, recommended_product_ids: [], input_tokens: 50, output_tokens: 30, estimated_cost_usd: 0.0001 };
    }

    // Simple mock logic: recommend products if they match a word in the user's message
    if (context.catalogSubset.length > 0) {
      const matches = context.catalogSubset.filter((p) => {
        const cat = p.category ? p.category.toLowerCase().trim() : '';
        const titleFirst = p.title ? p.title.toLowerCase().trim().split(' ')[0] : '';
        return (cat.length > 2 && userText.includes(cat)) || (titleFirst.length > 2 && userText.includes(titleFirst));
      });

      if (isGreeting && matches.length > 0 && !userText.includes('looking for') && !userText.includes('show') && !userText.includes('find') && !userText.includes('dress') && !userText.includes('top')) {
        content += `How can I help you today? Feel free to ask about our collections, sizing, or store recommendations!`;
        recommendedIds = [];
      } else if (matches.length > 0) {
        content += `I found some great options for you based on our catalog:`;
        recommendedIds = matches.slice(0, 4).map((m) => m.id);
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

  async generateStructuredJson<T>(
    prompt: string,
    schema: any,
    options?: any
  ): Promise<{ data: T; input_tokens: number; output_tokens: number; estimated_cost_usd: number; model: string }> {
    const p = prompt.toLowerCase();
    let rawResult: any;

    if (p.includes('store_analysis') || p.includes('health_score')) {
      rawResult = {
        summary: 'Store shows steady organic traffic with strong catalog breadth. Conversion from product view to cart is the primary bottleneck.',
        health_score: 78,
        strengths: [
          'Strong catalog breadth across sustainable categories',
          'High customer repeat interest in replenishment goods',
          'Effective attribution tracking active on incoming campaigns'
        ],
        problems: [
          'Product view to add-to-cart conversion rate is below benchmark',
          '3 product listings have missing or generic benefit descriptions',
          'Cart abandonment recovery sequences are unconfigured for WhatsApp'
        ],
        opportunities: [
          'Bundle replenishable items with a 10% auto-reorder discount',
          'Activate multi-channel email and WhatsApp abandoned cart recovery',
          'Enrich top-viewed product descriptions with customer FAQ tabs'
        ],
        priority_actions: [
          {
            title: 'Enrich Top 3 Product Descriptions',
            explanation: 'High traffic products lack clear benefit bullet points, causing shopper hesitation.',
            impact: 'high',
            priority: 'p1',
            affected_area: 'Catalogue',
            supporting_metric: '32% view drop-off',
            suggested_action: 'Review product copy suggestions and apply improved listings.'
          },
          {
            title: 'Enable WhatsApp Abandoned Cart Sequence',
            explanation: 'WhatsApp reminders have significantly higher open rates than email alone.',
            impact: 'high',
            priority: 'p2',
            affected_area: 'Marketing',
            supporting_metric: '68% cart abandonment rate',
            suggested_action: 'Activate WhatsApp abandoned cart recovery in WhatsApp settings.'
          }
        ],
        catalogue_issues: [
          'Product descriptions lack structured sizing tables',
          'Missing high-resolution lifestyle images on secondary variants'
        ],
        conversion_issues: [
          'Checkout drop-off between cart review and shipping confirmation'
        ],
        marketing_issues: [
          'Paid ad spend concentrated on low-converting generic keywords'
        ],
        revenue_opportunities: [
          {
            title: 'Automated 30-Day Reorder Sequence',
            estimated_monthly_impact_usd: 420.00,
            rationale: 'Replenishable consumables see up to 28% repeat purchase conversion.',
            action: 'Enable smart reorder for top consumable products.'
          }
        ]
      };
    } else if (p.includes('overview_insights') || p.includes('what_is_happening')) {
      rawResult = {
        what_is_happening: 'Traffic volume is stable, but checkout completion rate dropped slightly this week.',
        why_it_is_happening: 'Shoppers are adding items to cart but dropping off during shipping cost review.',
        what_to_do_next: 'Test a prominent free delivery progress bar on the cart drawer.',
        biggest_opportunity: {
          title: 'Free Delivery Threshold Banner',
          description: 'Offering a clear £50 free delivery threshold incentivizes larger basket sizes.',
          action: 'Configure Cart Threshold',
          target_tab: 'overview'
        },
        biggest_problem: {
          title: 'Product-Page Drop-Off',
          description: 'Product pages have high dwell time but low add-to-cart clicks.',
          action: 'Review Listings',
          target_tab: 'catalogue'
        },
        revenue_opportunity: 'Estimated £850/mo potential from abandoned cart recovery optimization.',
        customer_opportunity: 'Engage 120 repeat buyers with personalized replenishment reminders.',
        catalogue_opportunity: '5 listings can be upgraded with AI benefit bullet points.',
        marketing_opportunity: 'Scale Meta ad campaign "summer_sale" which is delivering 3.4x ROAS.'
      };
    } else if (p.includes('catalogue_analysis') || p.includes('listing_quality_score')) {
      rawResult = {
        overview_summary: 'Catalogue is well-structured. Main improvement area is adding structured selling points and customer FAQs to product pages.',
        average_listing_score: 76,
        products: [
          {
            product_id: 'prod_1',
            title: 'Sample Product',
            listing_quality_score: 74,
            problems: [
              'Missing benefit explanation in top description fold',
              'Description is too generic without care instructions'
            ],
            suggestions: {
              improved_title: 'Premium Handcrafted Everyday Essential — Comfort & Longevity',
              improved_description: 'Designed for durability and timeless comfort, this piece brings together authentic materials and clean design for your everyday wardrobe.',
              selling_points: [
                '100% Certified Organic & Plastic-Free',
                'Reinforced stitching for everyday durability',
                'Comfort-tested and pre-washed to prevent shrinkage'
              ],
              faq_suggestions: [
                { question: 'What is the sizing fit?', answer: 'True to size with a comfortable modern fit.' },
                { question: 'How do I care for this product?', answer: 'Machine wash cold and air dry for best longevity.' }
              ],
              recommendation_tags: ['everyday', 'sustainable', 'comfort', 'essential']
            },
            recommendation_suitability: 'high',
            conversion_risk: 'Moderate risk due to missing sizing guidance.'
          }
        ]
      };
    } else if (p.includes('product_improvements') || p.includes('improved_title')) {
      rawResult = {
        improved_title: 'Premium Handcrafted Everyday Essential — Comfort & Longevity',
        improved_description: 'Designed for durability and timeless comfort, this piece brings together authentic materials and clean design for your everyday wardrobe.',
        selling_points: [
          '100% Certified Organic & Plastic-Free',
          'Reinforced stitching for everyday durability',
          'Comfort-tested and pre-washed to prevent shrinkage'
        ],
        faq_suggestions: [
          { question: 'What is the sizing fit?', answer: 'True to size with a comfortable modern fit.' },
          { question: 'How do I care for this product?', answer: 'Machine wash cold and air dry for best longevity.' }
        ],
        recommendation_tags: ['everyday', 'sustainable', 'comfort', 'essential']
      };
    } else if (p.includes('funnel_analysis') || p.includes('top_bottlenecks') || p.includes('biggest_drop_off')) {
      rawResult = {
        executive_summary: 'Strong top-of-funnel discovery, with major drop-off occurring between product view and add-to-cart.',
        top_bottlenecks: [
          {
            stage: 'Product Page to Cart',
            drop_off_rate_percent: 72,
            friction_points: ['Lack of instant shipping cost visibility', 'Missing sizing reassurance'],
            hypothesized_cause: 'Shoppers view products but hesitate due to unexpected shipping fees at checkout.',
            recommended_fix: 'Display free shipping threshold banner and sticky mobile Add to Cart button.',
            priority: 'high',
          }
        ],
        overall_health: 'concerning',
        suggested_actions: [
          'Add a prominent sticky Add to Cart bar on mobile view',
          'Display free shipping threshold (£50) directly under the product price',
          'Highlight customer review star ratings next to the product title'
        ]
      };
    } else if (p.includes('funnel_ask') || p.includes('funnel question')) {
      rawResult = {
        answer: 'Checkout conversion is influenced heavily by delivery fee surprises at the final step. Visitors from paid channels show 1.8x higher bounce on shipping selection.',
        supporting_metrics: {
          cart_abandonment_rate: '68%',
          checkout_drop_off: '42%',
          top_exit_page: '/checkout/shipping'
        },
        suggested_actions: [
          'Display clear shipping rates directly on the cart page',
          'Enable guest checkout to streamline mobile conversions'
        ]
      };
    } else if (p.includes('ad_analysis') || p.includes('what_is_working')) {
      rawResult = {
        has_ad_data: true,
        overview_summary: 'Paid campaigns demonstrate healthy 2.8x blended ROAS, led by retargeting and high-intent product creatives.',
        what_is_working: [
          'Meta retargeting ad set delivering 3.8x ROAS on abandoned cart audiences',
          'Product catalog dynamic ads showing low cost-per-acquisition (£14.20)'
        ],
        what_is_not: [
          'Broad interest prospecting campaign running at 0.9x ROAS',
          'Single image creatives have higher fatigue than short video demonstrations'
        ],
        why_it_happens: [
          'Broad audiences are landing on generic collection pages rather than specific PDPs',
          'High mobile bounce rate on slow-loading external landing pages'
        ],
        what_to_test_next: [
          'Shift 25% of prospecting budget into Lookalike 1% purchase audiences',
          'Test video UGC hooks comparing product durability against competitors'
        ],
        recommendations: [
          {
            campaign_or_channel: 'Meta Retargeting — Cart Abandoners',
            suggestion: 'Increase daily budget by 20% to capture high-intent recovery buyers.',
            impact: 'scale'
          },
          {
            campaign_or_channel: 'Meta Prospecting — Broad Interest',
            suggestion: 'Pause underperforming generic lifestyle ad creatives.',
            impact: 'reduce'
          }
        ]
      };
    } else if (p.includes('ad_ask') || p.includes('ad question')) {
      rawResult = {
        answer: 'Your strongest return is generated by Meta retargeting campaigns targeting shoppers who added to cart within the past 14 days, achieving 3.8x ROAS.',
        supporting_metrics: {
          blended_roas: 2.8,
          best_campaign_roas: 3.8,
          total_ad_spend_tracked: 450.0
        },
        suggested_actions: [
          'Scale budget on top-performing retargeting ads by 15%',
          'A/B test urgency hooks for visitors who viewed products 3+ times'
        ]
      };
    } else if (p.includes('email_generation') || p.includes('email_type')) {
      rawResult = {
        subject: 'We saved your favorites — Ready when you are ✨',
        preview_text: 'Complete your order today with fast, tracked shipping.',
        body: 'Hi there,\n\nWe noticed you left some great items in your cart. Quality essentials move fast, so we wanted to make sure your picks stay reserved for you.\n\nTake another look and enjoy our hassle-free 30-day return guarantee when you check out today.',
        cta: 'Complete Your Order',
        alternative_subjects: [
          'Still thinking about your cart? Here is your link 🛒',
          'Don’t miss out: Your reserved items are waiting',
          'A quick reminder from London Eco Apparel'
        ]
      };
    } else if (p.includes('reorder_recommendation') || p.includes('consumable')) {
      rawResult = {
        recommendations: [
          {
            product_id: 'prod_coffee_1',
            title: 'Organic Single-Origin Coffee Beans (250g)',
            suggested_cycle_days: 28,
            rationale: 'Daily consumable beverage typically finished within 3-4 weeks.',
            estimated_repeat_rate_increase: '+24%'
          },
          {
            product_id: 'prod_skincare_1',
            title: 'Hydrating Botanical Face Serum (50ml)',
            suggested_cycle_days: 45,
            rationale: 'Daily skincare regimen item with predictable 6-week depletion cycle.',
            estimated_repeat_rate_increase: '+18%'
          }
        ]
      };
    } else if (p.includes('copilot_ask') || p.includes('growth copilot')) {
      rawResult = {
        answer: 'Based on your store analytics over the past 30 days, your primary revenue growth opportunity is activating automated abandoned cart recovery on WhatsApp. Visitors are adding items to cart, but 68% leave without completing checkout.',
        metrics: {
          cart_abandonment_rate: '68%',
          potential_monthly_recovery: '£540.00',
          current_email_recovery_rate: '14.2%'
        },
        suggested_actions: [
          {
            title: 'Enable WhatsApp Cart Recovery',
            action_type: 'configure_channel',
            target_module: 'whatsapp'
          },
          {
            title: 'Add Free Shipping Progress Bar',
            action_type: 'customize_widget',
            target_module: 'widget'
          }
        ]
      };
    } else {
      // Generic fallback matching schema
      rawResult = {
        summary: 'Analysis completed successfully based on verified store telemetry.',
        health_score: 80,
        strengths: ['High catalogue relevance', 'Strong brand positioning'],
        problems: ['Mobile drop-off higher than desktop'],
        opportunities: ['Email sequence optimization'],
        priority_actions: [
          {
            title: 'Review Conversion Opportunities',
            explanation: 'Store metrics indicate high interest with potential for recovery lift.',
            impact: 'medium',
            priority: 'p2',
            affected_area: 'Overview',
            supporting_metric: '80% health score',
            suggested_action: 'Examine detailed analytics across modules.'
          }
        ],
        catalogue_issues: [],
        conversion_issues: [],
        marketing_issues: [],
        revenue_opportunities: []
      };
    }

    const validated = schema.parse ? schema.parse(rawResult) : rawResult;

    return {
      data: validated as T,
      input_tokens: 300,
      output_tokens: 200,
      estimated_cost_usd: 0.0002,
      model: 'mock-gpt-4o-mini',
    };
  }

  async generateText(
    prompt: string,
    options?: any
  ): Promise<{ text: string; input_tokens: number; output_tokens: number; estimated_cost_usd: number; model: string }> {
    return {
      text: `Mock AI response for: "${prompt.slice(0, 60)}..." based on store data.`,
      input_tokens: 100,
      output_tokens: 50,
      estimated_cost_usd: 0.0001,
      model: 'mock-gpt-4o-mini',
    };
  }
}

