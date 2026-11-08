import type { LeafShape } from './plants'

export type LeafPattern = 'pinnate' | 'bold' | 'painted' | 'palmate' | 'smooth'

/** A real plant within a species group. Anything left out comes from the group. */
export interface Variety {
  id: string
  name: string
  /** How common it is within its group, on one scale: 100 is everywhere, 2 is a find. */
  weight: number
  hue?: readonly [number, number]
  saturation?: readonly [number, number]
  lightness?: readonly [number, number]
  fenestration?: readonly [number, number]
  size?: number
  flower?: string
  shape?: LeafShape
  look?: { pattern?: LeafPattern; proportion?: number; asymmetry?: number; spots?: boolean; gloss?: boolean }
}

/** The first variety of a group is what plants from before varieties count as, so it changes nothing about them. New ones go at the end. */
export const VARIETIES: Record<string, readonly Variety[]> = {
  monstera: [
    { id: 'deliciosa', name: 'deliciosa', weight: 100 },
    { id: 'borsigiana', name: 'borsigiana', weight: 50, fenestration: [0.35, 0.7], size: 0.85 },
    { id: 'adansonii', name: 'adansonii', weight: 70, fenestration: [0.75, 1], size: 0.72, hue: [120, 140], look: { proportion: 0.7 } },
    { id: 'karstenii', name: 'Peru', weight: 15, fenestration: [0, 0], hue: [150, 170], lightness: [17, 24], shape: 'oval', size: 0.78, look: { proportion: 0.68 } },
    { id: 'dubia', name: 'dubia', weight: 5, fenestration: [0, 0], hue: [150, 172], saturation: [16, 28], lightness: [32, 42], shape: 'oval', size: 0.7, look: { pattern: 'painted', proportion: 0.78, gloss: false } },
    { id: 'siltepecana', name: 'siltepecana', weight: 3, fenestration: [0, 0], hue: [165, 190], saturation: [16, 28], lightness: [40, 50], shape: 'lance', size: 0.72, look: { pattern: 'bold', proportion: 0.6 } },
    { id: 'standleyana', name: 'standleyana', weight: 30, fenestration: [0, 0], hue: [115, 135], shape: 'oval', size: 0.8, look: { proportion: 0.55 } },
  ],
  philodendron: [
    { id: 'hederaceum', name: 'hederaceum', weight: 100, shape: 'heart', hue: [105, 125], size: 0.85 },
    { id: 'micans', name: 'micans', weight: 45, shape: 'heart', hue: [18, 38], saturation: [24, 36], lightness: [17, 25], size: 0.75, look: { gloss: false } },
    { id: 'melanochrysum', name: 'melanochrysum', weight: 4, hue: [150, 165], lightness: [11, 17], look: { pattern: 'bold', proportion: 0.6, gloss: false } },
    { id: 'gloriosum', name: 'gloriosum', weight: 12, shape: 'heart', hue: [135, 150], size: 1.15, look: { pattern: 'bold', proportion: 1.05, gloss: false } },
    { id: 'verrucosum', name: 'verrucosum', weight: 6, shape: 'heart', hue: [120, 140], lightness: [20, 28], look: { pattern: 'painted', proportion: 0.95, gloss: false } },
    { id: 'erubescens', name: 'erubescens', weight: 60, hue: [348, 360], saturation: [34, 48], lightness: [20, 28] },
  ],
  pothos: [
    { id: 'jade', name: 'aureum Jade', weight: 100 },
    { id: 'neon', name: 'aureum Neon', weight: 60, hue: [70, 82], saturation: [58, 72], lightness: [42, 50] },
    { id: 'cebu', name: 'pinnatum Cebu Blue', weight: 25, hue: [170, 190], saturation: [18, 30], lightness: [38, 47], shape: 'oval', look: { proportion: 0.62 } },
    { id: 'baltic', name: 'pinnatum Baltic Blue', weight: 12, hue: [165, 182], saturation: [24, 34], lightness: [27, 34], shape: 'oval', look: { proportion: 0.7 } },
    { id: 'skeleton', name: 'pinnatum Skeleton Key', weight: 4, hue: [130, 150], shape: 'lance', look: { pattern: 'bold', proportion: 0.46 } },
    { id: 'pictus', name: 'Scindapsus pictus', weight: 45, hue: [140, 158], saturation: [20, 32], lightness: [26, 34], shape: 'oval', look: { pattern: 'painted', proportion: 0.72, gloss: false } },
  ],
  alocasia: [
    { id: 'polly', name: 'amazonica Polly', weight: 100 },
    { id: 'frydek', name: 'micholitziana Frydek', weight: 20, hue: [150, 166], saturation: [38, 48], lightness: [15, 20], look: { gloss: false } },
    { id: 'zebrina', name: 'zebrina', weight: 40, hue: [115, 135], lightness: [28, 36] },
    { id: 'regal', name: 'Regal Shield', weight: 15, hue: [160, 180], lightness: [12, 18], size: 1.1 },
    { id: 'velvet', name: 'reginula Black Velvet', weight: 3, hue: [200, 235], saturation: [10, 20], lightness: [10, 16], size: 0.6, shape: 'heart', look: { proportion: 0.95, gloss: false } },
    { id: 'cuprea', name: 'cuprea', weight: 5, hue: [18, 34], saturation: [28, 40], lightness: [18, 25], shape: 'heart', size: 0.8, look: { proportion: 0.9 } },
    { id: 'macrorrhizos', name: 'macrorrhizos', weight: 60, hue: [110, 130], lightness: [30, 40], size: 1.2, look: { pattern: 'pinnate', proportion: 0.85 } },
  ],
  anthurium: [
    { id: 'andraeanum', name: 'andraeanum', weight: 100 },
    { id: 'clarinervium', name: 'clarinervium', weight: 12, hue: [140, 160], lightness: [15, 22], look: { pattern: 'bold', proportion: 1, gloss: false } },
    { id: 'crystallinum', name: 'crystallinum', weight: 25, hue: [135, 150], lightness: [22, 28], look: { pattern: 'bold', proportion: 0.9, gloss: false } },
    { id: 'veitchii', name: 'veitchii', weight: 4, shape: 'lance', size: 1.15, look: { pattern: 'pinnate', proportion: 0.38 } },
    { id: 'warocqueanum', name: 'warocqueanum', weight: 2, shape: 'lance', lightness: [14, 20], size: 1.15, look: { pattern: 'bold', proportion: 0.42, gloss: false } },
    { id: 'scherzerianum', name: 'scherzerianum', weight: 60, shape: 'lance', flower: '#e8452c', look: { proportion: 0.45 } },
  ],
  begonia: [
    { id: 'maculata', name: 'maculata', weight: 100 },
    { id: 'rex', name: 'rex', weight: 45, hue: [310, 345], saturation: [26, 38], lightness: [24, 32], look: { pattern: 'painted', spots: false } },
    { id: 'masoniana', name: 'masoniana', weight: 20, hue: [84, 100], look: { pattern: 'bold', spots: false } },
    { id: 'bowerae', name: 'bowerae Tiger', weight: 12, hue: [78, 98], size: 0.72, look: { pattern: 'painted', spots: false } },
    { id: 'listada', name: 'listada', weight: 6, hue: [115, 135], lightness: [18, 26], shape: 'lance', look: { pattern: 'bold', proportion: 0.55, spots: false } },
    { id: 'coccinea', name: 'coccinea', weight: 60, shape: 'lance', flower: '#c8202f', look: { pattern: 'pinnate', proportion: 0.58, spots: false, asymmetry: 0.85 } },
  ],
  calathea: [
    { id: 'makoyana', name: 'makoyana', weight: 100 },
    { id: 'orbifolia', name: 'orbifolia', weight: 8, hue: [125, 145], lightness: [32, 40], shape: 'round', look: { proportion: 0.95 } },
    { id: 'ornata', name: 'ornata', weight: 45, hue: [150, 170], lightness: [17, 24], shape: 'lance', look: { proportion: 0.5 } },
    { id: 'zebrina', name: 'zebrina', weight: 60, hue: [120, 140], look: { proportion: 0.6 } },
    { id: 'lancifolia', name: 'lancifolia', weight: 30, hue: [100, 120], shape: 'lance', size: 1.1, look: { proportion: 0.32 } },
    { id: 'rufibarba', name: 'rufibarba', weight: 15, hue: [115, 135], shape: 'lance', look: { pattern: 'smooth', proportion: 0.34 } },
  ],
  hoya: [
    { id: 'carnosa', name: 'carnosa', weight: 100 },
    { id: 'kerrii', name: 'kerrii', weight: 60, shape: 'heart', look: { proportion: 1.05 } },
    { id: 'linearis', name: 'linearis', weight: 4, shape: 'lance', size: 0.7, hue: [95, 115], look: { proportion: 0.18 } },
    { id: 'pubicalyx', name: 'pubicalyx', weight: 15, shape: 'lance', lightness: [18, 26], flower: '#7b2750', look: { pattern: 'pinnate', proportion: 0.45 } },
    { id: 'australis', name: 'australis', weight: 25, shape: 'round', lightness: [30, 38], look: { proportion: 0.95 } },
    { id: 'obovata', name: 'obovata', weight: 35, shape: 'round', size: 1.1, look: { proportion: 1, spots: true } },
  ],
  neoregelia: [{ id: 'carolinae', name: 'carolinae', weight: 40 }],
  guzmania: [{ id: 'lingulata', name: 'lingulata', weight: 40 }],
  vriesea: [{ id: 'splendens', name: 'splendens', weight: 25 }],
  aechmea: [{ id: 'fasciata', name: 'fasciata', weight: 25 }],
  tillandsia: [{ id: 'cyanea', name: 'cyanea', weight: 10 }],
  syngonium: [
    { id: 'podophyllum', name: 'podophyllum', weight: 100 },
    { id: 'robusta', name: 'Neon Robusta', weight: 30, hue: [340, 352], saturation: [38, 50], lightness: [58, 68], look: { pattern: 'palmate', gloss: false } },
    { id: 'erythrophyllum', name: 'erythrophyllum', weight: 25, hue: [14, 30], saturation: [26, 38], lightness: [22, 30], size: 0.75 },
    { id: 'macrophyllum', name: 'macrophyllum Frosted Heart', weight: 15, shape: 'heart', hue: [120, 140], saturation: [14, 24], lightness: [46, 54], look: { pattern: 'bold', proportion: 0.9, gloss: false } },
    { id: 'wendlandii', name: 'wendlandii', weight: 8, hue: [150, 165], lightness: [14, 20], look: { pattern: 'bold', gloss: false } },
    { id: 'auritum', name: 'auritum', weight: 4, size: 1.2, hue: [110, 130], lightness: [24, 32], look: { pattern: 'pinnate', proportion: 0.9 } },
  ],
  peperomia: [
    { id: 'obtusifolia', name: 'obtusifolia', weight: 100 },
    { id: 'caperata', name: 'caperata Rosso', weight: 60, hue: [340, 355], saturation: [26, 38], lightness: [18, 25], shape: 'heart', look: { pattern: 'bold', proportion: 0.9, gloss: false } },
    { id: 'argyreia', name: 'argyreia Watermelon', weight: 40, hue: [120, 140], lightness: [28, 34], look: { pattern: 'painted', proportion: 0.85 } },
    { id: 'polybotrya', name: 'polybotrya Raindrop', weight: 35, shape: 'heart', hue: [95, 115], lightness: [32, 40], size: 1.15, look: { proportion: 0.82 } },
    { id: 'tetraphylla', name: 'tetraphylla Hope', weight: 12, hue: [105, 125], lightness: [26, 32], size: 0.65, look: { proportion: 0.85 } },
    { id: 'albovittata', name: 'albovittata Piccolo Banda', weight: 5, shape: 'oval', hue: [130, 150], saturation: [16, 26], lightness: [24, 30], look: { pattern: 'painted', proportion: 0.7 } },
  ],
  phalaenopsis: [
    { id: 'amabilis', name: 'amabilis', weight: 100 },
    { id: 'schilleriana', name: 'schilleriana', weight: 30, flower: '#ec9ac4', hue: [135, 155], lightness: [18, 26] },
    { id: 'stuartiana', name: 'stuartiana', weight: 20, flower: '#f7efe2', hue: [140, 158], lightness: [20, 27] },
    { id: 'violacea', name: 'violacea', weight: 10, flower: '#a13c9c' },
    { id: 'equestris', name: 'equestris', weight: 50, flower: '#e76fa5', size: 0.8 },
    { id: 'gigantea', name: 'gigantea', weight: 3, flower: '#e7d88f', size: 1.2 },
    { id: 'bellina', name: 'bellina', weight: 2, flower: '#d8e39a' },
  ],
}

export function varietiesOf(speciesId: string): readonly Variety[] {
  return VARIETIES[speciesId] ?? VARIETIES.monstera
}

export function varietyById(speciesId: string, id: string | undefined): Variety {
  const list = varietiesOf(speciesId)
  return list.find((variety) => variety.id === id) ?? list[0]
}
