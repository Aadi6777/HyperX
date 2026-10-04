/**
 * HyperX Phase 8: End-to-End Encryption Engine
 * Client-side AES-256-GCM + PBKDF2 key derivation and SHA-256 integrity verification.
 */

export interface EncryptedPayload {
  iv: number[]; // 12-byte IV serialized for transmission
  data: ArrayBuffer;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a human-readable passphrase using PBKDF2.
 */
export async function deriveKeyFromSecret(secret: string, saltString = 'hyperx-p2p-salt-2026'): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(saltString),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a chunk using AES-256-GCM with a fresh 12-byte initialization vector.
 */
export async function encryptChunk(chunkData: ArrayBuffer, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    chunkData
  );

  return {
    iv: Array.from(iv),
    data: cipherBuffer,
  };
}

/**
 * Decrypt a chunk using AES-256-GCM with its original IV.
 * Throws an error on decryption failure (e.g. wrong key, corrupted ciphertext).
 */
export async function decryptChunk(cipherData: ArrayBuffer, ivArray: number[], key: CryptoKey): Promise<ArrayBuffer> {
  const iv = new Uint8Array(ivArray);
  return window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    cipherData
  );
}

/**
 * Compute SHA-256 hexadecimal hash string for an ArrayBuffer.
 */
export async function computeSha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute the Merkle/Manifest root SHA-256 hash over an array of sequential chunk hashes.
 * Ensures whole-file end-to-end cryptographic integrity without loading 50GB into RAM at once.
 */
export async function computeManifestRootHash(chunkHashes: string[]): Promise<string> {
  const enc = new TextEncoder();
  const concatenated = chunkHashes.join(':');
  const buffer = enc.encode(concatenated).buffer;
  return computeSha256(buffer);
}

/**
 * Generates a cryptographically strong, human-shareable random passphrase.
 */
export function generateSecurePassphrase(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const array = new Uint8Array(16);
  window.crypto.getRandomValues(array);
  const code = Array.from(array, byte => chars[byte % chars.length]).join('');
  return `${code.substring(0, 4)}-${code.substring(4, 8)}-${code.substring(8, 12)}-${code.substring(12, 16)}`;
}
