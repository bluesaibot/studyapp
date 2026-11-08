import { FLOWERING_GROWTH, makeGenome, speciesById, VARIEGATION_TYPES, type Genome, type Variegation } from './plants'
import { REWARDS } from './rewards'
import { between, createRng, pickWeighted, type Rng } from './rng'
import { varietyById } from './varieties'

/** A variegated sport from a cutting of a plain leaf, without help from the soil. */
const CUTTING_SPORT_CHANCE = 0.001
/** A variegated seedling out of plain parents, without help from the soil. */
const NEW_MUTATION_CHANCE = 0.002
/** Chance that a seedling that took is variegated, by how many of its parents are. */
const INHERIT_CHANCE = [NEW_MUTATION_CHANCE, 0.35, 0.75] as const
/** Crossing is a gamble: chance that a seed takes on anything from both parents. */
export const CROSS_CHANCE = { sameVariety: 0.45, sameGroup: 0.25, most: 0.92 } as const

export interface BreedingHelp {
  /** From the soil: added chance of a mutation. */
  mutation?: number
  /** From the soil: added chance that a cross takes. */
  crossing?: number
}

/** Half of all plants are female, fixed by their seed and shown once they are mature. */
export function sexOf(genome: Genome): 'male' | 'female' {
  if (genome.sex) return genome.sex
  return Math.floor(genome.seed / 7) % 2 === 0 ? 'female' : 'male'
}

export const sameGroup = (a: Genome, b: Genome) => speciesById(a.species).group === speciesById(b.species).group
const sameVariety = (a: Genome, b: Genome) => a.species === b.species && varietyById(a.species, a.variety).id === varietyById(b.species, b.variety).id

/** How much sun fills the pollination bar between two plants. */
export function pollinationCost(a: Genome, b: Genome): number {
  return sameVariety(a, b) ? REWARDS.pollinateSameVariety : REWARDS.pollinateSameGroup
}

/** The chance that a cross takes. Otherwise the seed is just a plain plant of one parent. */
export function crossChance(a: Genome, b: Genome, crossing = 0): number {
  return Math.min(CROSS_CHANCE.most, (sameVariety(a, b) ? CROSS_CHANCE.sameVariety : CROSS_CHANCE.sameGroup) + crossing)
}

interface Parent {
  genome: Genome
  growth: number
  restLeft?: number
}

/** Why two plants cannot pollinate each other, or null when they can. */
export function pollinationProblem(a: Parent, b: Parent): string | null {
  if (a.growth < FLOWERING_GROWTH || b.growth < FLOWERING_GROWTH) return 'Both plants need to be flowering.'
  if (!sameGroup(a.genome, b.genome)) return `${speciesById(a.genome.species).name} and ${speciesById(b.genome.species).name} are different groups and cannot cross.`
  if (sexOf(a.genome) === sexOf(b.genome)) return `Both are ${sexOf(a.genome)}. It takes a male and a female, or bought pollen.`
  if ((a.restLeft ?? 0) > 0 || (b.restLeft ?? 0) > 0) return 'A plant is resting until its next bloom.'
  return null
}

const pickNewVariegation = (rng: Rng): Variegation => pickWeighted(rng, VARIEGATION_TYPES)
const blend = (rng: Rng, a: number, b: number, wobble: number) => between(rng, Math.min(a, b), Math.max(a, b)) + between(rng, -wobble, wobble)
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const parentSpread = (genome: Genome) => (genome.variegation === 'none' ? 0 : (genome.leafSpread ?? 1))

/**
 * A cutting. Without a leaf it is a plain clone. A variegated leaf passes on a higher chance that more
 * leaves of the new plant come out variegated, and possibly in other colours. A plain leaf passes on less.
 */
export function cuttingGenome(parent: Genome, seed: number, help: BreedingHelp & { leaf?: Variegation } = {}): Genome {
  const rng = createRng(seed)
  const sex = sexOf(parent)
  const spread = parentSpread(parent)
  const sport = rng() < CUTTING_SPORT_CHANCE + (help.mutation ?? 0)
  const leaf = help.leaf ?? parent.variegation

  if (leaf !== 'none') {
    const palette = new Set<Variegation>(parent.palette ?? [])
    if (parent.variegation !== 'none') palette.add(parent.variegation)
    palette.add(leaf)
    if (sport || rng() < 0.35) palette.add(pickNewVariegation(rng))
    const leafSpread = spread >= 1 ? 1 : clamp(Math.max(0.2, spread * 0.7 + 0.25), 0, 0.9)
    return { ...parent, seed, sex, variegation: leaf, leafSpread, palette: [...palette] }
  }

  if (sport) return { ...parent, seed, sex, variegation: pickNewVariegation(rng), variegationAmount: between(rng, 0.35, 0.8), leafSpread: 0.2, palette: undefined }
  // Half as likely now, and at some point it is gone.
  const leafSpread = spread * 0.5
  if (leafSpread < 0.02) return { ...parent, seed, sex, variegation: 'none', leafSpread: undefined, palette: undefined }
  return { ...parent, seed, sex, leafSpread }
}

/** Crossing is a lottery: only a seed that takes mixes its parents, and only that one can be variegated. */
export function crossGenomes(a: Genome, b: Genome, seed: number, help: BreedingHelp = {}): Genome {
  const rng = createRng(seed)
  const from = rng() < 0.5 ? a : b
  const speciesId = from.species
  const species = speciesById(speciesId)
  const variety = varietyById(speciesId, from.variety)
  const base: Genome = { ...makeGenome(speciesId, seed, 'common', variety.id), variegation: 'none' }
  if (rng() >= crossChance(a, b, help.crossing)) return base

  const parents = [a, b].filter((parent) => parent.variegation !== 'none')
  const inheritChance = parents.length === 0 ? INHERIT_CHANCE[0] + (help.mutation ?? 0) : INHERIT_CHANCE[parents.length]
  const variegated = rng() < inheritChance
  const variegation = !variegated ? 'none' : parents.length > 0 ? parents[Math.floor(rng() * parents.length)].variegation : pickNewVariegation(rng)
  const hue = variety.hue ?? species.hue
  const fenestration = variety.fenestration ?? species.fenestration

  return {
    ...base,
    crossed: !sameVariety(a, b),
    hue: clamp(blend(rng, a.hue, b.hue, 4), hue[0] - 8, hue[1] + 8),
    saturation: clamp(blend(rng, a.saturation, b.saturation, 3), 8, 75),
    lightness: clamp(blend(rng, a.lightness, b.lightness, 2), 10, 52),
    size: clamp(blend(rng, a.size, b.size, 0.05), 0.5, 1.4),
    // Splits only exist on varieties that have them, however fenestrated the other parent was.
    fenestration: fenestration[1] > 0 ? clamp(blend(rng, a.fenestration, b.fenestration, 0.05), fenestration[0], 1) : 0,
    variegation,
    variegationAmount: variegated ? clamp(blend(rng, a.variegationAmount, b.variegationAmount, 0.08), 0.3, 0.9) : base.variegationAmount,
    leafSpread: variegated ? clamp((parentSpread(a) + parentSpread(b)) / 2 + 0.15, 0.2, 0.9) : undefined,
    palette: variegated ? [...new Set([a, b].flatMap((parent) => parent.palette ?? (parent.variegation !== 'none' ? [parent.variegation] : [])).concat(variegation))] : undefined,
  }
}
