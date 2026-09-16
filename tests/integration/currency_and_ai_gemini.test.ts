import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { getDatabaseClient } from '../../src/database/client';
import { getAiProvider, GeminiAiProvider, OpenAiProvider, MockAiProvider } from '../../src/providers/ai';
import {
  EmailGenerationResultSchema,
  CopilotAskSchema,
  CopilotActionSchema,
  CatalogueAnalysisSchema,
  CatalogueProductAnalysisSchema,
} from '../../src/modules/ai/ai-types';
import { extractAndParseJson } from '../../src/providers/ai/ai.utils';
import { resetEnvConfig } from '../../src/config/env';
import jwt from 'jsonwebtoken';

describe('Store Currency & AI Providers Integration', () => {
  const db = getDatabaseClient();
  let adminToken: string;
  let merchantToken: string;
  let testStoreId: string;
  let testMerchantId: string;

  beforeEach(async () => {
    resetEnvConfig();
  });

  it('resiliently extracts and parses JSON even with markdown code blocks and trailing banter', () => {
    const rawMarkdown = '```json\n{"message": "Hello world", "recommended_product_ids": ["p1"]}\n```';
    const parsed = extractAndParseJson<{ message: string; recommended_product_ids: string[] }>(rawMarkdown);
    expect(parsed.message).toBe('Hello world');
    expect(parsed.recommended_product_ids).toEqual(['p1']);

    const banterJson = 'Here is the requested data:\n{"title": "Organic Tea", "price": "12.50"}\nHope this helps!';
    const parsedBanter = extractAndParseJson<{ title: string; price: string }>(banterJson);
    expect(parsedBanter.title).toBe('Organic Tea');
  });

  it('resiliently parses EmailGenerationResultSchema even when LLM uses call_to_action or button_text', () => {
    const rawEmailOutput = {
      subject_line: 'Exclusive Flash Sale!',
      button_text: 'Shop Sale Now',
      body: 'Get 20% off on all premium items.',
      preview: 'Limited time offers inside.',
      alternatives: ['Hurry, sale ends soon!'],
    };

    const validated = EmailGenerationResultSchema.parse(rawEmailOutput);
    expect(validated.subject).toBe('Exclusive Flash Sale!');
    expect(validated.cta).toBe('Shop Sale Now');
    expect(validated.preview_text).toBe('Limited time offers inside.');
    expect(validated.alternative_subjects).toEqual(['Hurry, sale ends soon!']);
  });

  it('resiliently parses CopilotAskSchema and CopilotActionSchema with varied keys', () => {
    const rawCopilotOutput = {
      response: 'Your sales have increased by 25% this week.',
      data: { revenue: 1500, orders: 40 },
      recommendations: [
        { name: 'Launch Retargeting Campaign', type: 'ad_scale', module: 'ad-creative' },
      ],
    };

    const validated = CopilotAskSchema.parse(rawCopilotOutput);
    expect(validated.answer).toBe('Your sales have increased by 25% this week.');
    expect(validated.metrics).toEqual({ revenue: 1500, orders: 40 });
    expect(validated.suggested_actions.length).toBe(1);
    expect(validated.suggested_actions[0].title).toBe('Launch Retargeting Campaign');
    expect(validated.suggested_actions[0].action_type).toBe('ad_scale');
    expect(validated.suggested_actions[0].target_module).toBe('ad-creative');
  });

  it('resiliently parses CatalogueAnalysisSchema with score strings and enum casings', () => {
    const rawCatalogueOutput = {
      overview_summary: 'Healthy catalog with 5 items.',
      average_listing_score: '82.5',
      products: [
        {
          product_id: 'prod-1',
          title: 'Silk Scarf',
          listing_quality_score: '90',
          recommendation_suitability: 'HIGH',
          problems: ['Needs higher resolution lifestyle image'],
          suggestions: {
            title: 'Refined Silk Scarf',
            description: 'Luxury handcrafted silk scarf.',
            tags_to_add: ['silk', 'fashion'],
            pricing_recommendation: 'Optimal',
          },
        },
      ],
    };

    const validated = CatalogueAnalysisSchema.parse(rawCatalogueOutput);
    expect(validated.average_listing_score).toBe(82.5);
    expect(validated.products[0].listing_quality_score).toBe(90);
    expect(validated.products[0].recommendation_suitability).toBe('high');
  });

  it('getAiProvider properly instantiates GeminiAiProvider when AI_PROVIDER is gemini or GEMINI_API_KEY is provided', () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    resetEnvConfig();
    const provider = getAiProvider();
    expect(provider).toBeInstanceOf(GeminiAiProvider);

    process.env.AI_PROVIDER = 'mock';
    delete process.env.GEMINI_API_KEY;
    resetEnvConfig();
    const mockProvider = getAiProvider();
    expect(mockProvider).toBeInstanceOf(MockAiProvider);
  });
});
