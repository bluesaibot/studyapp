export type Rng = () => number

/** Small seeded generator (mulberry32), so plants look the same on every render. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pickWeighted<T>(rng: Rng, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rng() * total
  for (const [value, weight] of options) {
    roll -= weight
    if (roll < 0) return value
  }
  return options[options.length - 1][0]
}

export function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}
