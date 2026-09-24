/**
 * Product variants (pack size, colour, size...) normalised from the three Shopify
 * sources (Admin GraphQL, Admin REST, Storefront GraphQL) into one compact shape
 * that is stored on products.variants / products.variant_options and sent to the widget.
 */

export interface ProductVariant {
  id: string; // numeric Shopify variant id (what /cart/add.js expects)
  title: string;
  price: number;
  compare_at_price: number;
  available: boolean;
  options: Record<string, string>; // { "Pack": "Pack of 3" } / { "Color": "Navy", "Size": "M" }
  image_url?: string;
}

export interface ProductOption {
  name: string;
  values: string[];
}

/** Variants kept per product: enough for any real picker, small enough for chat payloads. */
export const MAX_VARIANTS = 25;

function numericId(raw: unknown): string {
  const value = String(raw ?? '');
  return value.split('/').pop() || value;
}

function money(value: unknown): number {
  if (value && typeof value === 'object' && 'amount' in (value as any)) return parseFloat((value as any).amount) || 0;
  return parseFloat(String(value ?? '0')) || 0;
}

/** Shopify's placeholder for products without real options */
function isDefaultTitle(options: ProductOption[]): boolean {
  return options.length === 1 && options[0].values.length <= 1 && /^(title|default title)$/i.test(options[0].name);
}

function cleanOptions(options: ProductOption[]): ProductOption[] {
  const cleaned = options
    .filter(o => o && o.name)
    .map(o => ({ name: String(o.name), values: (o.values || []).map(String).filter(Boolean) }))
    .filter(o => o.values.length > 0);
  return isDefaultTitle(cleaned) ? [] : cleaned;
}

/** Admin GraphQL: node.variants.edges[].node with selectedOptions; node.options[] */
export function variantsFromAdminGraphql(node: any): { variants: ProductVariant[]; options: ProductOption[] } {
  const options = cleanOptions((node?.options || []).map((o: any) => ({ name: o.name, values: o.values })));
  const variants: ProductVariant[] = (node?.variants?.edges || []).slice(0, MAX_VARIANTS).map((e: any) => {
    const v = e.node || {};
    return {
      id: numericId(v.id),
      title: v.title || '',
      price: money(v.price),
      compare_at_price: money(v.compareAtPrice),
      available: v.availableForSale !== false,
      options: Object.fromEntries((v.selectedOptions || []).map((o: any) => [o.name, o.value])),
      ...(v.image?.url ? { image_url: v.image.url } : {}),
    };
  });
  return { variants: options.length ? variants : variants.slice(0, 1), options };
}

/** Storefront GraphQL has the same shape as Admin GraphQL, with money objects */
export const variantsFromStorefront = variantsFromAdminGraphql;

/** Admin REST: product.variants[] with option1..3 and product.options[] */
export function variantsFromAdminRest(p: any): { variants: ProductVariant[]; options: ProductOption[] } {
  const options = cleanOptions((p?.options || []).map((o: any) => ({ name: o.name, values: o.values })));
  const imagesById = new Map<string, string>((p?.images || []).map((img: any) => [String(img.id), img.src || img.url]));
  const variants: ProductVariant[] = (p?.variants || []).slice(0, MAX_VARIANTS).map((v: any) => {
    const selected: Record<string, string> = {};
    options.forEach((o, i) => {
      const value = v[`option${i + 1}`];
      if (value) selected[o.name] = String(value);
    });
    const available = v.available !== undefined
      ? v.available !== false
      : !(v.inventory_management && v.inventory_policy !== 'continue' && Number(v.inventory_quantity) <= 0);
    const image = v.image_id ? imagesById.get(String(v.image_id)) : undefined;
    return {
      id: numericId(v.id),
      title: v.title || '',
      price: money(v.price),
      compare_at_price: money(v.compare_at_price),
      available,
      options: selected,
      ...(image ? { image_url: image } : {}),
    };
  });
  return { variants: options.length ? variants : variants.slice(0, 1), options };
}

/** First variant that can be bought (falls back to the first one) */
export function defaultVariant(variants: ProductVariant[]): ProductVariant | undefined {
  return variants.find(v => v.available && v.price > 0) || variants[0];
}

/** Reads the JSONB columns from a products row (pg returns objects, pg-mem/legacy may return strings). */
export function parseVariantColumns(row: any): { variants: ProductVariant[]; options: ProductOption[] } {
  const parse = (value: unknown) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  return { variants: parse(row?.variants) as ProductVariant[], options: parse(row?.variant_options) as ProductOption[] };
}

/** One line per product for the AI prompt, e.g. "Pack of 1 ₹499 | Pack of 3 ₹1249 | Pack of 2 (sold out)" */
export function describeVariantsForAi(variants: ProductVariant[] | undefined, currency: string, max = 8): string {
  if (!variants || variants.length <= 1) return '';
  return variants.slice(0, max)
    .map(v => `${v.title || Object.values(v.options).join(' / ')} ${v.available ? `${currency} ${v.price}` : '(sold out)'}`)
    .join(' | ');
}
