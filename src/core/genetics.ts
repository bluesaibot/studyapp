import { FLOWERING_GROWTH, makeGenome, speciesById, VARIEGATION_TYPES, type Genome, type Variegation } from './plants'
import { REWARDS } from './rewards'
import { between, createRng, pickWeighted, type Rng } from './rng'

const CUTTING_SPORT_CHANCE = 0.04
const NEW_MUTATION_CHANCE = 0.04
/** Chance that a young plant is variegated, by how many of its parents are. */
const INHERIT_CHANCE = [NEW_MUTATION_CHANCE, 0.35, 0.75] as const

/** Half of all plants are female, fixed by their seed and shown once they are mature. */
export function sexOf(genome: Genome): 'male' | 'female' {
  if (genome.sex) return genome.sex
  return Math.floor(genome.seed / 7) % 2 === 0 ? 'female' : 'male'
}

/** How much sun fills the pollination bar between two plants. */
export function pollinationCost(a: Genome, b: Genome): number {
  if (a.species === b.species) return REWARDS.pollinateSameSpecies
  return speciesById(a.species).family === speciesById(b.species).family ? REWARDS.pollinateSameFamily : REWARDS.pollinateAcrossFamilies
}

/** Why two plants cannot pollinate each other, or null when they can. */
export function pollinationProblem(a: { genome: Genome; growth: number }, b: { genome: Genome; growth: number }): string | null {
  if (a.growth < FLOWERING_GROWTH || b.growth < FLOWERING_GROWTH) return 'Both plants need to be flowering.'
  if (sexOf(a.genome) === sexOf(b.genome)) return `Both are ${sexOf(a.genome)}. It takes a male and a female, or bought pollen.`
  return null
}

const pickNewVariegation = (rng: Rng): Variegation => pickWeighted(rng, VARIEGATION_TYPES)
const blend = (rng: Rng, a: number, b: number, wobble: number) => between(rng, Math.min(a, b), Math.max(a, b)) + between(rng, -wobble, wobble)
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** A clone: the same plant in a new pot, with a small chance of a variegated sport. */
export function cuttingGenome(parent: Genome, seed: number): Genome {
  const rng = createRng(seed)
  const sex = sexOf(parent)
  if (parent.variegation !== 'none' || rng() >= CUTTING_SPORT_CHANCE) return { ...parent, seed, sex }
  return { ...parent, seed, sex, variegation: pickNewVariegation(rng), variegationAmount: between(rng, 0.35, 0.8) }
}

export function crossGenomes(a: Genome, b: Genome, seed: number): Genome {
  const rng = createRng(seed)
  const speciesId = rng() < 0.5 ? a.species : b.species
  const species = speciesById(speciesId)
  const base = makeGenome(speciesId, seed, 'common')

  const parents = [a, b].filter((parent) => parent.variegation !== 'none')
  const variegated = rng() < INHERIT_CHANCE[parents.length]
  const variegation = !variegated ? 'none' : parents.length > 0 ? parents[Math.floor(rng() * parents.length)].variegation : pickNewVariegation(rng)

  return {
    ...base,
    hue: clamp(blend(rng, a.hue, b.hue, 4), species.hue[0] - 8, species.hue[1] + 8),
    saturation: clamp(blend(rng, a.saturation, b.saturation, 3), 28, 62),
    lightness: clamp(blend(rng, a.lightness, b.lightness, 2), 20, 40),
    size: clamp(blend(rng, a.size, b.size, 0.05), 0.8, 1.25),
    // Splits only exist on species that have them, however fenestrated the other parent was.
    fenestration: species.fenestration[1] > 0 ? clamp(blend(rng, a.fenestration, b.fenestration, 0.05), species.fenestration[0], 1) : 0,
    variegation,
    variegationAmount: variegated ? clamp(blend(rng, a.variegationAmount, b.variegationAmount, 0.08), 0.3, 0.9) : base.variegationAmount,
  }
}
