import type { LeafShape } from './plants'

export type LeafPattern = 'pinnate' | 'bold' | 'painted' | 'palmate' | 'smooth'

/** A real plant within a species group. Anything left out comes from the group. */
export interface Variety {
  id: string
  name: string
  /** Only grows from uncommon and rare seeds, or from your own crosses. */
  rare?: boolean
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
    { id: 'deliciosa', name: 'deliciosa' },
    { id: 'borsigiana', name: 'borsigiana', fenestration: [0.35, 0.7], size: 0.85 },
    { id: 'adansonii', name: 'adansonii', fenestration: [0.75, 1], size: 0.72, hue: [120, 140], look: { proportion: 0.7 } },
    { id: 'karstenii', name: 'Peru', fenestration: [0, 0], hue: [150, 170], lightness: [17, 24], shape: 'oval', size: 0.78, look: { proportion: 0.68 } },
    { id: 'dubia', name: 'dubia', rare: true, fenestration: [0, 0], hue: [150, 172], saturation: [16, 28], lightness: [32, 42], shape: 'oval', size: 0.7, look: { pattern: 'painted', proportion: 0.78, gloss: false } },
    { id: 'siltepecana', name: 'siltepecana', rare: true, fenestration: [0, 0], hue: [165, 190], saturation: [16, 28], lightness: [40, 50], shape: 'lance', size: 0.72, look: { pattern: 'bold', proportion: 0.6 } },
    { id: 'standleyana', name: 'standleyana', fenestration: [0, 0], hue: [115, 135], shape: 'oval', size: 0.8, look: { proportion: 0.55 } },
  ],
  philodendron: [
    { id: 'hederaceum', name: 'hederaceum', shape: 'heart', hue: [105, 125], size: 0.85 },
    { id: 'micans', name: 'micans', shape: 'heart', hue: [18, 38], saturation: [24, 36], lightness: [17, 25], size: 0.75, look: { gloss: false } },
    { id: 'melanochrysum', name: 'melanochrysum', rare: true, hue: [150, 165], lightness: [11, 17], look: { pattern: 'bold', proportion: 0.6, gloss: false } },
    { id: 'gloriosum', name: 'gloriosum', rare: true, shape: 'heart', hue: [135, 150], size: 1.15, look: { pattern: 'bold', proportion: 1.05, gloss: false } },
    { id: 'verrucosum', name: 'verrucosum', rare: true, shape: 'heart', hue: [120, 140], lightness: [20, 28], look: { pattern: 'painted', proportion: 0.95, gloss: false } },
    { id: 'erubescens', name: 'erubescens', hue: [348, 360], saturation: [34, 48], lightness: [20, 28] },
  ],
  pothos: [
    { id: 'jade', name: 'aureum Jade' },
    { id: 'neon', name: 'aureum Neon', hue: [70, 82], saturation: [58, 72], lightness: [42, 50] },
    { id: 'cebu', name: 'pinnatum Cebu Blue', hue: [170, 190], saturation: [18, 30], lightness: [38, 47], shape: 'oval', look: { proportion: 0.62 } },
    { id: 'baltic', name: 'pinnatum Baltic Blue', hue: [165, 182], saturation: [24, 34], lightness: [27, 34], shape: 'oval', look: { proportion: 0.7 } },
    { id: 'skeleton', name: 'pinnatum Skeleton Key', rare: true, hue: [130, 150], shape: 'lance', look: { pattern: 'bold', proportion: 0.46 } },
    { id: 'pictus', name: 'Scindapsus pictus', hue: [140, 158], saturation: [20, 32], lightness: [26, 34], shape: 'oval', look: { pattern: 'painted', proportion: 0.72, gloss: false } },
  ],
  alocasia: [
    { id: 'polly', name: 'amazonica Polly' },
    { id: 'frydek', name: 'micholitziana Frydek', hue: [150, 166], saturation: [38, 48], lightness: [15, 20], look: { gloss: false } },
    { id: 'zebrina', name: 'zebrina', hue: [115, 135], lightness: [28, 36] },
    { id: 'regal', name: 'Regal Shield', hue: [160, 180], lightness: [12, 18], size: 1.1 },
    { id: 'velvet', name: 'reginula Black Velvet', rare: true, hue: [200, 235], saturation: [10, 20], lightness: [10, 16], size: 0.6, shape: 'heart', look: { proportion: 0.95, gloss: false } },
    { id: 'cuprea', name: 'cuprea', rare: true, hue: [18, 34], saturation: [28, 40], lightness: [18, 25], shape: 'heart', size: 0.8, look: { proportion: 0.9 } },
    { id: 'macrorrhizos', name: 'macrorrhizos', hue: [110, 130], lightness: [30, 40], size: 1.2, look: { pattern: 'pinnate', proportion: 0.85 } },
  ],
  anthurium: [
    { id: 'andraeanum', name: 'andraeanum' },
    { id: 'clarinervium', name: 'clarinervium', rare: true, hue: [140, 160], lightness: [15, 22], look: { pattern: 'bold', proportion: 1, gloss: false } },
    { id: 'crystallinum', name: 'crystallinum', hue: [135, 150], lightness: [22, 28], look: { pattern: 'bold', proportion: 0.9, gloss: false } },
    { id: 'veitchii', name: 'veitchii', rare: true, shape: 'lance', size: 1.15, look: { pattern: 'pinnate', proportion: 0.38 } },
    { id: 'warocqueanum', name: 'warocqueanum', rare: true, shape: 'lance', lightness: [14, 20], size: 1.15, look: { pattern: 'bold', proportion: 0.42, gloss: false } },
    { id: 'scherzerianum', name: 'scherzerianum', shape: 'lance', flower: '#e8452c', look: { proportion: 0.45 } },
  ],
  begonia: [
    { id: 'maculata', name: 'maculata' },
    { id: 'rex', name: 'rex', hue: [310, 345], saturation: [26, 38], lightness: [24, 32], look: { pattern: 'painted', spots: false } },
    { id: 'masoniana', name: 'masoniana', hue: [84, 100], look: { pattern: 'bold', spots: false } },
    { id: 'bowerae', name: 'bowerae Tiger', hue: [78, 98], size: 0.72, look: { pattern: 'painted', spots: false } },
    { id: 'listada', name: 'listada', hue: [115, 135], lightness: [18, 26], shape: 'lance', look: { pattern: 'bold', proportion: 0.55, spots: false } },
    { id: 'coccinea', name: 'coccinea', shape: 'lance', flower: '#c8202f', look: { pattern: 'pinnate', proportion: 0.58, spots: false, asymmetry: 0.85 } },
  ],
  calathea: [
    { id: 'makoyana', name: 'makoyana' },
    { id: 'orbifolia', name: 'orbifolia', hue: [125, 145], lightness: [32, 40], shape: 'round', look: { proportion: 0.95 } },
    { id: 'ornata', name: 'ornata', hue: [150, 170], lightness: [17, 24], shape: 'lance', look: { proportion: 0.5 } },
    { id: 'zebrina', name: 'zebrina', hue: [120, 140], look: { proportion: 0.6 } },
    { id: 'lancifolia', name: 'lancifolia', hue: [100, 120], shape: 'lance', size: 1.1, look: { proportion: 0.32 } },
    { id: 'rufibarba', name: 'rufibarba', hue: [115, 135], shape: 'lance', look: { pattern: 'smooth', proportion: 0.34 } },
  ],
  hoya: [
    { id: 'carnosa', name: 'carnosa' },
    { id: 'kerrii', name: 'kerrii', shape: 'heart', look: { proportion: 1.05 } },
    { id: 'linearis', name: 'linearis', rare: true, shape: 'lance', size: 0.7, hue: [95, 115], look: { proportion: 0.18 } },
    { id: 'pubicalyx', name: 'pubicalyx', shape: 'lance', lightness: [18, 26], flower: '#7b2750', look: { pattern: 'pinnate', proportion: 0.45 } },
    { id: 'australis', name: 'australis', shape: 'round', lightness: [30, 38], look: { proportion: 0.95 } },
    { id: 'obovata', name: 'obovata', shape: 'round', size: 1.1, look: { proportion: 1, spots: true } },
  ],
  neoregelia: [{ id: 'carolinae', name: 'carolinae' }],
  guzmania: [{ id: 'lingulata', name: 'lingulata' }],
  vriesea: [{ id: 'splendens', name: 'splendens' }],
  aechmea: [{ id: 'fasciata', name: 'fasciata' }],
  tillandsia: [{ id: 'cyanea', name: 'cyanea' }],
  phalaenopsis: [
    { id: 'amabilis', name: 'amabilis' },
    { id: 'schilleriana', name: 'schilleriana', flower: '#ec9ac4', hue: [135, 155], lightness: [18, 26] },
    { id: 'stuartiana', name: 'stuartiana', flower: '#f7efe2', hue: [140, 158], lightness: [20, 27] },
    { id: 'violacea', name: 'violacea', flower: '#a13c9c' },
    { id: 'equestris', name: 'equestris', flower: '#e76fa5', size: 0.8 },
    { id: 'gigantea', name: 'gigantea', rare: true, flower: '#e7d88f', size: 1.2 },
    { id: 'bellina', name: 'bellina', rare: true, flower: '#d8e39a' },
  ],
}

export function varietiesOf(speciesId: string): readonly Variety[] {
  return VARIETIES[speciesId] ?? VARIETIES.monstera
}

export function varietyById(speciesId: string, id: string | undefined): Variety {
  const list = varietiesOf(speciesId)
  return list.find((variety) => variety.id === id) ?? list[0]
}
