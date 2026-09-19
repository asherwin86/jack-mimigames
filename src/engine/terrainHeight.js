/**
 * The pure, dependency-free part of Blockcraft's terrain: the noise and the
 * height of the ground at any column. It lives here (not in blockcraft.js) so
 * the PvP server can walk its bots over exactly the same hills the players see
 * — one source of truth, no THREE or DOM needed to import it.
 */

export const H = 40;     // build height
export const SEA = 12;   // sea level

const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => (v - a) / (b - a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hash2(x, z, seed) {
  // Math.imul throughout: this hash relies on 32-bit wraparound, and plain `*`
  // silently loses the low bits once the product passes 2^53.
  let n = (Math.imul(x | 0, 1619) + Math.imul(z | 0, 31337) + Math.imul(seed | 0, 1013)) | 0;
  n = (n << 13) ^ n;
  const m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
  n = (Math.imul(n, m) + 1376312589) | 0;
  return (n & 0x7fffffff) / 0x7fffffff;
}

export function noise2(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return lerp(
    lerp(hash2(xi, zi, seed), hash2(xi + 1, zi, seed), u),
    lerp(hash2(xi, zi + 1, seed), hash2(xi + 1, zi + 1, seed), u),
    v,
  );
}

/** Layered value noise for elevation. A stationary field — statistically the
 *  same everywhere — which is exactly what makes chunk-at-a-time generation
 *  possible: any column can be evaluated on its own, in any order. */
export function fieldAt(x, z, seed) {
  let e = 0;
  let amp = 1;
  let freq = 0.012;
  let sum = 0;
  for (let o = 0; o < 4; o++) {
    e += noise2(x * freq, z * freq, seed + o * 71) * amp;
    sum += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return e / sum;
}

/**
 * Fits the height curve to this seed's own spread rather than to fixed
 * constants — a flat mapping left some seeds with no sea at all and others
 * half drowned. Pinning the 30th percentile to the waterline gives every
 * seed a coast. There's no whole world to scan any more, so this samples a
 * large, sparse, deterministic spread of columns instead: since the field is
 * stationary, that sample's percentiles match the true (infinite) field's.
 */
export function calibrateHeight(seed) {
  const N = 96;
  const STRIDE = 37;   // no relation to the noise's own frequencies, so it can't alias with them
  const samples = new Float32Array(N * N);
  let i = 0;
  for (let sz = 0; sz < N; sz++) {
    for (let sx = 0; sx < N; sx++) {
      samples[i++] = fieldAt((sx - N / 2) * STRIDE, (sz - N / 2) * STRIDE, seed);
    }
  }
  const sorted = Float32Array.from(samples).sort();
  return {
    low: sorted[0],
    shore: sorted[Math.floor(sorted.length * 0.3)],
    peak: sorted[Math.floor(sorted.length * 0.995)],
  };
}

export function heightAt(x, z, seed, cal) {
  const e = fieldAt(x, z, seed);
  const h = e <= cal.shore
    ? Math.round(lerp(2, SEA, invLerp(cal.low, cal.shore, e)))
    : Math.round(lerp(SEA, H - 6, clamp(invLerp(cal.shore, cal.peak, e), 0, 1) ** 1.15));
  return clamp(h, 1, H - 6);
}

