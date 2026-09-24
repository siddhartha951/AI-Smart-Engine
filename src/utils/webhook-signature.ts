import crypto from 'crypto';

/** Constant-time string comparison (false on length mismatch). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a Svix-signed webhook (used by Resend).
 * secret: "whsec_<base64>" from the Resend dashboard.
 */
export function verifySvixSignature(
  rawBody: Buffer | string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  toleranceSeconds = 300
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');

  // Header holds space-separated "v1,<sig>" entries (several during secret rotation)
  return signature.split(' ').some(part => {
    const [version, sig] = part.split(',');
    return version === 'v1' && Boolean(sig) && timingSafeEqualStr(sig, expected);
  });
}

/** Verifies Meta's X-Hub-Signature-256 ("sha256=<hex>") over the raw request body. */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return timingSafeEqualStr(header.slice(7), expected);
}
