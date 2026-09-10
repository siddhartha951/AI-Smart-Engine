import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Ensures a 32-byte key is derived from the ENCRYPTION_KEY environment variable.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || 'default-insecure-test-key-32-chars';
  // Pad or truncate to 32 bytes to ensure AES-256 compatibility
  const key = Buffer.alloc(32);
  Buffer.from(secret, 'utf-8').copy(key);
  return key;
}

export interface EncryptedData {
  encryptedString: string;
  iv: string;
}

/**
 * Encrypts a string using AES-256-GCM.
 * @param text The plain text to encrypt.
 * @returns Object containing the hex string of IV + Encrypted Data + Auth Tag, and the IV alone for database storage.
 */
export function encryptString(text: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: ivHex.encryptedText.authTag
  const ivHex = iv.toString('hex');
  const encryptedString = `${ivHex}.${encrypted}.${authTag}`;
  
  return {
    encryptedString,
    iv: ivHex
  };
}

/**
 * Decrypts a string that was encrypted with AES-256-GCM.
 * @param encryptedString The combined encrypted text and auth tag (e.g., 'encryptedText.authTag')
 * @param ivHex The hex representation of the initialization vector
 * @returns The decrypted plain text
 */
export function decryptString(encryptedString: string, legacyIvHex?: string): string {
  const key = getEncryptionKey();
  
  const parts = encryptedString.split('.');
  
  let iv: Buffer;
  let encryptedHex: string;
  let authTagHex: string;

  if (parts.length === 3) {
    // New format: iv.encryptedText.authTag
    iv = Buffer.from(parts[0], 'hex');
    encryptedHex = parts[1];
    authTagHex = parts[2];
  } else if (parts.length === 2 && legacyIvHex) {
    // Legacy format: encryptedText.authTag (needs legacyIvHex)
    iv = Buffer.from(legacyIvHex, 'hex');
    encryptedHex = parts[0];
    authTagHex = parts[1];
  } else {
    throw new Error('Invalid encrypted string format or missing IV.');
  }

  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
