import { between, createRng, pickWeighted } from './rng'
import type { Rarity } from './rewards'

export type LeafShape = 'heart' | 'arrow' | 'oval' | 'lance' | 'round' | 'strap'
/** How a species grows: up a pole, in hanging vines, around a hoop, as a clump, or as a rosette. */
export type GrowthForm = 'pole' | 'trail' | 'hoop' | 'clump' | 'rosette'
export type Variegation = 'none' | 'marbled' | 'sectoral' | 'aurea' | 'albo' | 'mint'

export interface Species {
  id: string
  name: string
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
  { id: 'monstera', name: 'Monstera', shape: 'heart', form: 'pole', hue: [135, 155], fenestration: [0.55, 1], flower: '#f3efd8' },
  { id: 'philodendron', name: 'Philodendron', shape: 'arrow', form: 'pole', hue: [110, 150], fenestration: [0, 0], flower: '#e7d8c0' },
  { id: 'pothos', name: 'Pothos', shape: 'heart', form: 'trail', hue: [95, 125], fenestration: [0, 0], flower: '#e9edc9' },
  { id: 'alocasia', name: 'Alocasia', shape: 'arrow', form: 'clump', hue: [150, 175], fenestration: [0, 0], flower: '#efe6d0' },
  { id: 'anthurium', name: 'Anthurium', shape: 'heart', form: 'clump', hue: [125, 150], fenestration: [0, 0], flower: '#d8402f' },
  { id: 'begonia', name: 'Begonia', shape: 'round', form: 'clump', hue: [85, 130], fenestration: [0, 0], flower: '#f2a7b8' },
  { id: 'calathea', name: 'Calathea', shape: 'oval', form: 'clump', hue: [140, 170], fenestration: [0, 0], flower: '#f4f0e6' },
  { id: 'hoya', name: 'Hoya', shape: 'oval', form: 'hoop', hue: [105, 140], fenestration: [0, 0], flower: '#f6d9de' },
]

export const BROMELIADS: readonly Species[] = [
  { id: 'neoregelia', name: 'Neoregelia', shape: 'strap', form: 'rosette', hue: [95, 130], fenestration: [0, 0], flower: '#d3225a', rare: true },
  { id: 'guzmania', name: 'Guzmania', shape: 'strap', form: 'rosette', hue: [110, 140], fenestration: [0, 0], flower: '#e2391f', rare: true },
  { id: 'vriesea', name: 'Vriesea', shape: 'strap', form: 'rosette', hue: [120, 150], fenestration: [0, 0], flower: '#e8452c', rare: true },
  { id: 'aechmea', name: 'Aechmea', shape: 'strap', form: 'rosette', hue: [150, 175], fenestration: [0, 0], flower: '#ec5f9c', rare: true },
  { id: 'tillandsia', name: 'Tillandsia', shape: 'strap', form: 'rosette', hue: [90, 120], fenestration: [0, 0], flower: '#ef6aa6', rare: true },
]

export const SPECIES: readonly Species[] = [...COMMON_SPECIES, ...BROMELIADS]

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

/** Chance out of 100 that a seed of this rarity grows a bromeliad. */
const BROMELIAD_CHANCE: Record<Rarity, number> = { common: 0, uncommon: 8, rare: 60 }

export function speciesFromSeed(seed: number, rarity: Rarity = 'common'): Species {
  // A higher part of the seed decides, so this stays independent of which common species it would be.
  if (Math.floor(seed / 16) % 100 < BROMELIAD_CHANCE[rarity]) return BROMELIADS[Math.floor(seed / 1600) % BROMELIADS.length]
  return COMMON_SPECIES[seed % COMMON_SPECIES.length]
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
