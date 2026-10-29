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

// Pure JavaScript SHA-256 fallback for non-secure contexts (e.g. HTTP on mobile or LAN)
function jsSha256(data: ArrayBuffer): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f, 0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bytes = new Uint8Array(data);
  const l = bytes.length;
  const bitLen = l * 8;
  const newLen = ((l + 8) >> 6 << 6) + 64;
  const padded = new Uint8Array(newLen);
  padded.set(bytes);
  padded[l] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(newLen - 4, bitLen, false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < newLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * Compute SHA-256 hexadecimal hash string for an ArrayBuffer.
 * Seamlessly uses Web Crypto API in secure contexts, with an embedded pure JS fallback.
 */
export async function computeSha256(data: ArrayBuffer): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to JS fallback
    }
  }
  return jsSha256(data);
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
