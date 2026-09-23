import { describe, it, expect } from 'vitest';
import { WebsiteScraperService, websiteScraperService } from '../../src/modules/knowledge/website-scraper.service';

describe('WebsiteScraperService — AI Knowledge Synthesis & Crawling', () => {
  it('exports a singleton instance of WebsiteScraperService', () => {
    expect(websiteScraperService).toBeInstanceOf(WebsiteScraperService);
  });

  it('cleanHtmlToText extracts clean readable text from HTML markup', () => {
    const rawHtml = `
      <html>
        <head><title>My Pet Store</title><script>var x = 10;</script></head>
        <body>
          <header><nav><a href="/">Home</a></nav></header>
          <h1>Welcome to Aniwell Pets</h1>
          <p>We provide the best <strong>dermatology & nutrition</strong> care for dogs.</p>
          <div>Special price: &amp; free shipping over &#39;999&#39;</div>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;

    // Access private method for testing
    const text = (websiteScraperService as any).cleanHtmlToText(rawHtml);
    expect(text).toContain('Welcome to Aniwell Pets');
    expect(text).toContain('We provide the best dermatology & nutrition care for dogs.');
    expect(text).toContain('Special price: & free shipping over \'999\'');
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('var x = 10;');
    expect(text).not.toContain('<header>');
    expect(text).not.toContain('<footer>');
  });

  it('buildStructuredTemplate formats markdown sections with bestsellers, categories, and guidance', () => {
    const products = [
      {
        title: 'DermaPrex Skin Spray',
        price: 499,
        currency: 'INR',
        category: 'Skin Care',
        is_bestseller: true,
        tags: ['itch relief', 'dog skin'],
        description: 'Instant itch relief for sensitive pet coats'
      },
      {
        title: 'Puppy Daily Multivitamin',
        price: 799,
        currency: 'INR',
        category: 'Supplements',
        is_bestseller: false,
        tags: ['puppy', 'growth'],
        description: 'Comprehensive daily vitamins'
      }
    ];

    const snippets = [
      { path: '/policies/shipping-policy', text: 'Free standard shipping across India within 3-5 business days.' }
    ];

    const markdown = (websiteScraperService as any).buildStructuredTemplate(
      'Aniwell Pets',
      'aniwellpets.com',
      products,
      snippets
    );

    expect(markdown).toContain('# 🏢 Aniwell Pets - Store & Product Intelligence Knowledge Base');
    expect(markdown).toContain('⭐ Bestseller');
    expect(markdown).toContain('DermaPrex Skin Spray');
    expect(markdown).toContain('Free standard shipping across India');
    expect(markdown).toContain('## 5. 💡 Shopper Guidance Rules for AI Assistant');
  });
});
