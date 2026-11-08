import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { crossChance, pollinationCost, pollinationProblem, sexOf } from '../../core/genetics'
import { cutProblem, emergenceLeaves, leafType } from '../../core/leaves'
import { bedsTouch, FLOWERING_GROWTH, plantRarity, RARITY_LABELS, speciesById, sproutCost, SPROUT_GROWTH, stageProgress, varietyName, type Variegation } from '../../core/plants'
import { potDesign } from '../../core/pots'
import { bedCost, fundGrowthAmount, fundSunAmount, REWARDS, type Fund } from '../../core/rewards'
import { BED_LITRES } from '../../core/soil'
import type { BedRow, FundRow, MixRow, NurseryRow, PlantRow, PollinationRow, Snapshot } from '../../shared/api'
import { PlantStage, PlantView, Pot } from './PlantView'
import { Shop, SoilBars, SoilBench } from './Shop'
import { sun } from './useSnapshot'

export function fundTitle(fund: Fund): string {
  const kind = { seed: 'Seed', fertilizer: 'Fertilizer', sun: 'Sunbeam', pot: 'New pot' }[fund.kind]
  return `${kind} (${fund.rarity})`
}

export function fundEffect(fund: Fund): string {
  if (fund.kind === 'seed') return 'Goes into your seed box. Rarer seeds reach rarer varieties, and often grow bromeliads or orchids.'
  if (fund.kind === 'fertilizer') return `Grows a plant by ${fundGrowthAmount(fund.rarity)}.`
  if (fund.kind === 'sun') return `Adds ${fundSunAmount(fund.rarity)} ☀ for the garden.`
  return `A new pot for a plant, ${potDesign(fund.seed).name.toLowerCase()}. It stays in your collection.`
}

function plantName(plant: PlantRow): string {
  return plant.name ?? varietyName(plant.genome)
}

function originLine(plant: PlantRow, plants: PlantRow[]): string | null {
  if (!plant.origin) return null
  const name = (id: number | null) => {
    const parent = plants.find((row) => row.id === id)
    return parent ? plantName(parent) : 'a plant'
  }
  if (plant.origin.kind === 'cutting') return `Cutting of ${name(plant.origin.parentA)}.`
  return plant.origin.parentA === plant.origin.parentB
    ? `Grown from ${name(plant.origin.parentA)} with bought pollen.`
    : `Child of ${name(plant.origin.parentA)} and ${name(plant.origin.parentB)}.`
}

const isCutting = (plant: PlantRow) => plant.origin?.kind === 'cutting'
const bedOf = (plant: PlantRow, beds: readonly BedRow[]) => beds.find((bed) => bed.id === plant.bedId)

function PollinateChoices({ plant, plants, beds, pollen }: { plant: PlantRow; plants: PlantRow[]; beds: readonly BedRow[]; pollen: number }) {
  if (plant.location !== 'garden') return <p className="hint">Plants only pollinate in the garden, in neighbouring beds.</p>
  if (plant.growth < FLOWERING_GROWTH) return <p className="hint">Once it flowers, it can pollinate a plant in the bed next to it.</p>
  if (plant.restLeft > 0) return <p className="hint">Resting. It blooms again after {Math.ceil(plant.restLeft)} ☀ of study.</p>
  const own = bedOf(plant, beds)
  const neighbours = plants.filter((row) => {
    const other = bedOf(row, beds)
    return row.id !== plant.id && own && other && bedsTouch(own, other)
  })
  const partners = neighbours.filter((row) => !pollinationProblem(plant, row))
  const crossing = (row: PlantRow) => ((plant.soil?.stats.crossing ?? 0) + (row.soil?.stats.crossing ?? 0)) / 2
  return (
    <>
      {partners.map((partner) => (
        <button key={partner.id} className="button" onClick={() => void window.api.startPollination(plant.id, partner.id)}>
          Pollinate with {plantName(partner)} ({pollinationCost(plant.genome, partner.genome)} ☀)
        </button>
      ))}
      {partners.map((partner) => (
        <p key={partner.id} className="hint">
          With {plantName(partner)}, a seed has a {Math.round(crossChance(plant.genome, partner.genome, crossing(partner)) * 100)}% chance to take. Otherwise it is only a plain plant of one parent. Sphagnum in the soil helps.
        </p>
      ))}
      {neighbours.length === 0 && <p className="hint">Drag a flowering plant of the same group into the bed next to this one.</p>}
      {neighbours.filter((row) => pollinationProblem(plant, row)).map((row) => (
        <p key={row.id} className="hint">
          {plantName(row)}: {pollinationProblem(plant, row)}
        </p>
      ))}
      <button className="button quiet" disabled={pollen < 1} onClick={() => void window.api.startWithPollen(plant.id)}>
        Use bought pollen ({pollen} left)
      </button>
    </>
  )
}

const LEAF_NAMES: Record<Variegation, string> = { none: 'Plain leaf', marbled: 'Marbled leaf', sectoral: 'Sectoral leaf', mint: 'Mint leaf', aurea: 'Aurea leaf', albo: 'Albo leaf' }

/** Each kind of leaf that can be cut right now, as well as clicking on the plant itself. */
function CuttableLeaves({ plant }: { plant: PlantRow }) {
  const count = emergenceLeaves(plant.genome, plant.growth)
  const kinds = new Map<Variegation, number>()
  for (let index = count - 1; index >= 0; index -= 1) {
    if (!cutProblem(plant.genome, plant.leaves, plant.growth, index)) kinds.set(leafType(plant.genome, plant.leaves, index), index)
  }
  return (
    <div className="row">
      {[...kinds].map(([kind, index]) => (
        <button key={kind} className="button quiet" onClick={() => void window.api.takeCutting(plant.id, index)}>
          {LEAF_NAMES[kind]}
        </button>
      ))}
    </div>
  )
}

/** The big view of a greenhouse plant, with room to pick the leaf you want. */
function PlantStudio({ plant, shears, close }: { plant: PlantRow; shears: number; close: () => void }) {
  const [cutting, setCutting] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const wear = 1 - (plant.soil?.stats.cuttings ?? 0)
  const tooYoung = plant.growth < REWARDS.cuttingMinGrowth
  const queue = plant.leaves.queue.length

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="studio" role="dialog" aria-modal="true" aria-label={plantName(plant)}>
      <div className="studio-stage">
        <PlantView
          className="studio-plant"
          plantId={plant.id}
          genome={plant.genome}
          growth={plant.growth}
          pot={plant.pot}
          leaves={plant.leaves}
          closed={plant.flowersClosed}
          pods={plant.pods}
          title={plantName(plant)}
          onLeaf={cutting ? (index) => void window.api.takeCutting(plant.id, index) : undefined}
        />
      </div>
      <div className="studio-side">
        <div className="week-item-head">
          <h2>{plantName(plant)}</h2>
          <button ref={closeButton} className="button quiet" onClick={close}>
            Close
          </button>
        </div>
        <p>
          {varietyName(plant.genome)}, {stageProgress(plant.growth).stage.toLowerCase()}
        </p>
        <button className={`button${cutting ? ' sunny' : ''}`} disabled={tooYoung || shears < wear} aria-pressed={cutting} onClick={() => setCutting(!cutting)}>
          {cutting ? 'Put the shears away' : 'Pick up the shears'}
        </button>
        <p className="hint">
          {tooYoung ? `Leaves can be cut from growth ${REWARDS.cuttingMinGrowth}. Grow it on in a garden bed.` : shears < wear ? 'You need shears from the shop.' : `Your shears have ${Number(shears.toFixed(1))} cuts left. One leaf wears them by ${Number(wear.toFixed(2))}.`}
        </p>
        {cutting && !tooYoung && (
          <>
            <p className="hint">Click a leaf to cut it. A cutting from a variegated leaf makes more of the new plant's leaves mutate, in more colours. It goes to your seed box.</p>
            <CuttableLeaves plant={plant} />
          </>
        )}
        {queue > 0 && <p className="hint">{queue === 1 ? 'A cut leaf regrows' : `${queue} cut leaves regrow`} as you study, not always as before. It is twice as fast in a garden bed.</p>}
      </div>
    </div>
  )
}

function PotChoice({ plant, owned }: { plant: PlantRow; owned: readonly number[] }) {
  if (owned.length < 2) return null
  return (
    <div className="pot-choice" role="group" aria-label="Choose a pot">
      {owned.map((pot) => (
        <button key={pot} className={`pot-chip${plant.pot === pot ? ' selected' : ''}`} aria-label={potDesign(pot).name} title={potDesign(pot).name} aria-pressed={plant.pot === pot} onClick={() => void window.api.setPot(plant.id, pot)}>
          <svg viewBox="130 380 140 120" aria-hidden="true">
            <Pot design={potDesign(pot)} />
          </svg>
        </button>
      ))}
    </div>
  )
}

function PlantDetail({ plant, snapshot, openStudio }: { plant: PlantRow; snapshot: Snapshot; openStudio: () => void }) {
  const { plants, wallet, beds, pollen, pollinations, ownedPots } = snapshot
  const finished = plant.growth >= FLOWERING_GROWTH
  const origin = originLine(plant, plants)
  const inGarden = plant.location === 'garden'
  const taken = new Set(plants.map((row) => row.bedId))
  const freeBeds = beds.filter((bed) => !taken.has(bed.id)).length
  const busy = pollinations.some((row) => row.plantA === plant.id || row.plantB === plant.id)
  return (
    <div className="plant-detail">
      <input
        className="plant-name"
        aria-label="Plant name"
        defaultValue={plantName(plant)}
        onBlur={(event) => void window.api.renamePlant(plant.id, event.target.value)}
      />
      <p>
        {varietyName(plant.genome)}
        {plant.growth >= REWARDS.sexShownGrowth && `, ${sexOf(plant.genome)}`}, {RARITY_LABELS[plantRarity(plant.genome)].toLowerCase()}
        {plant.genome.variegation !== 'none' && `, variegated (${plant.genome.variegation})`}
      </p>
      {origin && <p className="hint">{origin}</p>}
      <PlantStage growth={plant.growth} sproutSun={sproutCost(plant.genome, isCutting(plant))} />
      <div className="row">
        <button className="button" disabled={finished || !inGarden || wallet < REWARDS.waterCost} onClick={() => void window.api.water(plant.id)}>
          Water ({REWARDS.waterCost} ☀)
        </button>
        <button className="button quiet" disabled={finished || !inGarden || wallet < 50} onClick={() => void window.api.water(plant.id, 50)}>
          Feed 50 ☀
        </button>
        <button className="button quiet" disabled={finished || !inGarden || wallet < 1} onClick={() => void window.api.water(plant.id, wallet)}>
          Feed all
        </button>
        {inGarden ? (
          <button className="button quiet" disabled={plant.growth < REWARDS.showGrowth || busy} onClick={() => void window.api.moveToGreenhouse(plant.id)}>
            Move to greenhouse
          </button>
        ) : (
          <button className="button quiet" disabled={freeBeds <= 0} onClick={() => void window.api.moveToGarden(plant.id, null)}>
            Back to the garden
          </button>
        )}
      </div>
      {inGarden && finished && <p className="hint">Its flowers close in the greenhouse. Back in a bed it blooms again after some study.</p>}
      {!inGarden && finished && plant.restLeft > 0 && <p className="hint">Back in a bed, it blooms again after {Math.ceil(plant.restLeft)} ☀ of study.</p>}
      {inGarden && plant.growth < REWARDS.showGrowth && <p className="hint">It can go on show once it is a young plant, from growth {REWARDS.showGrowth}.</p>}
      {inGarden && plant.growth < SPROUT_GROWTH && (
        <>
          <p className="hint">Until it sprouts you can dig it up to free the bed. It starts over when sown again.</p>
          <button className="button quiet" onClick={() => void window.api.digUp(plant.id)}>
            Back to the seed box
          </button>
        </>
      )}
      {!inGarden && !finished && freeBeds <= 0 && <p className="hint">Plants only grow in a garden bed, and yours are all in use.</p>}
      <div className="breeding">
        {!inGarden && (
          <button className="button quiet" onClick={openStudio}>
            Open up close, to cut leaves
          </button>
        )}
        <PollinateChoices plant={plant} plants={plants} beds={beds} pollen={pollen} />
      </div>
      <PotChoice plant={plant} owned={ownedPots} />
    </div>
  )
}

function BedSoil({ bed, mixes, plantName: name }: { bed: BedRow; mixes: readonly MixRow[]; plantName: string | null }) {
  const usable = mixes.filter((mix) => mix.litres >= BED_LITRES)
  return (
    <div className="bed-panel">
      <h3>{name ? `Soil under ${name}` : 'Soil in this bed'}</h3>
      {bed.soil ? (
        <>
          <p>{bed.soil.name}</p>
          <SoilBars stats={bed.soil.stats} />
        </>
      ) : (
        <p className="hint">Plain garden soil, with no effects. It goes along when a plant moves to the greenhouse, and the bed is plain again.</p>
      )}
      {usable.map((mix) => (
        <button key={mix.id} className="button quiet" onClick={() => void window.api.fillBed(bed.id, mix.id)}>
          Fill with {mix.name} ({BED_LITRES} of {mix.litres} L)
        </button>
      ))}
      {usable.length === 0 && <p className="hint">A bed takes {BED_LITRES} L. Mix some on the soil bench.</p>}
    </div>
  )
}

function FundItem({ fund, selected }: { fund: FundRow; selected: PlantRow | null }) {
  const needsPlant = fund.kind === 'fertilizer' || fund.kind === 'pot'
  const action = { seed: 'To seed box', fertilizer: 'Fertilize', sun: 'Collect', pot: 'Repot' }[fund.kind]
  return (
    <li className="fund-item">
      <div>
        <strong>{fundTitle(fund)}</strong>
        <p>{fundEffect(fund)}</p>
      </div>
      <button className="button quiet" disabled={needsPlant && !selected} onClick={() => void window.api.useFund(fund.id, selected?.id ?? null)}>
        {action}
      </button>
    </li>
  )
}

function SeedBox({ items, plants, bedId, canSow }: { items: readonly NurseryRow[]; plants: readonly PlantRow[]; bedId: number | null; canSow: boolean }) {
  if (items.length === 0) return null
  const parentName = (id: number | null) => {
    const parent = plants.find((plant) => plant.id === id)
    return parent ? plantName(parent) : 'a plant'
  }
  return (
    <section className="seed-box" aria-label="Seed box">
      <h3>Seed box</h3>
      {items.map((item) => (
        <div key={item.id} className="seed-row">
          <span>
            {item.kind === 'cutting' ? 'Cutting' : 'Seed'}
            {item.parentA !== null
              ? ` from ${parentName(item.parentA)}${item.parentB !== null && item.parentB !== item.parentA ? ` and ${parentName(item.parentB)}` : ''}`
              : ', a surprise'}
            , sprouts after {Math.round(sproutCost(item.genome, item.kind === 'cutting'))} ☀
          </span>
          <button className="button quiet" disabled={!canSow} onClick={() => void window.api.sow(item.id, bedId)}>
            {item.kind === 'cutting' ? 'Root' : 'Sow'}
          </button>
        </div>
      ))}
      {!canSow && <p className="hint">All beds are in use. Move a young plant to the greenhouse, or add a bed.</p>}
    </section>
  )
}

function GardenPlot({ snapshot, select, selectedBed, selectBed }: { snapshot: Snapshot; select: (id: number) => void; selectedBed: BedRow | null; selectBed: (id: number) => void }) {
  const { plants, beds, nursery, wallet, pollinations } = snapshot
  const canBuy = beds.length < REWARDS.maxBeds
  const cost = bedCost(beds.length)
  const [target, setTarget] = useState<number | null>(null)
  const empties = beds.filter((bed) => !plants.some((plant) => plant.bedId === bed.id))
  const sowInto = selectedBed && empties.some((bed) => bed.id === selectedBed.id) ? selectedBed.id : null

  const drop = (event: DragEvent, bedId: number) => {
    event.preventDefault()
    setTarget(null)
    const [kind, id] = event.dataTransfer.getData('text/plain').split(':')
    if (kind === 'bed') void window.api.swapBeds(Number(id), bedId)
  }

  // One row and column more on each side, to expand in all four directions.
  const xs = beds.map((bed) => bed.x)
  const ys = beds.map((bed) => bed.y)
  const left = Math.min(...xs) - 1
  const top = Math.min(...ys) - 1
  const columns = Math.max(...xs) + 1 - left + 1
  const rows = Math.max(...ys) + 1 - top + 1
  const cells = Array.from({ length: rows * columns }, (_, i) => ({ x: left + (i % columns), y: top + Math.floor(i / columns) }))

  return (
    <>
      <div className="beds" style={{ gridTemplateColumns: `repeat(${columns}, 188px)` }}>
        {cells.map((cell) => {
          const bed = beds.find((row) => row.x === cell.x && row.y === cell.y)
          if (!bed) {
            if (!canBuy || !beds.some((row) => bedsTouch(row, cell))) return <div key={`${cell.x},${cell.y}`} className="bed-gap" />
            return (
              <div key={`${cell.x},${cell.y}`} className="bed locked">
                <div className="bed-plant">
                  <button className="button quiet" disabled={wallet < cost} onClick={() => void window.api.buyBed(cell.x, cell.y)}>
                    Add a bed ({cost} ☀)
                  </button>
                </div>
                <div className="bed-soil" />
              </div>
            )
          }
          const plant = plants.find((row) => row.bedId === bed.id)
          const label = plant ? plantName(plant) : 'Empty bed'
          return (
            <div
              key={bed.id}
              className={`bed${plant ? '' : ' empty-bed'}${selectedBed?.id === bed.id ? ' selected' : ''}${target === bed.id ? ' drop-target' : ''}`}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', `bed:${bed.id}`)}
              onDragOver={(event) => {
                event.preventDefault()
                setTarget(bed.id)
              }}
              onDragLeave={() => setTarget(null)}
              onDrop={(event) => drop(event, bed.id)}
            >
              <button
                className="bed-plant"
                aria-label={`Select ${label}`}
                onClick={() => {
                  selectBed(bed.id)
                  if (plant) select(plant.id)
                }}
              >
                {plant ? <PlantView plantId={plant.id} genome={plant.genome} growth={plant.growth} leaves={plant.leaves} closed={plant.flowersClosed} pods={plant.pods} title={plantName(plant)} inBed /> : nursery.length > 0 ? 'Sow from your seed box' : 'Empty bed'}
              </button>
              <div className="bed-soil" style={bed.soil ? { background: bed.soil.color } : undefined} />
              <div className="bed-label">
                {plant ? (
                  <>
                    <strong>{plantName(plant)}</strong>, {stageProgress(plant.growth).stage}
                  </>
                ) : (
                  <strong>Empty</strong>
                )}
                <span className="bed-soil-name">{bed.soil?.name ?? 'Plain soil'}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="hint garden-note">Drag beds to swap them. Flowering plants in beds that touch can pollinate, up, down, left or right. Their pods turn brown as they ripen, a little more sun pops them, and the seeds land in free beds around the parents, or in your seed box.</p>
      {pollinations.length > 0 && (
        <section className="pollinations" aria-label="Pollinations">
          <h3>Pollinating</h3>
          {pollinations.map((row) => (
            <PollinationBar key={row.id} row={row} plants={plants} wallet={wallet} />
          ))}
        </section>
      )}
      <SeedBox items={nursery} plants={plants} bedId={sowInto} canSow={empties.length > 0} />
    </>
  )
}

function PollinationBar({ row, plants, wallet }: { row: PollinationRow; plants: readonly PlantRow[]; wallet: number }) {
  const a = plants.find((plant) => plant.id === row.plantA)
  const b = plants.find((plant) => plant.id === row.plantB)
  const label = a ? (b ? `${plantName(a)} and ${plantName(b)}` : `${plantName(a)} with bought pollen`) : 'Pollination'
  const ripe = row.paid >= row.needed
  const paid = ripe ? row.paid - row.needed : row.paid
  const goal = ripe ? row.popNeeded : row.needed
  const left = row.needed + row.popNeeded - row.paid
  const share = Math.min(100, (paid / goal) * 100)
  return (
    <div className="pollination">
      <div className="week-item-head">
        <strong>{label}</strong>
        <span>
          {Math.floor(paid)} of {goal} ☀
        </span>
      </div>
      <p className="hint">{ripe ? 'The pods are brown and ripe. A little more sun pops them.' : 'The seed pods turn brown as they ripen.'}</p>
      <div className="progress" role="progressbar" aria-label={`${ripe ? 'Popping' : 'Ripening'} ${label}`} aria-valuenow={Math.round(share)}>
        <span style={{ width: `${share}%` }} />
      </div>
      <label className="fill-toggle">
        <input type="checkbox" checked={row.studyFill} onChange={(event) => void window.api.setPollinationFill(row.id, event.target.checked)} />
        Studying fills this bar
      </label>
      <div className="row">
        {[10, 50].map((amount) => (
          <button key={amount} className="button quiet" disabled={wallet < 1} onClick={() => void window.api.feedPollination(row.id, amount)}>
            +{amount} ☀
          </button>
        ))}
        <button className="button quiet" disabled={wallet < 1} onClick={() => void window.api.feedPollination(row.id, left)}>
          Give all I can
        </button>
      </div>
    </div>
  )
}

function Greenhouse({ snapshot, selected, select, openStudio }: { snapshot: Snapshot; selected: PlantRow | null; select: (id: number) => void; openStudio: () => void }) {
  const onShow = snapshot.plants.filter((plant) => plant.location === 'greenhouse').sort((a, b) => (a.shelf ?? 0) - (b.shelf ?? 0))
  const [target, setTarget] = useState<number | null>(null)
  // Plants already here when it opens stay put; only a newly arrived one settles in.
  const known = useRef(new Set(onShow.map((plant) => plant.id)))
  useEffect(() => {
    for (const plant of onShow) known.current.add(plant.id)
  }, [onShow])

  const drop = (event: DragEvent, other: PlantRow) => {
    event.preventDefault()
    setTarget(null)
    const dragged = Number(event.dataTransfer.getData('text/plain'))
    if (dragged && dragged !== other.id) void window.api.swapShelf(dragged, other.id)
  }

  return (
    <div className="glass-content">
      {onShow.length === 0 ? (
        <p className="empty">Nothing on show yet. Young plants can move here from the garden.</p>
      ) : (
        <>
          <div className="glass-shelf">
            {onShow.map((plant) => (
              <button
                key={plant.id}
                className={`shelf-plant on-show${selected?.id === plant.id ? ' selected' : ''}${known.current.has(plant.id) ? '' : ' planted'}${target === plant.id ? ' drop-target' : ''}`}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/plain', String(plant.id))}
                onDragOver={(event) => {
                  event.preventDefault()
                  setTarget(plant.id)
                }}
                onDragLeave={() => setTarget(null)}
                onDrop={(event) => drop(event, plant)}
                aria-label={`Open ${plantName(plant)} up close`}
                onClick={() => {
                  select(plant.id)
                  openStudio()
                }}
              >
                <PlantView plantId={plant.id} genome={plant.genome} growth={plant.growth} pot={plant.pot} leaves={plant.leaves} closed={plant.flowersClosed} pods={plant.pods} title={plantName(plant)} />
                <span>
                  {plantName(plant)}, {stageProgress(plant.growth).stage}
                </span>
              </button>
            ))}
          </div>
          <p className="hint garden-note">Click a plant to see it up close and cut leaves. Drag it onto another to swap their places.</p>
        </>
      )}
    </div>
  )
}

type Place = 'plot' | 'glass' | 'shop' | 'soil'

export function Garden({ snapshot }: { snapshot: Snapshot }) {
  const { plants, funds, wallet, streak, beds, mixes } = snapshot
  const [place, setPlace] = useState<Place>('plot')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [bedId, setBedId] = useState<number | null>(null)
  const [studio, setStudio] = useState(false)
  const closeStudio = useCallback(() => setStudio(false), [])
  const openStudio = useCallback(() => setStudio(true), [])
  const choose = (id: number) => {
    setSelectedId(id)
    void window.api.setShownPlant(id)
  }
  const here = plants.filter((plant) => plant.location === (place === 'glass' ? 'greenhouse' : 'garden'))
  const selected = here.find((plant) => plant.id === selectedId) ?? here.find((plant) => plant.isCurrent) ?? here[0] ?? null
  const selectedBed = beds.find((bed) => bed.id === bedId) ?? beds.find((bed) => bed.id === selected?.bedId) ?? beds[0] ?? null
  const bedPlant = plants.find((plant) => plant.bedId === selectedBed?.id) ?? null
  const shownPlant = place === 'plot' ? bedPlant : selected
  const places: [Place, string][] = [['plot', 'Garden'], ['glass', 'Greenhouse'], ['shop', 'Shop'], ['soil', 'Soil bench']]

  return (
    <>
      <nav className="place-tabs" aria-label="Places">
        {places.map(([id, label]) => (
          <button key={id} className="tab" aria-current={place === id} onClick={() => setPlace(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className={`world ${place}`}>
        <div className="world-main">
          {place === 'plot' && <GardenPlot snapshot={snapshot} select={choose} selectedBed={selectedBed} selectBed={setBedId} />}
          {place === 'glass' && <Greenhouse snapshot={snapshot} selected={selected} select={choose} openStudio={openStudio} />}
          {place === 'shop' && <Shop snapshot={snapshot} />}
          {place === 'soil' && <SoilBench snapshot={snapshot} />}
        </div>
        <aside className="world-side">
          <p className="wallet">{sun(wallet)} to spend</p>
          {/* A new panel per plant, so its name field never carries over. */}
          {(place === 'plot' || place === 'glass') && shownPlant && <PlantDetail key={shownPlant.id} plant={shownPlant} snapshot={snapshot} openStudio={openStudio} />}
          {place === 'plot' && selectedBed && <BedSoil bed={selectedBed} mixes={mixes} plantName={bedPlant ? plantName(bedPlant) : null} />}
          {funds.length > 0 && (
            <>
              <h3>Finds</h3>
              <ul className="fund-list">
                {funds.map((fund) => (
                  <FundItem key={fund.id} fund={fund} selected={shownPlant} />
                ))}
              </ul>
            </>
          )}
          {streak.rings.length > 0 && (
            <>
              <h3>Growth rings</h3>
              <ul className="rings">
                {streak.rings.map((ring) => (
                  <li key={ring.start}>
                    {ring.days} study days from {ring.start.split('-').reverse().join('.')}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      {studio && place === 'glass' && selected && <PlantStudio key={selected.id} plant={selected} shears={snapshot.shears} close={closeStudio} />}
    </>
  )
}
