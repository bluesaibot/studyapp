import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  fenestrationProgress,
  flowerProgress,
  leafProgress,
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

function leafOutline(shape: LeafShape, length: number, width: number): string {
  const half = (side: number, reverse: boolean): string => {
    const w = width * side
    const curves: Record<LeafShape, [number, number, number, number, number, number][]> = {
      heart: [
        [-w * 0.2, length * 0.14, -w * 0.62, length * 0.14, -w * 0.58, -length * 0.2],
        [-w * 0.54, -length * 0.58, -w * 0.16, -length * 0.86, 0, -length],
      ],
      arrow: [
        [-w * 0.14, length * 0.24, -w * 0.5, length * 0.34, -w * 0.46, -length * 0.04],
        [-w * 0.4, -length * 0.44, -w * 0.1, -length * 0.8, 0, -length],
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
    }
    const [a, b] = curves[shape]
    if (!reverse) {
      return `C${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[4]} ${a[5]} C${b[0]} ${b[1]} ${b[2]} ${b[3]} ${b[4]} ${b[5]}`
    }
    return `C${b[2]} ${b[3]} ${b[0]} ${b[1]} ${a[4]} ${a[5]} C${a[2]} ${a[3]} ${a[0]} ${a[1]} 0 0`
  }
  return `M0 0 ${half(1, false)} ${half(-1, true)} Z`
}

function variegationMarks(genome: Genome, rng: Rng, length: number, width: number): ReactNode {
  const { variegation, variegationAmount: amount } = genome
  if (variegation === 'none') return null
  const color = { marbled: '#eef0d6', sectoral: '#f2f1dc', aurea: '#e7cf58', albo: '#f8f8ef', mint: '#b8e4c8' }[variegation]

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

interface LeafProps {
  id: string
  genome: Genome
  species: Species
  seed: number
  length: number
  width: number
  /** 0 to 1, how far the slits have opened. */
  holes: number
}

function Leaf({ id, genome, species, seed, length, width, holes }: LeafProps) {
  const rng = createRng(seed)
  const outline = leafOutline(species.shape, length, width)
  const tone = between(rng, -3, 3)
  const fill = `hsl(${genome.hue + tone} ${genome.saturation}% ${genome.lightness + tone}%)`
  const vein = `hsl(${genome.hue + 8} ${genome.saturation}% ${genome.lightness + 22}%)`
  const slits = holes > 0 ? Math.round(genome.fenestration * 5) : 0
  const stripes = species.id === 'calathea'

  return (
    <g>
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={outline} />
        </clipPath>
        {slits > 0 && (
          <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={-width} y={-length * 1.1} width={width * 2} height={length * 1.5}>
            <path d={outline} fill="#fff" />
            {Array.from({ length: slits * 2 }, (_, i) => {
              const side = i % 2 === 0 ? 1 : -1
              const row = Math.floor(i / 2)
              const y = -length * (0.14 + (row / slits) * 0.62)
              const inner = width * between(rng, 0.14, 0.24)
              return (
                <line
                  key={i}
                  x1={side * inner}
                  y1={y}
                  x2={side * width}
                  y2={y - length * 0.2}
                  stroke="#000"
                  strokeWidth={length * 0.042 * holes}
                  strokeLinecap="round"
                />
              )
            })}
          </mask>
        )}
      </defs>
      <g mask={slits > 0 ? `url(#${id}-mask)` : undefined}>
        <path d={outline} fill={fill} />
        <g clipPath={`url(#${id}-clip)`}>
          {variegationMarks(genome, rng, length, width)}
          {stripes &&
            Array.from({ length: 8 }, (_, i) => {
              const y = -length * (0.1 + i * 0.1)
              return (
                <path
                  key={i}
                  d={`M${-width} ${y - length * 0.08} L0 ${y} L${width} ${y - length * 0.08}`}
                  stroke={`hsl(${genome.hue} ${genome.saturation}% ${genome.lightness + 28}%)`}
                  strokeWidth={length * 0.025}
                  fill="none"
                />
              )
            })}
          <rect x={-width} y={-length * 1.1} width={width} height={length * 1.6} fill="#06201a" opacity={0.13} />
        </g>
        <line x1={0} y1={0} x2={0} y2={-length * 0.96} stroke={vein} strokeWidth={Math.max(1, length * 0.018)} strokeLinecap="round" />
      </g>
    </g>
  )
}

function Flower({ species, x, y, angle, scale }: { species: Species; x: number; y: number; angle: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <path d="M0 0 C-22 -10 -24 -44 0 -66 C24 -44 22 -10 0 0 Z" fill={species.flower} />
      <rect x={-4} y={-46} width={8} height={38} rx={4} fill="#d9a92f" />
    </g>
  )
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

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount

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
  const foliage = useMemo(() => drawFoliage(genome, species, shown, uid), [genome.seed, genome.species, shown, uid])

  return (
    <svg className={className} viewBox="0 0 400 500" role="img" aria-label={title ?? species.name}>
      <g className={`foliage${spurting ? ' spurt' : ''}`}>{foliage}</g>
      <Pot color={POT_COLORS[pot % POT_COLORS.length]} />
    </svg>
  )
}

function drawFoliage(genome: Genome, species: Species, growth: number, uid: string): ReactNode {
  const maturity = 0.32 + 0.68 * Math.min(1, growth / FULL_SIZE_GROWTH)
  const trailing = species.habit === 'trailing'
  const holes = fenestrationProgress(growth)
  const bloom = flowerProgress(growth)
  const shootFade = 1 - smoothstep((growth - SPROUT_GROWTH) / 10)

  const stems: ReactNode[] = []
  const leaves: ReactNode[] = []
  const flowers: ReactNode[] = []

  for (let i = 0; i < MAX_LEAVES; i += 1) {
    const unfold = leafProgress(growth, i)
    if (unfold <= 0) break
    const rng = createRng(genome.seed + i * 101)
    const side = i % 2 === 0 ? 1 : -1
    let tipX: number
    let tipY: number
    let controlX: number
    let controlY: number
    let rotation: number

    if (trailing) {
      const reach = between(rng, 40, 95) * maturity
      tipX = CENTER + side * (reach + 30)
      tipY = POT_TOP + between(rng, -60, 70) * maturity
      controlX = CENTER + side * reach * 0.55
      controlY = POT_TOP - between(rng, 50, 90) * maturity
      rotation = side * between(rng, 100, 165)
    } else {
      const spread = (((i % 6) + 1) / 6) * between(rng, 44, 64) * side
      const reach = between(rng, 150, 300) * maturity * (1 - Math.abs(spread) / 170)
      const radians = (spread * Math.PI) / 180
      tipX = CENTER + Math.sin(radians) * reach
      tipY = POT_TOP - Math.cos(radians) * reach
      controlX = CENTER + (tipX - CENTER) * 0.25
      controlY = POT_TOP - reach * 0.7
      rotation = spread * 1.2 + side * between(rng, 58, 104)
    }

    // A young leaf rises out of the plant's centre, narrow and upright, then opens outward.
    const baseX = CENTER + side * 6
    const baseY = POT_TOP - 4
    const shownTipX = lerp(baseX, tipX, unfold)
    const shownTipY = lerp(baseY, tipY, unfold)
    const shownRotation = rotation * (0.35 + 0.65 * unfold)
    const size = between(rng, 74, 104) * maturity * genome.size * unfold
    const proportion = { heart: 0.92, arrow: 0.8, oval: 0.62, lance: 0.5, round: 1 }[species.shape] * (0.4 + 0.6 * unfold)
    stems.push(
      <path
        key={i}
        d={`M${baseX} ${baseY} Q${lerp(baseX, controlX, unfold)} ${lerp(baseY, controlY, unfold)} ${shownTipX} ${shownTipY}`}
        stroke={`hsl(${genome.hue} ${genome.saturation}% ${genome.lightness + 8}%)`}
        strokeWidth={Math.max(2, 4 * maturity)}
        strokeLinecap="round"
        fill="none"
      />,
    )
    if (size >= 1) {
      leaves.push(
        <g key={i} transform={`translate(${shownTipX} ${shownTipY}) rotate(${shownRotation})`}>
          <Leaf
            id={`${uid}-${i}`}
            genome={genome}
            species={species}
            seed={genome.seed + i * 977}
            length={size}
            width={size * proportion}
            holes={holes}
          />
        </g>,
      )
    }
  }

  if (bloom > 0) {
    for (let i = 0; i < 3; i += 1) {
      const rng = createRng(genome.seed + i * 3331)
      const x = lerp(CENTER, CENTER + between(rng, -80, 80), bloom)
      const y = lerp(POT_TOP - 4, POT_TOP - (trailing ? between(rng, 90, 150) : between(rng, 200, 290)), bloom)
      stems.push(
        <path key={`f${i}`} d={`M${CENTER} ${POT_TOP - 4} Q${CENTER} ${y + 80 * bloom} ${x} ${y}`} stroke={`hsl(${genome.hue} 30% 38%)`} strokeWidth={3} fill="none" />,
      )
      flowers.push(<Flower key={i} species={species} x={x} y={y} angle={between(rng, -22, 22)} scale={bloom} />)
    }
  }

  return (
    <>
      {stems}
      {leaves}
      {flowers}
      {shootFade > 0 && (
        <g opacity={shootFade}>
          <path d={`M${CENTER} 392 Q${CENTER - 2} ${392 - growth * 1.4} ${CENTER + 4} ${386 - growth * 1.8}`} stroke="#6d8f3e" strokeWidth={3} fill="none" strokeLinecap="round" />
          <ellipse cx={CENTER + 4} cy={385 - growth * 1.8} rx={6} ry={3.4} fill="#7fa548" transform={`rotate(-24 ${CENTER + 4} ${385 - growth * 1.8})`} />
        </g>
      )}
    </>
  )
}
