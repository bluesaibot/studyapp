import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  fenestrationProgress,
  flowerProgress,
  leafEmergence,
  MAX_LEAVES,
  POT_COLORS,
  smoothstep,
  speciesById,
  SPROUT_GROWTH,
  type Genome,
  type LeafShape,
  type Species,
} from '../../core/plants'
import { between, createRng, type Rng } from '../../core/rng'

const POT_TOP = 400
const CENTER = 200
const FULL_SIZE_GROWTH = 300

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const radians = (degrees: number) => (degrees * Math.PI) / 180

function leafOutline(shape: LeafShape, length: number, width: number, asymmetry = 1): string {
  const half = (side: number, reverse: boolean): string => {
    const w = width * side * (side < 0 ? asymmetry : 1)
    const curves: Record<LeafShape, [number, number, number, number, number, number][]> = {
      heart: [
        [-w * 0.2, length * 0.16, -w * 0.66, length * 0.18, -w * 0.62, -length * 0.2],
        [-w * 0.56, -length * 0.58, -w * 0.16, -length * 0.86, 0, -length],
      ],
      arrow: [
        [-w * 0.1, length * 0.34, -w * 0.5, length * 0.44, -w * 0.46, -length * 0.02],
        [-w * 0.38, -length * 0.42, -w * 0.08, -length * 0.8, 0, -length],
      ],
      oval: [
        [-w * 0.3, length * 0.02, -w * 0.56, -length * 0.22, -w * 0.5, -length * 0.5],
        [-w * 0.44, -length * 0.78, -w * 0.16, -length * 0.94, 0, -length],
      ],
      lance: [
        [-w * 0.2, -length * 0.04, -w * 0.42, -length * 0.26, -w * 0.36, -length * 0.5],
        [-w * 0.3, -length * 0.74, -w * 0.1, -length * 0.92, 0, -length],
      ],
      round: [
        [-w * 0.34, length * 0.12, -w * 0.72, -length * 0.02, -w * 0.66, -length * 0.46],
        [-w * 0.6, -length * 0.82, -w * 0.24, -length * 0.98, 0, -length],
      ],
      strap: [
        [-w * 0.3, -length * 0.1, -w * 0.3, -length * 0.5, -w * 0.28, -length * 0.7],
        [-w * 0.24, -length * 0.88, -w * 0.08, -length * 0.97, 0, -length],
      ],
    }
    const [a, b] = curves[shape]
    if (!reverse) {
      return `C${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[4]} ${a[5]} C${b[0]} ${b[1]} ${b[2]} ${b[3]} ${b[4]} ${b[5]}`
    }
    return `C${b[2]} ${b[3]} ${b[0]} ${b[1]} ${a[4]} ${a[5]} C${a[2]} ${a[3]} ${a[0]} ${a[1]} 0 0`
  }
  return `M0 0 ${half(1, false)} ${half(-1, true)} Z`
}

const VARIEGATION_COLOR = { marbled: '#eef0d6', sectoral: '#f2f1dc', aurea: '#e7cf58', albo: '#f8f8ef', mint: '#b8e4c8' } as const

function variegationMarks(genome: Genome, rng: Rng, length: number, width: number): ReactNode {
  const { variegation, variegationAmount: amount } = genome
  if (variegation === 'none') return null
  const color = VARIEGATION_COLOR[variegation]

  if (variegation === 'sectoral') {
    const side = rng() < 0.5 ? -1 : 1
    const steps = 7
    const points: string[] = [`0,${length * 0.3}`]
    for (let i = 0; i <= steps; i += 1) {
      const y = length * 0.3 - (i / steps) * (length * 1.3)
      points.push(`${side * between(rng, -width * 0.05, width * 0.12 * (1 - amount))},${y}`)
    }
    points.push(`${side * width},${-length}`, `${side * width},${length * 0.3}`)
    return <polygon points={points.join(' ')} fill={color} />
  }

  const large = variegation === 'aurea' || variegation === 'albo'
  const count = Math.round((large ? 9 : 26) * amount)
  const marks: ReactNode[] = []
  for (let i = 0; i < count; i += 1) {
    const x = between(rng, -width * 0.6, width * 0.6)
    const y = between(rng, -length, length * 0.1)
    const rx = large ? between(rng, width * 0.1, width * 0.28) : between(rng, width * 0.02, width * 0.1)
    const ry = rx * between(rng, 0.35, 0.9)
    const angle = (x > 0 ? -1 : 1) * between(rng, 20, 60)
    marks.push(<ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill={color} transform={`rotate(${angle} ${x} ${y})`} />)
  }
  return marks
}

type LeafPattern = 'pinnate' | 'bold' | 'painted' | 'palmate' | 'smooth'

interface LeafLook {
  pattern: LeafPattern
  /** How much narrower the left half is; begonias are lopsided. */
  asymmetry?: number
  /** Width relative to length. */
  proportion: number
  spots?: boolean
  gloss?: boolean
}

const LEAF_LOOK: Record<string, LeafLook> = {
  monstera: { pattern: 'pinnate', proportion: 1.02, gloss: true },
  philodendron: { pattern: 'pinnate', proportion: 0.82, gloss: true },
  pothos: { pattern: 'pinnate', proportion: 0.86 },
  alocasia: { pattern: 'bold', proportion: 0.74, gloss: true },
  anthurium: { pattern: 'palmate', proportion: 0.86, gloss: true },
  begonia: { pattern: 'palmate', proportion: 1, asymmetry: 0.72, spots: true },
  calathea: { pattern: 'painted', proportion: 0.72 },
  hoya: { pattern: 'smooth', proportion: 0.74, gloss: true },
}

function LeafVeins({ pattern, genome, length, width }: { pattern: LeafPattern; genome: Genome; length: number; width: number }) {
  const line = `hsl(${genome.hue + 8} ${genome.saturation}% ${genome.lightness + 22}%)`
  const thin = Math.max(0.6, length * 0.009)

  if (pattern === 'bold') {
    const white = `hsl(${genome.hue} 30% 86%)`
    return (
      <g stroke={white} fill="none" strokeLinecap="round">
        <line x1={0} y1={length * 0.05} x2={0} y2={-length * 0.97} strokeWidth={length * 0.026} />
        {[0.08, 0.26, 0.44, 0.62, 0.78].flatMap((row) =>
          [-1, 1].map((side) => (
            <path
              key={`${row}${side}`}
              d={`M0 ${-length * row} Q${side * width * 0.3} ${-length * (row + 0.03)} ${side * width * 0.5} ${-length * (row + 0.13)}`}
              strokeWidth={length * 0.015}
            />
          )),
        )}
      </g>
    )
  }

  if (pattern === 'painted') {
    const light = `hsl(${genome.hue - 10} ${genome.saturation + 6}% ${genome.lightness + 30}%)`
    const dark = `hsl(${genome.hue + 6} ${genome.saturation}% ${Math.max(10, genome.lightness - 12)}%)`
    return (
      <g fill="none" strokeLinecap="round">
        {Array.from({ length: 9 }, (_, i) => {
          const y = length * (0.08 + i * 0.095)
          const tone = i % 2 === 0 ? dark : light
          return [-1, 1].map((side) => (
            <path
              key={`${i}${side}`}
              d={`M0 ${-y} Q${side * width * 0.28} ${-y - length * 0.03} ${side * width * 0.56} ${-y - length * 0.1}`}
              stroke={tone}
              strokeWidth={length * (i % 2 === 0 ? 0.034 : 0.022)}
            />
          ))
        })}
        <line x1={0} y1={0} x2={0} y2={-length * 0.96} stroke={light} strokeWidth={length * 0.014} />
      </g>
    )
  }

  if (pattern === 'palmate') {
    return (
      <g stroke={line} fill="none" strokeLinecap="round" strokeWidth={thin}>
        {[-58, -34, -14, 14, 34, 58].map((angle) => (
          <line key={angle} x1={0} y1={0} x2={Math.sin(radians(angle)) * length * 0.72} y2={-Math.cos(radians(angle)) * length * 0.72} />
        ))}
        <line x1={0} y1={0} x2={0} y2={-length * 0.96} strokeWidth={thin * 1.8} />
      </g>
    )
  }

  if (pattern === 'smooth') {
    return <line x1={0} y1={0} x2={0} y2={-length * 0.9} stroke={line} strokeWidth={thin * 1.4} strokeLinecap="round" />
  }

  return (
    <g stroke={line} fill="none" strokeLinecap="round" strokeWidth={thin}>
      {[0.16, 0.32, 0.48, 0.64, 0.78].flatMap((row) =>
        [-1, 1].map((side) => (
          <path
            key={`${row}${side}`}
            d={`M0 ${-length * row} Q${side * width * 0.26} ${-length * (row + 0.05)} ${side * width * 0.5} ${-length * (row + 0.15)}`}
          />
        )),
      )}
      <line x1={0} y1={length * 0.02} x2={0} y2={-length * 0.97} strokeWidth={thin * 2} />
    </g>
  )
}

/** Monstera splits: they open from the margin toward the midrib, then holes appear beside it. */
function MonsteraCuts({ genome, length, width, open, rng }: { genome: Genome; length: number; width: number; open: number; rng: Rng }) {
  const rows = 3 + Math.round(genome.fenestration * 2)
  const cuts: ReactNode[] = []
  for (let row = 0; row < rows; row += 1) {
    const y = -length * (0.12 + (row / rows) * 0.62)
    for (const side of [-1, 1]) {
      const inner = lerp(width * 0.62, width * between(rng, 0.12, 0.2), open)
      const spread = length * 0.038 * open
      const outerX = side * width * 0.95
      const rise = length * 0.16
      cuts.push(
        <path
          key={`${row}${side}`}
          d={`M${side * inner} ${y} Q${side * width * 0.5} ${y - rise * 0.42 - spread} ${outerX} ${y - rise - spread} L${outerX} ${y - rise + spread} Q${side * width * 0.5} ${y - rise * 0.42 + spread * 0.5} ${side * inner} ${y} Z`}
          fill="#000"
        />,
      )
      if (open > 0.7 && row > 0 && row < rows - 1 && row % 2 === 1) {
        const size = length * 0.028 * smoothstep((open - 0.7) / 0.3)
        cuts.push(<ellipse key={`h${row}${side}`} cx={side * width * 0.09} cy={y - length * 0.035} rx={size} ry={size * 1.7} fill="#000" transform={`rotate(${side * 28} ${side * width * 0.09} ${y - length * 0.035})`} />)
      }
    }
  }
  return <>{cuts}</>
}

interface LeafProps {
  id: string
  genome: Genome
  species: Species
  seed: number
  length: number
  width: number
  /** 0 to 1, how far the splits have opened. */
  holes: number
}

function Leaf({ id, genome, species, seed, length, width, holes }: LeafProps) {
  const rng = createRng(seed)
  const look = LEAF_LOOK[species.id] ?? LEAF_LOOK.pothos
  const outline = leafOutline(species.shape, length, width, look.asymmetry)
  const tone = between(rng, -3, 3)
  const fill = `hsl(${genome.hue + tone} ${genome.saturation}% ${genome.lightness + tone}%)`
  const cut = species.id === 'monstera' && holes > 0
  const spots = look.spots
    ? Array.from({ length: 16 }, (_, i) => {
        const x = between(rng, -width * 0.6, width * 0.6)
        const y = between(rng, -length * 0.92, length * 0.04)
        return <circle key={i} cx={x} cy={y} r={length * between(rng, 0.012, 0.03)} fill="#e6ecdf" opacity={0.85} />
      })
    : null

  return (
    <g>
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={outline} />
        </clipPath>
        {cut && (
          <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={-width * 1.1} y={-length * 1.2} width={width * 2.2} height={length * 1.6}>
            <path d={outline} fill="#fff" />
            <MonsteraCuts genome={genome} length={length} width={width} open={holes} rng={rng} />
          </mask>
        )}
      </defs>
      <g mask={cut ? `url(#${id}-mask)` : undefined}>
        <path d={outline} fill={fill} />
        <g clipPath={`url(#${id}-clip)`}>
          {variegationMarks(genome, rng, length, width)}
          {spots}
          <LeafVeins pattern={look.pattern} genome={genome} length={length} width={width} />
          <rect x={-width * 1.1} y={-length * 1.1} width={width * 1.1} height={length * 1.6} fill="#06201a" opacity={0.13} />
          {look.gloss && <ellipse cx={width * 0.22} cy={-length * 0.56} rx={width * 0.12} ry={length * 0.2} fill="#fff" opacity={0.1} />}
        </g>
      </g>
    </g>
  )
}

/** The hooded flower of aroids: monstera, philodendron, pothos, alocasia, anthurium. */
function Spathe({ species, x, y, angle, scale }: { species: Species; x: number; y: number; angle: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <path d="M0 0 C-22 -10 -24 -44 0 -66 C24 -44 22 -10 0 0 Z" fill={species.flower} />
      <rect x={-4} y={-46} width={8} height={38} rx={4} fill="#d9a92f" />
    </g>
  )
}

/** A loose bunch of small flowers, as on a begonia or calathea. */
function Cluster({ color, x, y, scale, seed }: { color: string; x: number; y: number; scale: number; seed: number }) {
  const rng = createRng(seed)
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {Array.from({ length: 9 }, (_, i) => {
        const cx = between(rng, -18, 18)
        const cy = between(rng, -18, 12)
        return (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            {[0, 72, 144, 216, 288].map((angle) => (
              <ellipse key={angle} cx={0} cy={-4.5} rx={2.8} ry={4.5} fill={color} transform={`rotate(${angle})`} />
            ))}
            <circle r={1.8} fill="#e6b93a" />
          </g>
        )
      })}
    </g>
  )
}

/** A hoya umbel: a ball of waxy little stars. */
function Umbel({ color, x, y, scale }: { color: string; x: number; y: number; scale: number }) {
  const stars = [[0, 0], [-11, -5], [11, -5], [-7, 8], [7, 8], [0, -13], [-15, 6], [15, 6], [0, 14]]
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {stars.map(([cx, cy]) => (
        <g key={`${cx}${cy}`} transform={`translate(${cx} ${cy})`}>
          {[0, 72, 144, 216, 288].map((angle) => (
            <path key={angle} d="M0 0 L-2.6 -3 L0 -7 L2.6 -3 Z" fill={color} transform={`rotate(${angle})`} />
          ))}
          <circle r={1.7} fill="#b2345a" />
        </g>
      ))}
    </g>
  )
}

interface PlacedLeaf {
  key: number
  x: number
  y: number
  rotation: number
  length: number
}

function leafNodes(leaves: readonly PlacedLeaf[], genome: Genome, species: Species, uid: string, holes: number): ReactNode[] {
  const look = LEAF_LOOK[species.id] ?? LEAF_LOOK.pothos
  return leaves
    .filter((leaf) => leaf.length >= 1)
    .map((leaf) => (
      <g key={leaf.key} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotation})`}>
        <Leaf
          id={`${uid}-${leaf.key}`}
          genome={genome}
          species={species}
          seed={genome.seed + leaf.key * 977}
          length={leaf.length}
          width={leaf.length * look.proportion}
          holes={holes}
        />
      </g>
    ))
}

function unfolded(emergence: number, index: number): number {
  return smoothstep(emergence - index)
}

const stemColor = (genome: Genome) => `hsl(${genome.hue} ${genome.saturation}% ${genome.lightness + 8}%)`

/** Climbers: a stem works its way up a moss pole and sends leaves out to both sides. */
function drawPole(genome: Genome, species: Species, growth: number, uid: string, maturity: number): ReactNode {
  const isMonstera = species.id === 'monstera'
  const emergence = leafEmergence(growth)
  const spacing = isMonstera ? 21 : 19
  const nodeY = (i: number) => POT_TOP - 26 - i * spacing
  const nodeX = (i: number) => CENTER + Math.sin(i * 1.9) * 8
  const poleTop = Math.min(nodeY(0), nodeY(emergence + 1.6)) - 18
  const poleOpacity = smoothstep((growth - SPROUT_GROWTH) / 10)

  const petioles: ReactNode[] = []
  const placed: PlacedLeaf[] = []
  const roots: ReactNode[] = []
  const stemPoints: string[] = [`${CENTER} ${POT_TOP - 4}`]

  for (let i = 0; i < MAX_LEAVES; i += 1) {
    const unfold = unfolded(emergence, i)
    if (unfold <= 0) break
    const rng = createRng(genome.seed + i * 101)
    const side = i % 2 === 0 ? 1 : -1
    const x = nodeX(i)
    const y = lerp(nodeY(Math.max(0, i - 1)), nodeY(i), unfold)
    stemPoints.push(`${x} ${y}`)

    const reach = between(rng, isMonstera ? 62 : 48, isMonstera ? 104 : 84) * (0.6 + 0.4 * maturity) * unfold
    const lift = radians(between(rng, 6, 44))
    const tipX = x + side * Math.cos(lift) * reach
    const tipY = y - Math.sin(lift) * reach
    petioles.push(
      <path
        key={i}
        d={`M${x} ${y} Q${x + side * reach * 0.5} ${y - reach * 0.44} ${tipX} ${tipY}`}
        stroke={stemColor(genome)}
        strokeWidth={Math.max(1.6, 3.2 * maturity)}
        strokeLinecap="round"
        fill="none"
      />,
    )
    placed.push({
      key: i,
      x: tipX,
      y: tipY,
      rotation: side * lerp(40, between(rng, 104, 150), unfold),
      length: between(rng, isMonstera ? 76 : 60, isMonstera ? 104 : 82) * maturity * genome.size * unfold,
    })

    if (isMonstera && i > 2 && i % 3 === 0 && growth > 90) {
      const drop = smoothstep((growth - 90) / 80)
      roots.push(
        <path
          key={i}
          d={`M${x} ${y} Q${x - side * 26} ${lerp(y, POT_TOP, 0.5)} ${x - side * 34} ${lerp(y, POT_TOP - 4, drop)}`}
          stroke="#6b5136"
          strokeWidth={1.8}
          strokeLinecap="round"
          fill="none"
        />,
      )
    }
  }

  const bloom = flowerProgress(growth)
  return (
    <>
      <g opacity={poleOpacity}>
        <rect x={CENTER - 8} y={poleTop} width={16} height={POT_TOP - 4 - poleTop} rx={5} fill="#6f5238" />
        {Array.from({ length: Math.floor((POT_TOP - poleTop) / 14) }, (_, i) => (
          <path key={i} d={`M${CENTER - 8} ${POT_TOP - 12 - i * 14} q8 -6 16 0`} stroke="#8d7150" strokeWidth={2} fill="none" />
        ))}
      </g>
      {roots}
      <polyline points={stemPoints.join(' ')} stroke={stemColor(genome)} strokeWidth={Math.max(3, 7 * maturity)} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {petioles}
      {leafNodes(placed, genome, species, uid, fenestrationProgress(growth))}
      {bloom > 0 && <Spathe species={species} x={nodeX(4) - 26} y={nodeY(4)} angle={-16} scale={bloom} />}
    </>
  )
}

/** Vines: a small crown on top, and long stems that spill over the rim and hang beside the pot. */
function drawTrail(genome: Genome, species: Species, growth: number, uid: string, maturity: number): ReactNode {
  const CROWN = 5
  const VINES = [
    { side: 1, out: 70 },
    { side: -1, out: 74 },
    { side: 1, out: 110 },
    { side: -1, out: 118 },
  ]
  const emergence = leafEmergence(growth) * 1.6
  const pathAt = (vine: (typeof VINES)[number], s: number) => {
    const over = 56
    if (s < over) {
      const t = s / over
      return { x: CENTER + vine.side * (30 + t * (vine.out - 30)), y: POT_TOP - 8 - Math.sin(t * Math.PI) * 20 }
    }
    const down = s - over
    return { x: CENTER + vine.side * (vine.out + down * 0.1 + Math.sin(down * 0.08) * 4), y: POT_TOP - 8 + down * 0.92 }
  }

  const stems: ReactNode[] = []
  const placed: PlacedLeaf[] = []
  const count = Math.ceil(emergence)
  const vineEnd = VINES.map(() => 0)

  for (let i = 0; i < count; i += 1) {
    const unfold = unfolded(emergence, i)
    if (unfold <= 0) break
    const rng = createRng(genome.seed + i * 101)
    if (i < CROWN) {
      const side = i % 2 === 0 ? 1 : -1
      const spread = radians(((i % 3) + 1) * 15)
      const reach = between(rng, 40, 74) * (0.6 + 0.4 * maturity) * unfold
      const tipX = CENTER + side * Math.sin(spread) * reach
      const tipY = POT_TOP - 6 - Math.cos(spread) * reach
      stems.push(<path key={i} d={`M${CENTER} ${POT_TOP - 4} Q${CENTER + (tipX - CENTER) * 0.2} ${tipY + 16} ${tipX} ${tipY}`} stroke={stemColor(genome)} strokeWidth={2.4} strokeLinecap="round" fill="none" />)
      placed.push({ key: i, x: tipX, y: tipY, rotation: side * between(rng, 50, 105), length: between(rng, 44, 60) * (0.55 + 0.45 * maturity) * genome.size * unfold })
      continue
    }
    const index = i - CROWN
    const vineIndex = index % VINES.length
    const vine = VINES[vineIndex]
    const row = Math.floor(index / VINES.length)
    const s = (30 + row * 23 + (vineIndex % 2) * 6) * lerp(0.7, 1, unfold)
    vineEnd[vineIndex] = Math.max(vineEnd[vineIndex], s)
    const at = pathAt(vine, s)
    const alternate = row % 2 === 0 ? 1 : -1
    const hanging = s > 56
    const rotation = vine.side * (hanging ? between(rng, 150, 182) + alternate * 28 : between(rng, 95, 135))
    placed.push({ key: i, x: at.x, y: at.y, rotation, length: between(rng, 34, 48) * (0.6 + 0.4 * maturity) * genome.size * unfold })
  }

  const vineLines = VINES.map((vine, i) => {
    if (vineEnd[i] <= 0) return null
    const points: string[] = []
    for (let s = 0; s <= vineEnd[i]; s += 5) {
      const at = pathAt(vine, s)
      points.push(`${at.x} ${at.y}`)
    }
    return <polyline key={i} points={points.join(' ')} stroke={stemColor(genome)} strokeWidth={2.2} strokeLinecap="round" fill="none" />
  })

  const bloom = flowerProgress(growth)
  return (
    <>
      {stems}
      {vineLines}
      {leafNodes(placed, genome, species, uid, 0)}
      {bloom > 0 && <Spathe species={species} x={CENTER + 18} y={POT_TOP - 62} angle={18} scale={bloom * 0.7} />}
    </>
  )
}

/** Twiners: a stem winds around a wire hoop, with thick leaves in pairs and umbels of flowers. */
function drawHoop(genome: Genome, species: Species, growth: number, uid: string, maturity: number): ReactNode {
  const emergence = leafEmergence(growth) * 1.5
  const total = MAX_LEAVES * 1.5
  // Both ends stand in the soil, and the hoop widens above the pot.
  const hoop = (phi: number) => ({ x: CENTER - (46 + 44 * Math.sin(phi)) * Math.cos(phi), y: POT_TOP - 8 - 300 * Math.sin(phi) })
  const hoopPoints = Array.from({ length: 41 }, (_, i) => {
    const at = hoop((i / 40) * Math.PI)
    return `${at.x} ${at.y}`
  }).join(' ')
  const phiAt = (i: number) => ((i + 1) / (total + 1)) * Math.PI

  const placed: PlacedLeaf[] = []
  const count = Math.ceil(emergence)
  for (let i = 0; i < count; i += 1) {
    const unfold = unfolded(emergence, i)
    if (unfold <= 0) break
    const rng = createRng(genome.seed + i * 101)
    const phi = phiAt(i)
    const at = hoop(phi)
    // Pointing along the outward normal of the hoop, with the pair splayed apart.
    const outward = -(phi * 180) / Math.PI + 90
    const pair = i % 2 === 0 ? -1 : 1
    placed.push({
      key: i,
      x: at.x,
      y: at.y,
      rotation: outward - 90 + pair * between(rng, 44, 82),
      length: between(rng, 36, 50) * (0.6 + 0.4 * maturity) * genome.size * unfold,
    })
  }
  const winding: string[] = []
  const end = phiAt(Math.max(0, emergence - 1))
  for (let phi = 0; phi <= end; phi += 0.03) {
    const at = hoop(phi)
    const wiggle = Math.sin(phi * 34) * 5
    winding.push(`${at.x + wiggle} ${at.y + wiggle * 0.3}`)
  }

  const bloom = flowerProgress(growth)
  const opacity = smoothstep((growth - SPROUT_GROWTH) / 10)
  return (
    <>
      <polyline points={hoopPoints} stroke="#8b8f8a" strokeWidth={3} fill="none" opacity={opacity} />
      <polyline points={winding.join(' ')} stroke={stemColor(genome)} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      {leafNodes(placed, genome, species, uid, 0)}
      {bloom > 0 &&
        [0.2, 0.42, 0.62].map((place, i) => {
          const at = hoop(place * Math.PI)
          return <Umbel key={i} color={species.flower} x={at.x + (i % 2 === 0 ? -26 : 26)} y={at.y + 8} scale={bloom} />
        })}
    </>
  )
}

interface ClumpLook {
  reach: readonly [number, number]
  spread: number
  size: readonly [number, number]
  /** Leaf angle against its stalk. High values hang, low values reach upward. */
  tilt: readonly [number, number]
  stalk: number
}

const CLUMP_LOOK: Record<string, ClumpLook> = {
  alocasia: { reach: [200, 330], spread: 36, size: [96, 134], tilt: [125, 168], stalk: 4.4 },
  anthurium: { reach: [120, 235], spread: 50, size: [74, 100], tilt: [105, 150], stalk: 3 },
  calathea: { reach: [105, 205], spread: 44, size: [84, 116], tilt: [8, 40], stalk: 2.6 },
  begonia: { reach: [48, 118], spread: 74, size: [78, 106], tilt: [62, 102], stalk: 4 },
}

/** Clumps: all stalks rise straight from the soil, and the species decides how they stand. */
function drawClump(genome: Genome, species: Species, growth: number, uid: string, maturity: number): ReactNode {
  const look = CLUMP_LOOK[species.id] ?? CLUMP_LOOK.anthurium
  const emergence = leafEmergence(growth)
  const stems: ReactNode[] = []
  const placed: PlacedLeaf[] = []

  for (let i = 0; i < MAX_LEAVES; i += 1) {
    const unfold = unfolded(emergence, i)
    if (unfold <= 0) break
    const rng = createRng(genome.seed + i * 101)
    const side = i % 2 === 0 ? 1 : -1
    const spread = (((i % 6) + 1) / 6) * look.spread * between(rng, 0.8, 1.05) * side
    const reach = between(rng, look.reach[0], look.reach[1]) * maturity * (1 - Math.abs(spread) / 190)
    const angle = radians(spread)
    const baseX = CENTER + side * ((i % 3) * 7 + 4)
    const baseY = POT_TOP - 4
    const tipX = lerp(baseX, CENTER + Math.sin(angle) * reach, unfold)
    const tipY = lerp(baseY, POT_TOP - Math.cos(angle) * reach, unfold)
    stems.push(
      <path
        key={i}
        d={`M${baseX} ${baseY} Q${lerp(baseX, baseX + (tipX - baseX) * 0.25, unfold)} ${lerp(baseY, baseY - (baseY - tipY) * 0.7, unfold)} ${tipX} ${tipY}`}
        stroke={species.id === 'begonia' ? `hsl(4 42% 42%)` : stemColor(genome)}
        strokeWidth={Math.max(2, look.stalk * maturity)}
        strokeLinecap="round"
        fill="none"
      />,
    )
    placed.push({
      key: i,
      x: tipX,
      y: tipY,
      rotation: spread * 0.6 + side * lerp(10, between(rng, look.tilt[0], look.tilt[1]), unfold),
      length: between(rng, look.size[0], look.size[1]) * maturity * genome.size * unfold,
    })
  }

  const bloom = flowerProgress(growth)
  const flowers: ReactNode[] = []
  if (bloom > 0) {
    for (let i = 0; i < 3; i += 1) {
      const rng = createRng(genome.seed + i * 3331)
      const height = species.id === 'begonia' ? between(rng, 130, 170) : species.id === 'calathea' ? between(rng, 100, 140) : between(rng, 190, 270)
      const x = lerp(CENTER, CENTER + between(rng, -80, 80), bloom)
      const y = lerp(POT_TOP - 4, POT_TOP - height, bloom)
      stems.push(<path key={`f${i}`} d={`M${CENTER} ${POT_TOP - 4} Q${CENTER} ${y + 80 * bloom} ${x} ${y}`} stroke={`hsl(${genome.hue} 30% 38%)`} strokeWidth={2.6} fill="none" />)
      flowers.push(
        species.id === 'begonia' || species.id === 'calathea' ? (
          <Cluster key={i} color={species.flower} x={x} y={y} scale={bloom} seed={genome.seed + i} />
        ) : (
          <Spathe key={i} species={species} x={x} y={y} angle={between(rng, -22, 22)} scale={bloom} />
        ),
      )
    }
  }

  return (
    <>
      {stems}
      {leafNodes(placed, genome, species, uid, 0)}
      {flowers}
    </>
  )
}

interface RosetteLook {
  length: readonly [number, number]
  width: number
  /** Degrees each older leaf leans further out, and how far it can go. */
  lean: number
  maxLean: number
  bands?: string
  /** Colors the central leaves take on as the plant matures. */
  blush?: readonly string[]
  accents: readonly string[]
}

const ROSETTE_LOOK: Record<string, RosetteLook> = {
  neoregelia: { length: [108, 138], width: 19, lean: 13, maxLean: 86, blush: ['#d3225a', '#b01f7c', '#e0502e', '#8d2a8f'], accents: ['#7b4bc4'] },
  guzmania: { length: [130, 170], width: 12, lean: 9, maxLean: 74, accents: ['#e2391f', '#f0a21f', '#d81f5c', '#f26a1b'] },
  vriesea: { length: [128, 162], width: 14, lean: 9, maxLean: 72, bands: '#1f3a2a', accents: ['#e8452c', '#f0b21f'] },
  aechmea: { length: [120, 152], width: 18, lean: 8, maxLean: 62, bands: '#dfe7e3', accents: ['#ec5f9c', '#e8467f'] },
  tillandsia: { length: [84, 118], width: 6, lean: 10, maxLean: 92, accents: ['#ef6aa6', '#e3508e'] },
}

/** A strap leaf arcing out of the rosette's centre, drawn in plant coordinates. */
function strapPath(baseX: number, baseY: number, tipX: number, tipY: number, midX: number, midY: number, width: number): string {
  const dx = tipX - baseX
  const dy = tipY - baseY
  const size = Math.hypot(dx, dy) || 1
  const nx = -dy / size
  const ny = dx / size
  const w = width
  return `M${baseX - nx * w * 0.8} ${baseY - ny * w * 0.8} Q${midX - nx * w * 1.2} ${midY - ny * w * 1.2} ${tipX} ${tipY} Q${midX + nx * w * 1.2} ${midY + ny * w * 1.2} ${baseX + nx * w * 0.8} ${baseY + ny * w * 0.8} Z`
}

function Inflorescence({ species, genome, growth, accent }: { species: Species; genome: Genome; growth: number; accent: string }) {
  const bloom = flowerProgress(growth)
  if (bloom <= 0) return null
  const base = POT_TOP - 10
  const stalk = `hsl(${genome.hue} 40% 40%)`

  if (species.id === 'guzmania') {
    const top = base - 215 * bloom
    return (
      <g>
        <line x1={CENTER} y1={base} x2={CENTER} y2={top + 50 * bloom} stroke={stalk} strokeWidth={7} strokeLinecap="round" />
        {Array.from({ length: 12 }, (_, i) => {
          const fan = (i - 5.5) * 15
          const lengthNow = (72 - Math.abs(fan) * 0.28) * bloom
          return <path key={i} d={`M-7 0 Q-8 ${-lengthNow * 0.5} 0 ${-lengthNow} Q8 ${-lengthNow * 0.5} 7 0 Z`} fill={accent} stroke="#00000022" transform={`translate(${CENTER} ${top + 62 * bloom}) rotate(${fan})`} />
        })}
        <circle cx={CENTER} cy={top + 18 * bloom} r={7 * bloom} fill="#f7efc3" />
      </g>
    )
  }

  if (species.id === 'vriesea' || species.id === 'tillandsia') {
    const isTillandsia = species.id === 'tillandsia'
    const height = (isTillandsia ? 112 : 180) * bloom
    const stem = (isTillandsia ? 46 : 96) * bloom
    const rows = isTillandsia ? 9 : 8
    const step = (height - 8) / rows
    return (
      <g>
        <line x1={CENTER} y1={base} x2={CENTER} y2={base - stem} stroke={stalk} strokeWidth={6} strokeLinecap="round" />
        {Array.from({ length: rows }, (_, i) => {
          const y = base - stem - i * step
          const side = i % 2 === 0 ? 1 : -1
          const wide = (isTillandsia ? 26 : 24) * bloom * (1 - (i / rows) * 0.62)
          return <path key={i} d={`M${CENTER} ${y + step * 0.9} Q${CENTER + side * wide} ${y + step * 0.1} ${CENTER + side * wide * 0.5} ${y - step * 0.7} Q${CENTER - side * 4} ${y} ${CENTER} ${y + step * 0.9} Z`} fill={accent} stroke="#00000026" />
        })}
        {isTillandsia &&
          [2, 4, 6].map((i) => {
            const side = i % 4 === 0 ? 1 : -1
            const y = base - stem - i * step
            return (
              <g key={i} transform={`translate(${CENTER + side * 26 * bloom} ${y}) scale(${bloom})`}>
                {[0, 120, 240].map((angle) => (
                  <ellipse key={angle} cy={-6} rx={4.4} ry={6.4} fill="#5a3dc0" transform={`rotate(${angle})`} />
                ))}
              </g>
            )
          })}
      </g>
    )
  }

  if (species.id === 'aechmea') {
    const stem = 120 * bloom
    const top = base - stem
    return (
      <g>
        <line x1={CENTER} y1={base} x2={CENTER} y2={top} stroke="#d68aa8" strokeWidth={7} strokeLinecap="round" />
        {Array.from({ length: 22 }, (_, i) => {
          const row = Math.floor(i / 4)
          const spreadNow = (32 - row * 4.6) * bloom
          const x = CENTER + ((i % 4) - 1.5) * (spreadNow / 1.5)
          const y = top - row * 15 * bloom
          return (
            <g key={i} transform={`translate(${x} ${y}) rotate(${((i % 4) - 1.5) * 24})`}>
              <path d={`M-5 0 Q0 ${-22 * bloom} 5 0 Z`} fill={accent} />
              {i % 3 === 0 && <circle cy={-18 * bloom} r={2.8 * bloom} fill="#3f57c4" />}
            </g>
          )
        })}
      </g>
    )
  }

  // Neoregelia flowers low in the water-filled centre of the rosette.
  return (
    <g>
      {Array.from({ length: 7 }, (_, i) => (
        <circle key={i} cx={CENTER + (i - 3) * 6.5} cy={base - 18 - Math.abs(i - 3) * -2} r={4.6 * bloom} fill={accent} />
      ))}
    </g>
  )
}

/** Rosettes: bromeliads grow new leaves from the centre, pushing the older ones outward. */
function drawRosette(genome: Genome, species: Species, growth: number, uid: string, maturity: number): ReactNode {
  const look = ROSETTE_LOOK[species.id] ?? ROSETTE_LOOK.guzmania
  const pick = (colors: readonly string[]) => colors[genome.seed % colors.length]
  const accent = pick(look.accents)
  const blushColor = look.blush ? pick(look.blush) : null
  const blush = look.blush ? smoothstep((growth - 60) / 240) : 0
  const emergence = leafEmergence(growth) * (species.id === 'tillandsia' ? 1.9 : 1.35)
  const count = Math.ceil(emergence)
  const green = `hsl(${genome.hue} ${genome.saturation}% ${genome.lightness + 4}%)`
  const variegated = genome.variegation === 'none' ? null : VARIEGATION_COLOR[genome.variegation]

  const drawn: { order: number; node: ReactNode }[] = []
  for (let i = 0; i < count; i += 1) {
    const unfold = unfolded(emergence, i)
    if (unfold <= 0) break
    const rng = createRng(genome.seed + i * 101)
    const age = emergence - i
    const side = i % 2 === 0 ? 1 : -1
    const lean = radians(Math.min(look.maxLean, 5 + age * look.lean) * between(rng, 0.92, 1.05))
    const length = between(rng, look.length[0], look.length[1]) * maturity * genome.size * lerp(0.35, 1, unfold)
    const baseX = CENTER + side * Math.min(20, age * 1.8)
    const baseY = POT_TOP - 6
    const tipX = baseX + side * Math.sin(lean) * length
    // Older leaves bend over and their tips sink a little.
    const tipY = baseY - Math.cos(lean) * length + Math.sin(lean) ** 2 * length * 0.2
    const midX = baseX + side * Math.sin(lean * 0.5) * length * 0.58
    const midY = baseY - Math.cos(lean * 0.5) * length * 0.62
    const width = look.width * (0.5 + 0.5 * maturity) * lerp(0.5, 1, unfold)
    const path = strapPath(baseX, baseY, tipX, tipY, midX, midY, width)
    const id = `${uid}-r${i}`
    // Younger leaves take the centre's colour first; older ones keep their green.
    const innerShare = clamp01(1 - (age - 1) / 7)
    const useBlush = blushColor && blush > 0 && innerShare > 0
    const bands =
      look.bands &&
      Array.from({ length: 11 }, (_, row) => {
        const t = (row + 1) / 12
        const cx = lerp(baseX, tipX, t)
        const cy = lerp(baseY, tipY, t) - Math.sin(t * Math.PI) * (lerp(baseY, tipY, 0.5) - midY)
        return <circle key={row} cx={cx} cy={cy} r={width * 1.3} fill="none" stroke={look.bands} strokeWidth={width * 0.26} opacity={0.5} />
      })
    drawn.push({
      // Leaves in the back are drawn first, and the front leaves overlap the centre.
      order: side * (age > 2.5 ? 1 : 0) + i * 0.01,
      node: (
        <g key={i}>
          <defs>
            <clipPath id={`${id}-clip`}>
              <path d={path} />
            </clipPath>
            {useBlush && (
              <linearGradient id={`${id}-tone`} gradientUnits="userSpaceOnUse" x1={baseX} y1={baseY} x2={tipX} y2={tipY}>
                <stop offset="0" stopColor={blushColor} stopOpacity={blush} />
                <stop offset={lerp(0.25, 0.8, innerShare)} stopColor={blushColor} stopOpacity={blush * innerShare} />
                <stop offset="1" stopColor={blushColor} stopOpacity={0.15 * blush * innerShare} />
              </linearGradient>
            )}
          </defs>
          <path d={path} fill={green} />
          {useBlush && <path d={path} fill={`url(#${id}-tone)`} />}
          <g clipPath={`url(#${id}-clip)`}>
            {bands}
            {variegated && <path d={`M${baseX} ${baseY} Q${midX} ${midY} ${tipX} ${tipY}`} stroke={variegated} strokeWidth={width * 0.8} fill="none" />}
          </g>
          <path d={`M${baseX} ${baseY} Q${midX} ${midY} ${tipX} ${tipY}`} stroke="#ffffff" strokeOpacity={0.14} strokeWidth={Math.max(0.8, width * 0.14)} fill="none" />
        </g>
      ),
    })
  }
  const ordered = [...drawn].sort((a, b) => a.order - b.order).map((entry) => entry.node)
  const back = ordered.slice(0, Math.ceil(ordered.length * 0.7))
  const front = ordered.slice(Math.ceil(ordered.length * 0.7))
  return (
    <>
      {back}
      <Inflorescence species={species} genome={genome} growth={growth} accent={accent} />
      {front}
    </>
  )
}

/** Remembers per window what was last shown, so a plant catches up visibly after a screen change. */
const lastShownGrowth = new Map<number, number>()
const SPURT_STEP = 2.5
const SPURT_MS = 1800

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The value drawn on screen follows the real growth in small spurts. Study adds growth
 * slowly, so a spurt every few minutes is what makes the plant visibly alive.
 */
function useShownGrowth(plantId: number | undefined, growth: number) {
  const [shown, setShown] = useState(() => (plantId === undefined ? growth : (lastShownGrowth.get(plantId) ?? growth)))
  const [spurting, setSpurting] = useState(false)
  const shownRef = useRef(shown)

  useEffect(() => {
    const from = shownRef.current
    const distance = growth - from
    const set = (value: number) => {
      shownRef.current = value
      setShown(value)
      if (plantId !== undefined) lastShownGrowth.set(plantId, value)
    }
    if (plantId === undefined || distance < 0 || prefersReducedMotion()) {
      set(growth)
      return
    }
    if (distance < SPURT_STEP) return

    let frame = 0
    const startedAt = performance.now()
    const step = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / SPURT_MS)
      set(from + distance * (1 - (1 - progress) ** 3))
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    setSpurting(true)
    frame = requestAnimationFrame(step)
    const stopSpurt = setTimeout(() => setSpurting(false), SPURT_MS)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(stopSpurt)
      setSpurting(false)
    }
  }, [growth, plantId])

  return { shown, spurting }
}

export function Pot({ color }: { color: string }) {
  return (
    <g>
      <path d="M144 402 L156 490 Q157 496 164 496 L236 496 Q243 496 244 490 L256 402 Z" fill={color} />
      <path d="M156 410 L166 490 L178 490 L170 410 Z" fill="#fff" opacity={0.14} />
      <rect x={138} y={392} width={124} height={20} rx={5} fill={color} />
      <rect x={138} y={392} width={124} height={6} rx={3} fill="#fff" opacity={0.16} />
      <ellipse cx={CENTER} cy={393} rx={55} ry={5} fill="#2b2118" />
    </g>
  )
}

const DRAW_FORM = { pole: drawPole, trail: drawTrail, hoop: drawHoop, clump: drawClump, rosette: drawRosette } as const

function drawFoliage(genome: Genome, species: Species, growth: number, uid: string): ReactNode {
  const maturity = 0.32 + 0.68 * Math.min(1, growth / FULL_SIZE_GROWTH)
  const shootFade = 1 - smoothstep((growth - SPROUT_GROWTH) / 10)
  return (
    <>
      {growth >= SPROUT_GROWTH && DRAW_FORM[species.form](genome, species, growth, uid, maturity)}
      {shootFade > 0 && (
        <g opacity={shootFade}>
          <path d={`M${CENTER} 392 Q${CENTER - 2} ${392 - growth * 1.4} ${CENTER + 4} ${386 - growth * 1.8}`} stroke="#6d8f3e" strokeWidth={3} fill="none" strokeLinecap="round" />
          <ellipse cx={CENTER + 4} cy={385 - growth * 1.8} rx={6} ry={3.4} fill="#7fa548" transform={`rotate(-24 ${CENTER + 4} ${385 - growth * 1.8})`} />
        </g>
      )}
    </>
  )
}

interface PlantViewProps {
  genome: Genome
  growth: number
  pot?: number
  className?: string
  title?: string
  /** Set this to animate growth; without it the plant is drawn as is. */
  plantId?: number
}

export function PlantView({ genome, growth, pot = 0, className, title, plantId }: PlantViewProps) {
  const uid = useMemo(() => `p${Math.random().toString(36).slice(2, 9)}`, [])
  const species = speciesById(genome.species)
  const { shown, spurting } = useShownGrowth(plantId, growth)
  // The session broadcasts every second; the drawing is only rebuilt when the shown growth moves.
  const foliage = useMemo(() => drawFoliage(genome, species, shown, uid), [genome, species, shown, uid])

  return (
    <svg className={className} viewBox="0 0 400 500" role="img" aria-label={title ?? species.name}>
      <g className={`foliage${spurting ? ' spurt' : ''}`}>{foliage}</g>
      <Pot color={POT_COLORS[pot % POT_COLORS.length]} />
    </svg>
  )
}
