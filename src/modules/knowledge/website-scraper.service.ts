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

    // 1. Get store domain
    const storeRes = await db.query(
      `SELECT s.shop_domain, s.name, m.email
       FROM stores s
       JOIN merchants m ON m.id = s.merchant_id
       WHERE s.id = $1`,
      [storeId]
    );

    if (storeRes.rows.length === 0) {
      throw new Error(`Store ${storeId} not found`);
    }

    const { shop_domain, name } = storeRes.rows[0];
    const baseUrl = `https://${shop_domain}`;

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
    let combinedKnowledge = `=== STORE WEBSITE LEARNING: ${name} (${shop_domain}) ===\n`;
    combinedKnowledge += `Scanned At: ${new Date().toISOString()}\n\n`;

    for (const path of candidatePaths) {
      const url = `${baseUrl}${path}`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI Smart Engine Ingestion Bot',
            'Accept': 'text/html,application/xhtml+xml',
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
        // Silently skip pages that 404 or timeout
      }
    }

    // 2. Fetch top products & bestsellers to summarize
    try {
      const prodRes = await db.query(
        `SELECT title, category, price, currency, is_bestseller, tags
         FROM products
         WHERE store_id = $1 AND in_stock = true
         ORDER BY is_bestseller DESC, sales_rank ASC, price ASC
         LIMIT 15`,
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

    // 3. Save into assistant_settings knowledge_base
    const oldSettings = await db.query(
      `SELECT knowledge_base FROM assistant_settings WHERE store_id = $1`,
      [storeId]
    );

    let updatedKb = combinedKnowledge.trim();
    if (oldSettings.rows.length > 0 && oldSettings.rows[0].knowledge_base) {
      const existing = oldSettings.rows[0].knowledge_base;
      // Replace existing website scan section if present or prepend
      if (existing.includes('=== STORE WEBSITE LEARNING:')) {
        updatedKb = existing.replace(/=== STORE WEBSITE LEARNING:[\s\S]*?(?=\n\n--- Document|\n\n===|$)/, combinedKnowledge.trim());
      } else {
        updatedKb = `${combinedKnowledge.trim()}\n\n${existing}`;
      }
    }

    await db.query(
      `UPDATE assistant_settings 
       SET knowledge_base = $1, updated_at = NOW() 
       WHERE store_id = $2`,
      [updatedKb, storeId]
    );

    logger.info(`Website scraper completed for ${shop_domain}: scanned ${scannedPages.length} pages, extracted ${combinedKnowledge.length} chars`);

    return {
      pagesScanned: scannedPages.length,
      extractedLength: combinedKnowledge.length,
      scannedPages,
      summary: `Successfully scanned ${scannedPages.length} pages (${scannedPages.join(', ')}) from ${shop_domain}. Knowledge base updated!`,
    };
  }
}

export const websiteScraperService = new WebsiteScraperService();
