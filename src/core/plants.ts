import { between, createRng, pickWeighted } from './rng'
import type { Rarity } from './rewards'

export type LeafShape = 'heart' | 'arrow' | 'oval' | 'lance' | 'round'
export type Habit = 'upright' | 'trailing'
export type Variegation = 'none' | 'marbled' | 'sectoral' | 'aurea' | 'albo' | 'mint'

export interface Species {
  id: string
  name: string
  shape: LeafShape
  habit: Habit
  hue: readonly [number, number]
  fenestration: readonly [number, number]
  flower: string
}

export const SPECIES: readonly Species[] = [
  { id: 'monstera', name: 'Monstera', shape: 'heart', habit: 'upright', hue: [135, 155], fenestration: [0.55, 1], flower: '#f3efd8' },
  { id: 'philodendron', name: 'Philodendron', shape: 'arrow', habit: 'upright', hue: [110, 150], fenestration: [0, 0.2], flower: '#e7d8c0' },
  { id: 'pothos', name: 'Pothos', shape: 'heart', habit: 'trailing', hue: [95, 125], fenestration: [0, 0], flower: '#e9edc9' },
  { id: 'alocasia', name: 'Alocasia', shape: 'arrow', habit: 'upright', hue: [150, 175], fenestration: [0, 0], flower: '#efe6d0' },
  { id: 'anthurium', name: 'Anthurium', shape: 'heart', habit: 'upright', hue: [125, 150], fenestration: [0, 0], flower: '#d8402f' },
  { id: 'begonia', name: 'Begonia', shape: 'round', habit: 'upright', hue: [85, 130], fenestration: [0, 0], flower: '#f2a7b8' },
  { id: 'calathea', name: 'Calathea', shape: 'oval', habit: 'upright', hue: [140, 170], fenestration: [0, 0], flower: '#f4f0e6' },
  { id: 'hoya', name: 'Hoya', shape: 'lance', habit: 'trailing', hue: [105, 140], fenestration: [0, 0], flower: '#f6d9de' },
]

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
}

const VARIEGATION_CHANCE: Record<Rarity, number> = {
  common: 0.03,
  uncommon: 0.15,
  rare: 0.4,
}

const VARIEGATION_TYPES = [
  ['marbled', 35],
  ['sectoral', 20],
  ['mint', 20],
  ['aurea', 15],
  ['albo', 10],
] as const

export function makeGenome(speciesId: string, seed: number, rarity: Rarity): Genome {
  const rng = createRng(seed)
  const species = speciesById(speciesId)
  const variegated = rng() < VARIEGATION_CHANCE[rarity]
  return {
    species: species.id,
    seed,
    hue: between(rng, species.hue[0], species.hue[1]),
    saturation: between(rng, 34, 56),
    lightness: between(rng, 23, 36),
    size: between(rng, 0.85, 1.15),
    fenestration: between(rng, species.fenestration[0], species.fenestration[1]),
    variegation: variegated ? pickWeighted(rng, VARIEGATION_TYPES) : 'none',
    variegationAmount: between(rng, 0.35, 0.8),
  }
}

export function speciesFromSeed(seed: number): Species {
  return SPECIES[seed % SPECIES.length]
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

export const POT_COLORS =['#2e6e7e', '#3d4f7c', '#7a5c8e', '#b5533c', '#d9d4c5', '#2f2f35', '#c79a2d'] as const
