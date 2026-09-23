import { getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';
import { getAiProvider } from '../../providers/ai';

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
   * Builds an ultra-clean, structured fallback Knowledge Base if AI synthesis is unavailable
   */
  private buildStructuredTemplate(
    name: string,
    cleanDomain: string,
    products: any[],
    pageSnippets: { path: string; text: string }[]
  ): string {
    let out = `# 🏢 ${name} - Store & Product Intelligence Knowledge Base\n\n`;
    out += `*Scanned & compiled on: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}*\n\n`;

    out += `## 1. 🏢 Store Overview & Brand Positioning\n`;
    out += `- **Store Name**: ${name}\n`;
    if (cleanDomain) out += `- **Website**: https://${cleanDomain}\n`;
    out += `- **Role**: Trusted online merchant providing top-tier products with dedicated customer support.\n\n`;

    if (products.length > 0) {
      const bestsellers = products.filter(p => p.is_bestseller);
      out += `## 2. 🔥 Top Selling & Flagship Products\n`;
      if (bestsellers.length > 0) {
        bestsellers.slice(0, 10).forEach((p, idx) => {
          const tags = Array.isArray(p.tags) && p.tags.length ? ` | Tags: ${p.tags.join(', ')}` : '';
          const desc = p.description ? ` - ${p.description.slice(0, 120)}...` : '';
          out += `${idx + 1}. **${p.title}** (⭐ Bestseller) - ${p.currency} ${p.price}${tags}${desc}\n`;
        });
      } else {
        products.slice(0, 10).forEach((p, idx) => {
          const tags = Array.isArray(p.tags) && p.tags.length ? ` | Tags: ${p.tags.join(', ')}` : '';
          out += `${idx + 1}. **${p.title}** - ${p.currency} ${p.price}${tags}\n`;
        });
      }
      out += `\n`;

      out += `## 3. 🛍️ Product Catalog & Collections (${products.length} catalog items loaded)\n`;
      const categories: { [cat: string]: string[] } = {};
      products.forEach(p => {
        const cat = p.category || 'General Collection';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(`${p.title} (${p.currency} ${p.price})`);
      });

      for (const [cat, items] of Object.entries(categories)) {
        out += `### ${cat}\n`;
        out += items.slice(0, 6).map(i => `- ${i}`).join('\n') + '\n\n';
      }
    }

    if (pageSnippets.length > 0) {
      out += `## 4. 🌐 Store Policies & Website Information\n`;
      for (const { path, text } of pageSnippets) {
        let label = path;
        if (path === '/') label = 'Homepage & Brand Story';
        else if (path.includes('shipping')) label = 'Shipping & Delivery Policy';
        else if (path.includes('refund') || path.includes('return')) label = 'Refund & Exchange Policy';
        else if (path.includes('about')) label = 'About Our Brand';
        else if (path.includes('faq')) label = 'Frequently Asked Questions';
        else if (path.includes('terms')) label = 'Terms of Service';

        out += `### 📄 ${label} (\`${path}\`)\n`;
        out += `${text.slice(0, 800)}\n\n`;
      }
    }

    out += `## 5. 💡 Shopper Guidance Rules for AI Assistant\n`;
    out += `- Always recommend best-selling flagship items first when shoppers ask for recommendations.\n`;
    out += `- Provide exact prices with currency when mentioning products.\n`;
    out += `- Be courteous, enthusiastic, and direct shoppers to the product links or checkout.\n`;

    return out.trim();
  }

  /**
   * Scrapes key storefront pages, gathers catalog intelligence,
   * and runs AI synthesis to generate a rich, structured Knowledge Base.
   */
  async scanStoreWebsite(storeId: string): Promise<WebsiteScanResult> {
    const db = getDatabaseClient();

    // 1. Get store domain & brand name (no merchants join to prevent schema mismatch)
    const storeRes = await db.query(
      `SELECT shop_domain, brand_name
       FROM stores
       WHERE id = $1`,
      [storeId]
    );

    if (storeRes.rows.length === 0) {
      throw new Error(`Store ${storeId} not found`);
    }

    const { shop_domain, brand_name } = storeRes.rows[0];
    const name = (brand_name || shop_domain || 'Our Store').trim();
    const cleanDomain = (shop_domain || '').replace(/^https?:\/\//i, '').replace(/\/+.*$/, '').trim();
    const baseUrl = cleanDomain ? `https://${cleanDomain}` : '';

    const candidatePaths = [
      '/',
      '/pages/about-us',
      '/pages/about',
      '/pages/contact-us',
      '/pages/contact',
      '/pages/faqs',
      '/pages/faq',
      '/policies/shipping-policy',
      '/policies/refund-policy',
      '/policies/terms-of-service',
      '/collections'
    ];

    const scannedPages: string[] = [];
    const pageSnippets: { path: string; text: string }[] = [];

    // Only crawl if domain is present
    if (baseUrl) {
      for (const path of candidatePaths) {
        const url = `${baseUrl}${path}`;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
            pageSnippets.push({
              path,
              text: text.slice(0, 1400)
            });
          }
        } catch (_) {
          // Silently skip pages that 404, redirect or timeout
        }
      }
    }

    // 2. Fetch top products & bestsellers from store catalog
    let products: any[] = [];
    try {
      const prodRes = await db.query(
        `SELECT title, description, category, price, currency, is_bestseller, sales_rank, tags
         FROM products
         WHERE store_id = $1 AND (in_stock = true OR in_stock IS NULL)
         ORDER BY is_bestseller DESC, sales_rank ASC NULLS LAST, created_at DESC
         LIMIT 35`,
        [storeId]
      );
      products = prodRes.rows;
    } catch (catalogErr: any) {
      logger.warn(`Could not load products for store ${storeId}: ${catalogErr?.message || catalogErr}`);
    }

    // 3. AI-Powered Knowledge Synthesis
    let synthesizedKnowledge = '';
    const aiProvider = getAiProvider();

    // Prepare catalog context for AI
    let catalogSummary = 'No products synced yet.';
    if (products.length > 0) {
      catalogSummary = products.map((p, i) => {
        const best = p.is_bestseller ? ' [⭐ BESTSELLER]' : '';
        const tags = Array.isArray(p.tags) && p.tags.length ? ` | Tags: ${p.tags.join(', ')}` : '';
        const desc = p.description ? ` | Info: ${p.description.slice(0, 100)}` : '';
        return `${i + 1}.${best} ${p.title} - ${p.currency} ${p.price} (${p.category || 'General'})${tags}${desc}`;
      }).join('\n');
    }

    // Prepare page snippets for AI
    const scrapedTextSummary = pageSnippets.length > 0
      ? pageSnippets.map(p => `--- PAGE: ${p.path} ---\n${p.text}`).join('\n\n')
      : 'No external website pages were reachable; synthesizing intelligence from brand identity and verified product catalog.';

    const systemPrompt = `You are an elite E-Commerce AI Knowledge Architect. Your job is to transform raw storefront crawled pages, brand details, and catalog products into an authoritative, structured, and high-impact Knowledge Base for an AI shopping concierge.`;

    const userPrompt = `
Analyze the following store information for brand "${name}" (Domain: ${cleanDomain || 'N/A'}):

=== CRAWLED STORE WEBSITE PAGES (${pageSnippets.length} pages captured) ===
${scrapedTextSummary}

=== VERIFIED STORE PRODUCT CATALOG (${products.length} products) ===
${catalogSummary}

Generate an ultra-clean, structured, and comprehensive Knowledge Base in Markdown format that the AI shopping concierge will use to answer customer questions accurately.

Include these exact 5 structured sections with clear headings:
# 🏢 BRAND IDENTITY & STORE OVERVIEW
- Core brand story, mission, and unique value proposition (USP)
- Brand tone of voice (e.g. friendly, empathetic, expert, premium)

# 🔥 FLAGSHIP & BEST SELLING PRODUCTS
- Highlight top best-selling products, exact prices, key benefits, and who they are best suited for
- Why customers should choose them

# 🛍️ PRODUCT CATEGORIES & PROBLEM SOLVING GUIDE
- Categorize the products by customer problem or goal
- Clear recommendation rules for the AI assistant

# 🚚 SHIPPING, DELIVERY & RETURN POLICIES
- Standard delivery timelines, shipping charges/free shipping threshold, and return/exchange policy rules (from crawled policies or realistic standards for ${name})

# ❓ FREQUENTLY ASKED QUESTIONS (FAQs) & OBJECTION HANDLING
- 5 to 7 most critical customer questions with clear, reassuring answers

Format cleanly in Markdown. Do not include triple backtick code blocks around the entire output.
`;

    try {
      logger.info(`Running AI Knowledge Synthesis for store ${storeId} (${name})...`);
      const aiResult = await aiProvider.generateText(userPrompt, {
        systemPrompt,
        temperature: 0.3,
        storeId,
      });

      const responseText = (aiResult?.text || '').trim();
      // Ensure AI did not return a generic mock placeholder
      if (responseText.length > 250 && !responseText.includes('Mock AI response for:')) {
        synthesizedKnowledge = responseText;
        logger.info(`AI Knowledge Synthesis completed successfully (${synthesizedKnowledge.length} chars)`);
      } else {
        logger.info('AI returned placeholder/short response; falling back to structured template');
        synthesizedKnowledge = this.buildStructuredTemplate(name, cleanDomain, products, pageSnippets);
      }
    } catch (aiErr: any) {
      logger.warn(`AI Knowledge Synthesis fallback triggered: ${aiErr?.message || aiErr}`);
      synthesizedKnowledge = this.buildStructuredTemplate(name, cleanDomain, products, pageSnippets);
    }

    // 4. Save / Upsert into assistant_settings knowledge_base
    const oldSettings = await db.query(
      `SELECT knowledge_base FROM assistant_settings WHERE store_id = $1`,
      [storeId]
    );

    let updatedKb = synthesizedKnowledge.trim();
    if (oldSettings.rows.length > 0 && oldSettings.rows[0]?.knowledge_base) {
      const existing = oldSettings.rows[0].knowledge_base.trim();
      // If merchant has custom manual notes (like "--- Document..." or "--- Custom..."), preserve them
      const customNotesMatch = existing.match(/--- (?:Document|Custom|Manual)[\s\S]*/i);
      if (customNotesMatch) {
        updatedKb = `${synthesizedKnowledge.trim()}\n\n${customNotesMatch[0]}`;
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

    logger.info(`Website scraper completed for ${name}: scanned ${scannedPages.length} pages, products: ${products.length}, kb length: ${updatedKb.length}`);

    let summary = '';
    if (scannedPages.length > 0 && products.length > 0) {
      summary = `Successfully scanned ${scannedPages.length} website pages (${scannedPages.slice(0, 4).join(', ')}) and analyzed ${products.length} products to build the AI Knowledge Base!`;
    } else if (products.length > 0) {
      summary = `Successfully analyzed ${products.length} store catalog products and bestsellers into the structured AI Knowledge Base!`;
    } else if (scannedPages.length > 0) {
      summary = `Successfully crawled ${scannedPages.length} store website pages into the AI Knowledge Base!`;
    } else {
      summary = `AI Knowledge Base successfully synthesized and saved for ${name}!`;
    }

    return {
      pagesScanned: scannedPages.length,
      extractedLength: updatedKb.length,
      scannedPages,
      summary,
    };
  }
}

export const websiteScraperService = new WebsiteScraperService();
