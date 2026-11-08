import { pickWeighted, type Rng } from './rng'

/** All tunable reward numbers live here. */
export const REWARDS = {
  sunPerFocusMinute: 1,
  sunPerCard: 0.5,
  /** Paid once a day per question, and only after real time with it. */
  sunPerOpenQuestion: 5,
  sunPerQuickQuestion: 1,
  fullQuestionMs: 60_000,
  sunPerDrawing: 8,
  sunForDip: 3,
  sunForOnTimeReturn: 3,
  onTimeGraceMs: 2 * 60_000,
  /** Share of earned sun that grows the current plant; the rest goes to the wallet. */
  autoGrowthShare: 0.5,
  waterCost: 10,
  waterGrowth: 10,
  /** A plant's sex shows from this growth, the Mature stage. */
  sexShownGrowth: 300,
  /** Sun a plant takes to sprout: seeds take long, and rarer plants take longer still. */
  sproutSeedSun: 100,
  sproutCuttingSun: 40,
  /** Multiplier on the sprouting sun, by how rare a plant is. */
  sproutRarity: [1, 1.5, 2.5, 4],
  /** A plant is only ready for the greenhouse once it is this big. */
  showGrowth: 100,
  /** Leaves can be cut from the Mature stage, and only a few can regrow at once. */
  cuttingMinGrowth: 300,
  maxCutQueue: 3,
  leafRegrowSun: 30,
  /** More garden beds. Sun to spend comes in at about 900 a week. */
  bedCosts: [300, 700, 1500, 3000],
  /** Filling the pollination bar. Crossing two varieties of a group takes more. */
  pollinateSameVariety: 150,
  pollinateSameGroup: 400,
  /** Bought pollen makes any flowering plant fertile by itself, once. */
  pollenCost: 200,
  /** Studied sun it takes a plant to bloom again after making seeds. */
  bloomRestSun: 300,
  /** A todo pays a little; finishing its topic is where the real reward is. */
  todoBaseSun: 2,
  todoSunPerHour: 2,
  todoMaxSun: 22,
  topicSunPerHour: 10,
  topicMinSun: 20,
  topicMaxSun: 600,
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

/**
 * The base sun an open question pays now, given what it already paid today.
 * Coming back with more time tops a quick answer up to the full amount, and it never goes below 0.
 */
export function questionSun(thinkingMs: number, paidToday: number): number {
  const earned = thinkingMs >= REWARDS.fullQuestionMs ? REWARDS.sunPerOpenQuestion : REWARDS.sunPerQuickQuestion
  return Math.max(0, earned - paidToday)
}

const FUND_KINDS = [['seed', 35], ['fertilizer', 30], ['sun', 25], ['pot', 10]] as const

export function rollFund(rng: Rng, dayMinutes: number): Fund {
  return {
    kind: pickWeighted(rng, FUND_KINDS),
    rarity: pickWeighted(rng, dayTier(dayMinutes).rarityWeights),
    seed: Math.floor(rng() * 2 ** 31),
  }
}

export function todoSun(effortHours: number | null): number {
  return Math.min(REWARDS.todoMaxSun, REWARDS.todoBaseSun + (effortHours ?? 0) * REWARDS.todoSunPerHour)
}

export function fundSunAmount(rarity: Rarity): number {
  return { common: 10, uncommon: 25, rare: 60 }[rarity]
}

export function fundGrowthAmount(rarity: Rarity): number {
  return { common: 30, uncommon: 60, rare: 120 }[rarity]
}
