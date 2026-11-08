import { between, createRng, pickWeighted } from './rng'
import { REWARDS, type Rarity } from './rewards'
import { varietiesOf, varietyById } from './varieties'

export type LeafShape = 'heart' | 'arrow' | 'oval' | 'lance' | 'round' | 'strap'
/** How a species grows: up a pole, in hanging vines, around a hoop, as a clump, or as a rosette. */
export type GrowthForm = 'pole' | 'trail' | 'hoop' | 'clump' | 'rosette'
export type Variegation = 'none' | 'marbled' | 'sectoral' | 'aurea' | 'albo' | 'mint'

export interface Species {
  id: string
  name: string
  /** Only plants of one group can be crossed. */
  group: string
  shape: LeafShape
  form: GrowthForm
  hue: readonly [number, number]
  fenestration: readonly [number, number]
  flower: string
  /** Only grows from good seeds. */
  rare?: boolean
}

/** New species go at the end of their list, so a seed always keeps the species it stands for. */
export const COMMON_SPECIES: readonly Species[] = [
  { id: 'monstera', group: 'monstera', name: 'Monstera', shape: 'heart', form: 'pole', hue: [135, 155], fenestration: [0.55, 1], flower: '#f3efd8' },
  { id: 'philodendron', group: 'philodendron', name: 'Philodendron', shape: 'arrow', form: 'pole', hue: [110, 150], fenestration: [0, 0], flower: '#e7d8c0' },
  { id: 'pothos', group: 'pothos', name: 'Pothos', shape: 'heart', form: 'trail', hue: [95, 125], fenestration: [0, 0], flower: '#e9edc9' },
  { id: 'alocasia', group: 'alocasia', name: 'Alocasia', shape: 'arrow', form: 'clump', hue: [150, 175], fenestration: [0, 0], flower: '#efe6d0' },
  { id: 'anthurium', group: 'anthurium', name: 'Anthurium', shape: 'heart', form: 'clump', hue: [125, 150], fenestration: [0, 0], flower: '#d8402f' },
  { id: 'begonia', group: 'begonia', name: 'Begonia', shape: 'round', form: 'clump', hue: [85, 130], fenestration: [0, 0], flower: '#f2a7b8' },
  { id: 'calathea', group: 'calathea', name: 'Calathea', shape: 'oval', form: 'clump', hue: [140, 170], fenestration: [0, 0], flower: '#f4f0e6' },
  { id: 'hoya', group: 'hoya', name: 'Hoya', shape: 'oval', form: 'hoop', hue: [105, 140], fenestration: [0, 0], flower: '#f6d9de' },
]

export const BROMELIADS: readonly Species[] = [
  { id: 'neoregelia', group: 'bromeliad', name: 'Neoregelia', shape: 'strap', form: 'rosette', hue: [95, 130], fenestration: [0, 0], flower: '#d3225a', rare: true },
  { id: 'guzmania', group: 'bromeliad', name: 'Guzmania', shape: 'strap', form: 'rosette', hue: [110, 140], fenestration: [0, 0], flower: '#e2391f', rare: true },
  { id: 'vriesea', group: 'bromeliad', name: 'Vriesea', shape: 'strap', form: 'rosette', hue: [120, 150], fenestration: [0, 0], flower: '#e8452c', rare: true },
  { id: 'aechmea', group: 'bromeliad', name: 'Aechmea', shape: 'strap', form: 'rosette', hue: [150, 175], fenestration: [0, 0], flower: '#ec5f9c', rare: true },
  { id: 'tillandsia', group: 'bromeliad', name: 'Tillandsia', shape: 'strap', form: 'rosette', hue: [90, 120], fenestration: [0, 0], flower: '#ef6aa6', rare: true },
]

export const ORCHIDS: readonly Species[] = [
  { id: 'phalaenopsis', group: 'phalaenopsis', name: 'Phalaenopsis', shape: 'strap', form: 'rosette', hue: [120, 145], fenestration: [0, 0], flower: '#f6f2ec', rare: true },
]

export const RARE_SPECIES: readonly Species[] = [...BROMELIADS, ...ORCHIDS]
export const SPECIES: readonly Species[] = [...COMMON_SPECIES, ...RARE_SPECIES]

export function speciesById(id: string): Species {
  return SPECIES.find((species) => species.id === id) ?? SPECIES[0]
}

export interface Genome {
  species: string
  seed: number
  hue: number
  saturation: number
  lightness: number
  size: number
  fenestration: number
  variegation: Variegation
  variegationAmount: number
  /** Set on cuttings, which keep their parent's sex. Everything else follows from the seed. */
  sex?: 'male' | 'female'
  /** The real plant within its group. Plants from before varieties count as the group's first one. */
  variety?: string
  /** Chance per new leaf to be variegated. Without it a variegated plant is variegated throughout. */
  leafSpread?: number
  /** Colours new leaves can take. */
  palette?: Variegation[]
  /** Grown from a cross of two different varieties that took. */
  crossed?: boolean
}

/** Almost never by itself. The way to variegation is through soil, leaves and crossing. */
const VARIEGATION_CHANCE: Record<Rarity, number> = {
  common: 0.0005,
  uncommon: 0.001,
  rare: 0.002,
}

export const VARIEGATION_TYPES = [
  ['marbled', 35],
  ['sectoral', 20],
  ['mint', 20],
  ['aurea', 15],
  ['albo', 10],
] as const

/** Rare varieties are out of reach for common seeds. Which one follows from the seed. */
export function varietyFromSeed(speciesId: string, seed: number, rarity: Rarity): string {
  const all = varietiesOf(speciesId)
  const allowed = rarity === 'common' ? all.filter((variety) => !variety.rare) : all
  return allowed[Math.floor(seed / 11) % allowed.length].id
}

export function makeGenome(speciesId: string, seed: number, rarity: Rarity, varietyId?: string): Genome {
  const rng = createRng(seed)
  const species = speciesById(speciesId)
  const variety = varietyById(species.id, varietyId ?? varietyFromSeed(species.id, seed, rarity))
  const variegated = rng() < VARIEGATION_CHANCE[rarity]
  const hue = variety.hue ?? species.hue
  const saturation = variety.saturation ?? [34, 56]
  const lightness = variety.lightness ?? [23, 36]
  const fenestration = variety.fenestration ?? species.fenestration
  const size = variety.size ?? 1
  return {
    species: species.id,
    seed,
    variety: variety.id,
    hue: between(rng, hue[0], hue[1]),
    saturation: between(rng, saturation[0], saturation[1]),
    lightness: between(rng, lightness[0], lightness[1]),
    size: between(rng, 0.85, 1.15) * size,
    fenestration: between(rng, fenestration[0], fenestration[1]),
    variegation: variegated ? pickWeighted(rng, VARIEGATION_TYPES) : 'none',
    variegationAmount: between(rng, 0.35, 0.8),
  }
}

/** The plant's full name, like Monstera adansonii. */
export function varietyName(genome: Genome): string {
  return `${speciesById(genome.species).name} ${varietyById(genome.species, genome.variety).name}`
}

/** 0 plain, 1 uncommon, 2 rare, 3 exceptional. */
export const RARITY_LABELS = ['Plain', 'Uncommon', 'Rare', 'Exceptional'] as const

export function plantRarity(genome: Genome): number {
  const variety = varietyById(genome.species, genome.variety)
  let points = 0
  if (speciesById(genome.species).rare) points += 2
  if (variety.rare) points += 1
  if (genome.crossed) points += 1
  if (genome.variegation !== 'none') points += { marbled: 2, sectoral: 3, mint: 3, aurea: 3, albo: 4 }[genome.variegation]
  if (points <= 0) return 0
  if (points <= 2) return 1
  return points <= 4 ? 2 : 3
}

/** The sun a plant takes to sprout. Cuttings are quicker than seeds, and rare plants slower than common ones. */
export function sproutCost(genome: Genome, isCutting: boolean): number {
  return (isCutting ? REWARDS.sproutCuttingSun : REWARDS.sproutSeedSun) * REWARDS.sproutRarity[plantRarity(genome)]
}

/** Growth from sun: up to the sprout it is spread over the sprouting cost, after that one to one. */
export function growthFromSun(growth: number, sun: number, cost: number): number {
  if (growth >= SPROUT_GROWTH) return growth + sun
  const sunToSprout = ((SPROUT_GROWTH - growth) / SPROUT_GROWTH) * cost
  if (sun < sunToSprout) return growth + (sun * SPROUT_GROWTH) / cost
  return SPROUT_GROWTH + (sun - sunToSprout)
}

/** Chance out of 100 that a seed of this rarity grows a bromeliad. */
const BROMELIAD_CHANCE: Record<Rarity, number> = { common: 0, uncommon: 8, rare: 60 }

export function speciesFromSeed(seed: number, rarity: Rarity = 'common'): Species {
  // A higher part of the seed decides, so this stays independent of which common species it would be.
  if (Math.floor(seed / 16) % 100 < BROMELIAD_CHANCE[rarity]) return RARE_SPECIES[Math.floor(seed / 1600) % RARE_SPECIES.length]
  return COMMON_SPECIES[seed % COMMON_SPECIES.length]
}

/** A seed that is sure to grow a bromeliad, for the biggest rewards. */
export function bromeliadSeed(rng: () => number): number {
  for (;;) {
    const seed = Math.floor(rng() * 2 ** 31)
    if (speciesFromSeed(seed, 'rare').group === 'bromeliad') return seed
  }
}

export const STAGES = [
  { name: 'Seed', from: 0 },
  { name: 'Sprout', from: 20 },
  { name: 'Young plant', from: 100 },
  { name: 'Mature', from: 300 },
  { name: 'Flowering', from: 700 },
] as const

export const FLOWERING_GROWTH = STAGES[STAGES.length - 1].from

export function stageIndex(growth: number): number {
  let index = 0
  STAGES.forEach((stage, i) => {
    if (growth >= stage.from) index = i
  })
  return index
}

export function nextStageProgress(growth: number): number {
  const index = stageIndex(growth)
  if (index === STAGES.length - 1) return 1
  const from = STAGES[index].from
  return (growth - from) / (STAGES[index + 1].from - from)
}

/** Where a plant stands: its stage, and how far it is to the next one. */
export function stageProgress(growth: number): { stage: string; next: string | null; goal: number | null; share: number } {
  const index = stageIndex(growth)
  const next = STAGES[index + 1]
  return { stage: STAGES[index].name, next: next?.name ?? null, goal: next?.from ?? null, share: next ? nextStageProgress(growth) : 1 }
}

export const SPROUT_GROWTH = STAGES[1].from
export const MAX_LEAVES = 16
const LEAVES_UNFOLDED_AT = SPROUT_GROWTH + 10
const FLOWER_BUDS_FROM = FLOWERING_GROWTH - 60

export function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** How many leaves have emerged, as a fraction, so a new leaf grows in rather than appearing. */
export function leafEmergence(growth: number): number {
  if (growth < SPROUT_GROWTH) return 0
  const ramp = smoothstep((growth - SPROUT_GROWTH) / (LEAVES_UNFOLDED_AT - SPROUT_GROWTH))
  return Math.min(MAX_LEAVES, 2 + Math.sqrt(growth) * 0.55) * ramp
}

/** Climbing and hanging forms carry more, and smaller, leaves than the others. */
export function emergenceOf(genome: Genome, growth: number): number {
  const species = speciesById(genome.species)
  const scale = species.id === 'tillandsia' ? 1.9 : { pole: 1, clump: 1, trail: 1.6, hoop: 1.5, rosette: 1.35 }[species.form]
  return leafEmergence(growth) * scale
}

/** Progress of one leaf from 0 (still folded in the stem) to 1 (fully open). */
export function leafProgress(growth: number, index: number): number {
  return smoothstep(leafEmergence(growth) - index)
}

/** Slits in fenestrated leaves widen slowly once a plant is young. */
export function fenestrationProgress(growth: number): number {
  return smoothstep((growth - STAGES[2].from) / 60)
}

/** Buds open just before the plant counts as flowering, so a finished plant is in full bloom. */
export function flowerProgress(growth: number): number {
  return smoothstep((growth - FLOWER_BUDS_FROM) / (FLOWERING_GROWTH - FLOWER_BUDS_FROM))
}

/** Position of the gold glaze in POT_DESIGNS. */
export const GOLD_POT = 6
