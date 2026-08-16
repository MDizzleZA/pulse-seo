// 64-bit simhash over word shingles for near-duplicate detection.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnv1a64(str: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

/** Compute a 64-bit simhash (hex string) of visible text using 3-word shingles. */
export function simhash(text: string): string {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '0';
  const weights = new Array<number>(64).fill(0);
  const n = Math.max(1, words.length - 2);
  for (let i = 0; i < n; i++) {
    const shingle = words.slice(i, i + 3).join(' ');
    const h = fnv1a64(shingle);
    for (let bit = 0; bit < 64; bit++) {
      if ((h >> BigInt(bit)) & 1n) weights[bit] += 1;
      else weights[bit] -= 1;
    }
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit] > 0) out |= 1n << BigInt(bit);
  }
  return out.toString(16);
}

export function hammingDistance(hexA: string, hexB: string): number {
  let x = BigInt('0x' + hexA) ^ BigInt('0x' + hexB);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** similarity in 0..1 (1 = identical) */
export function simhashSimilarity(hexA: string, hexB: string): number {
  return 1 - hammingDistance(hexA, hexB) / 64;
}
