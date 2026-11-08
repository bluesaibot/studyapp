import { pickWeighted, type Rng } from './rng'

/** All tunable reward numbers live here. */
export const REWARDS = {
  sunPerFocusMinute: 1,
  sunPerCard: 0.5,
  sunPerOpenQuestion: 5,
  sunPerDrawing: 8,
  sunForDip: 3,
  sunForOnTimeReturn: 3,
  onTimeGraceMs: 2 * 60_000,
  /** Share of earned sun that grows the current plant; the rest goes to the wallet. */
  autoGrowthShare: 0.5,
  waterCost: 10,
  waterGrowth: 15,
} as const

export type Rarity = 'common' | 'uncommon' | 'rare'
export type FundKind = 'seed' | 'fertilizer' | 'sun' | 'pot'

export interface Fund {
  kind: FundKind
  rarity: Rarity
  /** Seed number for `seed`, pot index for `pot`. */
  seed: number
}

interface DayTier {
  fromMinutes: number
  sunMultiplier: number
  rarityWeights: readonly (readonly [Rarity, number])[]
}

const DAY_TIERS: readonly DayTier[] = [
  {
    fromMinutes: 0,
    sunMultiplier: 1,
    rarityWeights: [['common', 80], ['uncommon', 18], ['rare', 2]],
  },
  {
    fromMinutes: 120,
    sunMultiplier: 1.25,
    rarityWeights: [['common', 55], ['uncommon', 35], ['rare', 10]],
  },
  {
    fromMinutes: 180,
    sunMultiplier: 1.5,
    rarityWeights: [['common', 35], ['uncommon', 40], ['rare', 25]],
  },
]

export function dayTier(dayMinutes: number): DayTier {
  let tier = DAY_TIERS[0]
  for (const candidate of DAY_TIERS) {
    if (dayMinutes >= candidate.fromMinutes) tier = candidate
  }
  return tier
}

export function focusSun(dayMinutes: number, minutes: number, streakMultiplier: number): number {
  return minutes * REWARDS.sunPerFocusMinute * dayTier(dayMinutes).sunMultiplier * streakMultiplier
}

const FUND_KINDS = [['seed', 35], ['fertilizer', 30], ['sun', 25], ['pot', 10]] as const

export function rollFund(rng: Rng, dayMinutes: number): Fund {
  return {
    kind: pickWeighted(rng, FUND_KINDS),
    rarity: pickWeighted(rng, dayTier(dayMinutes).rarityWeights),
    seed: Math.floor(rng() * 2 ** 31),
  }
}

export function fundSunAmount(rarity: Rarity): number {
  return { common: 10, uncommon: 25, rare: 60 }[rarity]
}

export function fundGrowthAmount(rarity: Rarity): number {
  return { common: 30, uncommon: 60, rare: 120 }[rarity]
}
