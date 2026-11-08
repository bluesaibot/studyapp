/** Pots only look nice. The first seven are the glazes from before the shop, so plants keep theirs. */
export type PotShape = 'classic' | 'cylinder' | 'bowl' | 'tall' | 'footed' | 'ribbed' | 'scalloped' | 'checker' | 'wave' | 'dotted'

export interface PotDesign {
  name: string
  shape: PotShape
  color: string
  /** Second colour of a pattern. */
  accent?: string
  price: number
}

const LEGACY: readonly PotDesign[] = [
  { name: 'Teal glaze', shape: 'classic', color: '#2e6e7e', price: 0 },
  { name: 'Indigo glaze', shape: 'classic', color: '#3d4f7c', price: 80 },
  { name: 'Plum glaze', shape: 'classic', color: '#7a5c8e', price: 80 },
  { name: 'Terracotta', shape: 'classic', color: '#b5533c', price: 60 },
  { name: 'Stone', shape: 'classic', color: '#d9d4c5', price: 60 },
  { name: 'Charcoal glaze', shape: 'classic', color: '#2f2f35', price: 80 },
  { name: 'Gold glaze', shape: 'classic', color: '#c79a2d', price: 900 },
]

const COLORS = {
  Butter: '#f3e3a6',
  Blush: '#f2c6c2',
  Sage: '#c5d8b8',
  Sky: '#bcd6e6',
  Lilac: '#d3c6e6',
  Peach: '#f5cda8',
  Mint: '#bfe3d2',
  Cream: '#f1ebdc',
} as const

type ColorName = keyof typeof COLORS

const LINE: Record<PotShape, { label: string; price: number; colors: readonly ColorName[]; accent?: Partial<Record<ColorName, string>> }> = {
  classic: { label: 'pot', price: 40, colors: ['Blush', 'Sage', 'Sky'] },
  cylinder: { label: 'cylinder', price: 50, colors: ['Butter', 'Lilac', 'Cream'] },
  bowl: { label: 'bowl', price: 60, colors: ['Peach', 'Mint', 'Sky'] },
  tall: { label: 'tall pot', price: 70, colors: ['Sage', 'Blush', 'Cream'] },
  footed: { label: 'footed pot', price: 90, colors: ['Lilac', 'Butter', 'Mint'] },
  ribbed: { label: 'ribbed pot', price: 120, colors: ['Cream', 'Peach', 'Sky'] },
  scalloped: { label: 'scallop', price: 160, colors: ['Blush', 'Butter', 'Lilac'] },
  wave: { label: 'wave pot', price: 200, colors: ['Sky', 'Mint', 'Peach'], accent: { Sky: '#f1ebdc', Mint: '#f3e3a6', Peach: '#f2c6c2' } },
  dotted: { label: 'dotted pot', price: 220, colors: ['Cream', 'Sage', 'Blush'], accent: { Cream: '#e8a7a0', Sage: '#f1ebdc', Blush: '#f1ebdc' } },
  checker: { label: 'checker pot', price: 300, colors: ['Butter', 'Lilac', 'Mint'], accent: { Butter: '#f1ebdc', Lilac: '#f1ebdc', Mint: '#f1ebdc' } },
}

const PASTELS: readonly PotDesign[] = (Object.keys(LINE) as PotShape[]).flatMap((shape) =>
  LINE[shape].colors.map((name) => ({ name: `${name} ${LINE[shape].label}`, shape, color: COLORS[name], accent: LINE[shape].accent?.[name], price: LINE[shape].price })),
)

/** New designs go at the end: a plant stores its pot by this position. */
export const POT_DESIGNS: readonly PotDesign[] = [...LEGACY, ...PASTELS]

export function potDesign(pot: number): PotDesign {
  return POT_DESIGNS[pot % POT_DESIGNS.length]
}
