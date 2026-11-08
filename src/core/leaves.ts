import { emergenceOf, VARIEGATION_TYPES, type Genome, type Variegation } from './plants'
import { REWARDS } from './rewards'
import { pickWeighted, type Rng } from './rng'

/** What is special about a plant's leaves: their own colours, and those cut off and waiting to regrow. */
export interface LeafState {
  /** Variegation per leaf. A leaf not listed follows the genome. */
  marks: Record<number, Variegation>
  /** Leaves to regrow, in order. Each waits until leaves started before the cut are open, set by `gate`. */
  queue: { index: number; gate: number }[]
  /** Sun that went into the first leaf of the queue. */
  regrown: number
}

export const NO_LEAF_STATE: LeafState = { marks: {}, queue: [], regrown: 0 }

/** Chance per new leaf of a plain plant to come out variegated. */
export const BASE_LEAF_MUTATION = 0.0005
/** A leaf feels only this share of the soil's mutation number; the full number is for cuttings and seeds. */
const LEAF_SOIL_SHARE = 0.4
/** On a partly variegated plant, a new leaf sometimes takes a colour the plant did not have. */
const NEW_COLOUR_CHANCE = 0.1
/** A regrown leaf is not sure to come back as it was. */
const REGROW_SHARE = 0.6

export function spreadOf(genome: Genome): number {
  return genome.leafSpread ?? (genome.variegation !== 'none' ? 1 : BASE_LEAF_MUTATION)
}

export function leafType(genome: Genome, state: LeafState, index: number): Variegation {
  return state.marks[index] ?? genome.variegation
}

function rollLeaf(genome: Genome, mutation: number, rng: Rng, share = 1): Variegation {
  const chance = (spreadOf(genome) + mutation * LEAF_SOIL_SHARE) * share
  if (rng() >= chance) return 'none'
  const palette = genome.palette ?? (genome.variegation !== 'none' ? [genome.variegation] : [])
  if (palette.length === 0 || (genome.leafSpread !== undefined && rng() < NEW_COLOUR_CHANCE)) return pickWeighted(rng, VARIEGATION_TYPES)
  return palette[Math.floor(rng() * palette.length)]
}

/** Gives each leaf that just started its colour, once, so it never changes while on the plant. */
export function rollNewLeaves(genome: Genome, state: LeafState, growthBefore: number, growthAfter: number, mutation: number, rng: Rng): LeafState {
  const from = Math.ceil(emergenceOf(genome, growthBefore))
  const to = Math.ceil(emergenceOf(genome, growthAfter))
  if (to <= from) return state
  const marks = { ...state.marks }
  for (let index = from; index < to; index += 1) marks[index] = rollLeaf(genome, mutation, rng)
  return { ...state, marks }
}

/** How many leaves are fully open. */
export function emergenceLeaves(genome: Genome, growth: number): number {
  return Math.floor(emergenceOf(genome, growth))
}

export const CUT_ONLY_IN_GREENHOUSE = 'Leaves can only be cut in the greenhouse.'

/** Whether this leaf can be cut: it has to be open, and a plant keeps at least two leaves. */
export function cutProblem(genome: Genome, state: LeafState, growth: number, index: number): string | null {
  if (growth < REWARDS.cuttingMinGrowth) return `Leaves can be cut from growth ${REWARDS.cuttingMinGrowth}.`
  if (state.queue.length >= REWARDS.maxCutQueue) return `${REWARDS.maxCutQueue} leaves are already regrowing on this plant.`
  const open = Math.floor(emergenceOf(genome, growth))
  if (!Number.isInteger(index) || index < 0 || index >= open) return 'This leaf is not open yet.'
  if (state.queue.some((leaf) => leaf.index === index)) return 'This leaf is still regrowing.'
  if (open - state.queue.length <= 2) return 'It needs its last leaves for now.'
  return null
}

/** The leaf goes, and regrows after the leaf that is on its way now. */
export function cutLeaf(genome: Genome, state: LeafState, growth: number, index: number): LeafState {
  return { ...state, queue: [...state.queue, { index, gate: Math.ceil(emergenceOf(genome, growth)) }] }
}

/**
 * Sun goes to the waiting leaves first, so the plant itself pauses while they regrow. In the greenhouse nothing
 * is starting new leaves, so nothing holds them up there. Returns the sun that is left for growing.
 */
export function regrowLeaves(genome: Genome, state: LeafState, sun: number, growth: number, inBed: boolean, mutation: number, rng: Rng): { state: LeafState; left: number } {
  let left = sun
  let regrown = state.regrown
  const queue = [...state.queue]
  const marks = { ...state.marks }
  const emergence = emergenceOf(genome, growth)
  while (left > 0 && queue.length > 0) {
    if (inBed && emergence < queue[0].gate) break
    const needed = REWARDS.leafRegrowSun - regrown
    if (left < needed) {
      regrown += left
      left = 0
      break
    }
    left -= needed
    regrown = 0
    const done = queue.shift()!
    marks[done.index] = rollLeaf(genome, mutation, rng, REGROW_SHARE)
  }
  return { state: { marks, queue, regrown }, left }
}

/** How far a leaf is open because of cutting: 1 unless it is waiting (0) or just regrowing. */
export function regrowthOf(state: LeafState, index: number): number {
  const place = state.queue.findIndex((leaf) => leaf.index === index)
  if (place < 0) return 1
  return place === 0 ? state.regrown / REWARDS.leafRegrowSun : 0
}
