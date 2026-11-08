import { between, type Rng } from './rng'

/** What a soil can do. Each ingredient always gives the same kinds; a mix only varies a little in how much. */
export interface SoilStats {
  /** Share of extra growth from the same sun, so it blooms sooner. */
  speed: number
  /** Share taken off the rest between two blooms. */
  bloom: number
  /** Share taken off the wear on the shears. */
  cuttings: number
  /** Chance added that something mutates when a cutting or seed forms. */
  mutation: number
  /** Chance added that a cross takes. */
  crossing: number
}

export type SoilStat = keyof SoilStats

export const SOIL_STATS: readonly { id: SoilStat; label: string; max: number }[] = [
  { id: 'speed', label: 'Grows faster', max: 0.5 },
  { id: 'bloom', label: 'Blooms more often', max: 0.6 },
  { id: 'cuttings', label: 'Less wear from cuttings', max: 0.7 },
  { id: 'mutation', label: 'More mutations', max: 0.05 },
  { id: 'crossing', label: 'Crosses take more often', max: 0.5 },
]

export const NO_SOIL_STATS: SoilStats = { speed: 0, bloom: 0, cuttings: 0, mutation: 0, crossing: 0 }

export interface Ingredient {
  id: string
  name: string
  color: string
  pricePerLitre: number
  stats: Partial<SoilStats>
}

export const INGREDIENTS: readonly Ingredient[] = [
  { id: 'potting', name: 'Potting soil', color: '#4a3a2a', pricePerLitre: 2, stats: { speed: 0.08 } },
  { id: 'humus', name: 'Worm humus', color: '#2f241b', pricePerLitre: 10, stats: { speed: 0.5 } },
  { id: 'coco', name: 'Coco fibre', color: '#8a5f3c', pricePerLitre: 6, stats: { speed: 0.2, cuttings: 0.3 } },
  { id: 'perlite', name: 'Perlite', color: '#e6e3da', pricePerLitre: 7, stats: { cuttings: 0.7 } },
  { id: 'bark', name: 'Orchid bark', color: '#a4623a', pricePerLitre: 9, stats: { bloom: 0.6 } },
  { id: 'sphagnum', name: 'Sphagnum moss', color: '#9fb37a', pricePerLitre: 14, stats: { crossing: 0.5, bloom: 0.15 } },
  { id: 'charcoal', name: 'Horticultural charcoal', color: '#26262a', pricePerLitre: 30, stats: { mutation: 0.05 } },
]

export function ingredientById(id: string): Ingredient | undefined {
  return INGREDIENTS.find((ingredient) => ingredient.id === id)
}

/** Soil only comes in bags of these sizes. The big one is a little cheaper per litre. */
export const BAGS: readonly { litres: number; priceShare: number }[] = [
  { litres: 5, priceShare: 1 },
  { litres: 20, priceShare: 0.85 },
]

export function bagPrice(ingredient: Ingredient, litres: number): number {
  const bag = BAGS.find((row) => row.litres === litres)
  return bag ? Math.round(ingredient.pricePerLitre * litres * bag.priceShare) : Infinity
}

/** How many litres of soil a garden bed takes. */
export const BED_LITRES = 10
/** How far each number in a finished mix can land from its recipe. */
export const SOIL_WOBBLE = 0.08

export type Recipe = Record<string, number>

export function recipeLitres(recipe: Recipe): number {
  return Object.values(recipe).reduce((total, litres) => total + litres, 0)
}

/** The numbers a recipe aims for: the average of its ingredients, by the litre. */
export function recipeStats(recipe: Recipe): SoilStats {
  const total = recipeLitres(recipe)
  const stats = { ...NO_SOIL_STATS }
  if (total <= 0) return stats
  for (const [id, litres] of Object.entries(recipe)) {
    const ingredient = ingredientById(id)
    if (!ingredient) continue
    for (const { id: stat } of SOIL_STATS) stats[stat] += ((ingredient.stats[stat] ?? 0) * litres) / total
  }
  return stats
}

/** The finished numbers of a mix, slightly different each time. */
export function mixStats(recipe: Recipe, rng: Rng): SoilStats {
  const target = recipeStats(recipe)
  const stats = { ...NO_SOIL_STATS }
  for (const { id } of SOIL_STATS) stats[id] = target[id] * between(rng, 1 - SOIL_WOBBLE, 1 + SOIL_WOBBLE)
  return stats
}

/** The colour of a mix, for the bed it goes into: its ingredients blended by the litre. */
export function recipeColor(recipe: Recipe): string {
  const total = recipeLitres(recipe)
  if (total <= 0) return '#3b2e22'
  const channels = [0, 0, 0]
  for (const [id, litres] of Object.entries(recipe)) {
    const color = ingredientById(id)?.color ?? '#3b2e22'
    for (let i = 0; i < 3; i += 1) channels[i] += (parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) * litres) / total
  }
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

/** A short name from what is mostly in the mix. */
export function recipeName(recipe: Recipe): string {
  const main = Object.entries(recipe)
    .filter(([, litres]) => litres > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => ingredientById(id)?.name ?? id)
  return main.length > 1 ? `${main[0]} and ${main[1].toLowerCase()}` : (main[0] ?? 'Empty mix')
}

export interface Soil {
  name: string
  color: string
  stats: SoilStats
}

/** Shop items that are not soil. */
export const SHEARS: readonly { id: string; name: string; price: number; cuts: number }[] = [
  { id: 'snips', name: 'Garden snips', price: 150, cuts: 4 },
  { id: 'shears', name: 'Sharp shears', price: 400, cuts: 12 },
]
