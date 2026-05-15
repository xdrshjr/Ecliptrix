/**
 * Tiny synchronous SHA-256 used for client-side PII hashing of userIds.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase4/spec.md §3.2.5 / INV11.
 *
 * We can't await ``crypto.subtle.digest`` inside the telemetry SDK
 * constructor (callers expect a sync interface) and the project bans
 * new dependencies in Phase 4, so this is a hand-rolled, allocation-light
 * implementation. ~80 LOC; covered by playback/__tests__/telemetry.pii.test.ts.
 *
 * Not security-critical: hashing here just stops raw userIds from
 * leaving the client. A 12-hex prefix collision is acceptable for the
 * dogfood phase (see spec §R-P2-6).
 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function _rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function _toBytes(input: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input);
  }
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    bytes[i] = input.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export function sha256Hex(input: string): string {
  const bytes = _toBytes(input);
  const bitLen = bytes.length * 8;
  // Pad: 1 bit, then zeros, then 8-byte big-endian length.
  const padLen = ((bytes.length + 9 + 63) & ~63) - bytes.length;
  const padded = new Uint8Array(bytes.length + padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // Length in bits, big-endian; we only support length < 2^32 bits.
  padded[padded.length - 4] = (bitLen >>> 24) & 0xff;
  padded[padded.length - 3] = (bitLen >>> 16) & 0xff;
  padded[padded.length - 2] = (bitLen >>> 8) & 0xff;
  padded[padded.length - 1] = bitLen & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array<number>(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t += 1) {
      const o = i + t * 4;
      w[t] =
        ((padded[o] << 24) |
          (padded[o + 1] << 16) |
          (padded[o + 2] << 8) |
          padded[o + 3]) >>>
        0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = _rotr(w[t - 15], 7) ^ _rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = _rotr(w[t - 2], 17) ^ _rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t += 1) {
      const S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Hash a userId for telemetry payloads. Returns the first 12 hex chars of
 * ``sha256(userId + 'playback_v2')`` — see spec §3.2.5.
 *
 * Returns null when ``raw`` is empty so the caller can omit the field
 * entirely rather than transmit an empty hash.
 */
export function hashUserIdForTelemetry(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return sha256Hex(raw + 'playback_v2').slice(0, 12);
}
