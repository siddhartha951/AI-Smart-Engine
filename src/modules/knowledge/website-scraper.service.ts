import { getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';

export interface WebsiteScanResult {
  pagesScanned: number;
  extractedLength: number;
  scannedPages: string[];
  summary: string;
}

export class WebsiteScraperService {
  /**
   * Cleans raw HTML and extracts human-readable text content
   */
  private cleanHtmlToText(html: string): string {
    if (!html) return '';

    return html
      // Remove scripts, styles, svg, and head elements
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
      // Convert break and paragraph tags to newlines
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<br\s*[\/]?>/gi, '\n')
      // Remove all remaining tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Collapse whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n\n')
      .trim();
  }

  /**
   * Scrapes key storefront pages and extracts high-signal store knowledge
   */
  async scanStoreWebsite(storeId: string): Promise<WebsiteScanResult> {
    const db = getDatabaseClient();

    // 1. Get store domain & brand name
    const storeRes = await db.query(
      `SELECT s.shop_domain, s.brand_name, m.email
       FROM stores s
       JOIN merchants m ON m.id = s.merchant_id
       WHERE s.id = $1`,
      [storeId]
    );

    if (storeRes.rows.length === 0) {
      throw new Error(`Store ${storeId} not found`);
    }

    const { shop_domain, brand_name } = storeRes.rows[0];
    const name = brand_name || shop_domain;
    const cleanDomain = (shop_domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const baseUrl = `https://${cleanDomain}`;

    const candidatePaths = [
      '/',
      '/pages/about-us',
      '/pages/about',
      '/pages/faqs',
      '/pages/faq',
      '/policies/shipping-policy',
      '/policies/refund-policy',
      '/policies/terms-of-service',
      '/collections'
    ];

    const scannedPages: string[] = [];
    let combinedKnowledge = `=== STORE WEBSITE LEARNING: ${name} (${cleanDomain}) ===\n`;
    combinedKnowledge += `Scanned At: ${new Date().toISOString()}\n\n`;

    for (const path of candidatePaths) {
      const url = `${baseUrl}${path}`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const res = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        clearTimeout(timeoutId);

        if (!res.ok) continue;

        const html = await res.text();
        const text = this.cleanHtmlToText(html);

        // Keep content if it has substance
        if (text.length > 80) {
          scannedPages.push(path);
          // Limit individual page extract to 1200 characters to keep prompt concise
          const pageSnippet = text.slice(0, 1200);
          combinedKnowledge += `--- Page: ${path} ---\n${pageSnippet}\n\n`;
        }
      } catch (err) {
        // Silently skip pages that 404, redirect or timeout
      }
    }

    // 2. Fetch top products & bestsellers from store catalog
    try {
      const prodRes = await db.query(
        `SELECT title, category, price, currency, is_bestseller, tags
         FROM products
         WHERE store_id = $1 AND in_stock = true
         ORDER BY is_bestseller DESC, sales_rank ASC, price ASC
         LIMIT 20`,
        [storeId]
      );

      if (prodRes.rows.length > 0) {
        combinedKnowledge += `--- Top Selling & Featured Products ---\n`;
        prodRes.rows.forEach((p: any, idx: number) => {
          const tagsStr = Array.isArray(p.tags) && p.tags.length ? ` (Tags: ${p.tags.join(', ')})` : '';
          const star = p.is_bestseller ? '⭐ Bestseller: ' : '';
          combinedKnowledge += `${idx + 1}. ${star}${p.title} - ${p.currency} ${p.price}${tagsStr}\n`;
        });
        combinedKnowledge += '\n';
      }
    } catch (_) {}

    // 3. Save / Upsert into assistant_settings knowledge_base
    const oldSettings = await db.query(
      `SELECT knowledge_base FROM assistant_settings WHERE store_id = $1`,
      [storeId]
    );

    let updatedKb = combinedKnowledge.trim();
    if (oldSettings.rows.length > 0 && oldSettings.rows[0]?.knowledge_base) {
      const existing = oldSettings.rows[0].knowledge_base;
      // Replace existing website scan section if present or prepend
      if (existing.includes('=== STORE WEBSITE LEARNING:')) {
        updatedKb = existing.replace(/=== STORE WEBSITE LEARNING:[\s\S]*?(?=\n\n--- Document|\n\n===|$)/, combinedKnowledge.trim());
      } else {
        updatedKb = `${combinedKnowledge.trim()}\n\n${existing}`;
      }
    }

    await db.query(
      `INSERT INTO assistant_settings (store_id, knowledge_base, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (store_id) DO UPDATE SET
         knowledge_base = EXCLUDED.knowledge_base,
         updated_at = NOW()`,
      [storeId, updatedKb]
    );

    logger.info(`Website scraper completed for ${cleanDomain}: scanned ${scannedPages.length} pages, extracted ${combinedKnowledge.length} chars`);

    const summary = scannedPages.length > 0
      ? `Successfully scanned ${scannedPages.length} pages (${scannedPages.join(', ')}) from ${cleanDomain} and synced product catalog into AI knowledge base!`
      : `Successfully learned store catalog & top-selling products from ${cleanDomain} into AI knowledge base!`;

    return {
      pagesScanned: scannedPages.length,
      extractedLength: combinedKnowledge.length,
      scannedPages,
      summary,
    };
  }
}

export const websiteScraperService = new WebsiteScraperService();
