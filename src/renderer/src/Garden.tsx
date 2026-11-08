import { useEffect, useRef, useState, type DragEvent } from 'react'
import { pollinationCost, pollinationProblem, sexOf } from '../../core/genetics'
import { FLOWERING_GROWTH, speciesById, SPROUT_GROWTH, stageProgress } from '../../core/plants'
import { fundGrowthAmount, fundSunAmount, REWARDS, type Fund } from '../../core/rewards'
import type { FundRow, NurseryRow, PlantRow, PollinationRow, Snapshot } from '../../shared/api'
import { PlantStage, PlantView } from './PlantView'
import { sun } from './useSnapshot'

export function fundTitle(fund: Fund): string {
  const kind = { seed: 'Seed', fertilizer: 'Fertilizer', sun: 'Sunbeam', pot: 'New pot' }[fund.kind]
  return `${kind} (${fund.rarity})`
}

export function fundEffect(fund: Fund): string {
  if (fund.kind === 'seed') return 'Goes into your seed box. The rarer the seed, the likelier it is variegated, and rare seeds often grow bromeliads.'
  if (fund.kind === 'fertilizer') return `Grows a plant by ${fundGrowthAmount(fund.rarity)}.`
  if (fund.kind === 'sun') return `Adds ${fundSunAmount(fund.rarity)} ☀ for the garden.`
  return 'Gives a plant a new glaze.'
}

function plantName(plant: PlantRow): string {
  return plant.name ?? speciesById(plant.genome.species).name
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

function PollinateChoices({ plant, plants }: { plant: PlantRow; plants: PlantRow[] }) {
  if (plant.growth < FLOWERING_GROWTH) return <p className="hint">Once it flowers, it can make seeds.</p>
  const partners = plants.filter((row) => row.id !== plant.id && !pollinationProblem(plant, row))
  return (
    <>
      <p className="hint">Drag a flowering plant onto its partner, or choose here. A bar then fills up with sun, and seeds land in your seed box.</p>
      {partners.map((partner) => (
        <button key={partner.id} className="button" onClick={() => void window.api.startPollination(plant.id, partner.id)}>
          Pollinate with {plantName(partner)} ({pollinationCost(plant.genome, partner.genome)} ☀)
        </button>
      ))}
      {partners.length === 0 && <p className="hint">No flowering partner of the other sex yet.</p>}
      <button className="button quiet" onClick={() => void window.api.startWithPollen(plant.id)}>
        Use bought pollen ({REWARDS.pollinateSameSpecies + REWARDS.pollenCost} ☀)
      </button>
    </>
  )
}

function PlantDetail({ plant, plants, wallet, freeBeds }: { plant: PlantRow; plants: PlantRow[]; wallet: number; freeBeds: number }) {
  const finished = plant.growth >= FLOWERING_GROWTH
  const origin = originLine(plant, plants)
  const inGarden = plant.location === 'garden'
  return (
    <div className="plant-detail">
      <input
        className="plant-name"
        aria-label="Plant name"
        defaultValue={plantName(plant)}
        onBlur={(event) => void window.api.renamePlant(plant.id, event.target.value)}
      />
      <p>
        {speciesById(plant.genome.species).name}
        {plant.growth >= REWARDS.sexShownGrowth && `, ${sexOf(plant.genome)}`}
        {plant.genome.variegation !== 'none' && `, variegated (${plant.genome.variegation})`}
      </p>
      {origin && <p className="hint">{origin}</p>}
      <PlantStage growth={plant.growth} />
      <div className="row">
        <button className="button" disabled={finished || wallet < REWARDS.waterCost} onClick={() => void window.api.water(plant.id)}>
          Water ({REWARDS.waterCost} ☀)
        </button>
        {inGarden ? (
          <button className="button quiet" disabled={plant.growth < SPROUT_GROWTH} onClick={() => void window.api.moveToGreenhouse(plant.id)}>
            Move to greenhouse
          </button>
        ) : (
          !finished && (
            <button className="button quiet" disabled={freeBeds <= 0} onClick={() => void window.api.moveToGarden(plant.id)}>
              Grow in the garden
            </button>
          )
        )}
      </div>
      {inGarden && plant.growth < SPROUT_GROWTH && (
        <>
          <p className="hint">It can go on show once it has sprouted. Until then you can dig it up to free the bed, and it starts over when sown again.</p>
          <button className="button quiet" onClick={() => void window.api.digUp(plant.id)}>
            Back to the seed box
          </button>
        </>
      )}
      {!inGarden && !finished && freeBeds <= 0 && <p className="hint">Plants only grow in a garden bed, and yours are all in use.</p>}
      <div className="breeding">
        <button
          className="button quiet"
          disabled={plant.growth < REWARDS.cuttingMinGrowth || wallet < REWARDS.cuttingCost}
          onClick={() => void window.api.takeCutting(plant.id)}
        >
          Take a cutting ({REWARDS.cuttingCost} ☀)
        </button>
        <p className="hint">
          {plant.growth < REWARDS.cuttingMinGrowth
            ? `Cuttings work from growth ${REWARDS.cuttingMinGrowth}.`
            : 'It goes to your seed box and roots in a garden bed. This plant stays as it is.'}
        </p>
        {!inGarden && <PollinateChoices plant={plant} plants={plants} />}
      </div>
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

function SeedBox({ items, plants, canSow }: { items: readonly NurseryRow[]; plants: readonly PlantRow[]; canSow: boolean }) {
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
          </span>
          <button className="button quiet" disabled={!canSow} onClick={() => void window.api.sow(item.id)}>
            {item.kind === 'cutting' ? 'Root' : 'Sow'}
          </button>
        </div>
      ))}
      {!canSow && <p className="hint">All beds are in use. Move a sprouted plant to the greenhouse, or add a bed.</p>}
    </section>
  )
}

function GardenPlot({ snapshot, selected, select }: { snapshot: Snapshot; selected: PlantRow | null; select: (id: number) => void }) {
  const { plants, gardenBeds, nursery, wallet } = snapshot
  const growing = plants.filter((plant) => plant.location === 'garden')
  const empty = Math.max(0, gardenBeds - growing.length)
  const nextCost = REWARDS.bedCosts[gardenBeds - 1]
  return (
    <>
      <div className="beds">
        {growing.map((plant) => (
          <div key={plant.id} className={`bed${selected?.id === plant.id ? ' selected' : ''}`}>
            <button className="bed-plant" onClick={() => select(plant.id)} aria-label={`Select ${plantName(plant)}`}>
              <PlantView plantId={plant.id} genome={plant.genome} growth={plant.growth} title={plantName(plant)} inBed />
            </button>
            <div className="bed-soil" />
            <div className="bed-label">
              <strong>{plantName(plant)}</strong>, {stageProgress(plant.growth).stage}
            </div>
          </div>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <div key={i} className="bed empty-bed">
            <div className="bed-plant">{nursery.length > 0 ? 'Empty bed. Sow from your seed box.' : 'Empty bed'}</div>
            <div className="bed-soil" />
          </div>
        ))}
        {nextCost !== undefined && (
          <div className="bed locked">
            <div className="bed-plant">
              <button className="button quiet" disabled={wallet < nextCost} onClick={() => void window.api.buyBed()}>
                Add a bed ({nextCost} ☀)
              </button>
            </div>
            <div className="bed-soil" />
          </div>
        )}
      </div>
      <SeedBox items={nursery} plants={plants} canSow={empty > 0} />
    </>
  )
}

function PollinationBar({ row, plants, wallet }: { row: PollinationRow; plants: readonly PlantRow[]; wallet: number }) {
  const a = plants.find((plant) => plant.id === row.plantA)
  const b = plants.find((plant) => plant.id === row.plantB)
  const label = a ? (b ? `${plantName(a)} and ${plantName(b)}` : `${plantName(a)} with bought pollen`) : 'Pollination'
  const share = Math.min(100, (row.paid / row.needed) * 100)
  return (
    <div className="pollination">
      <div className="week-item-head">
        <strong>{label}</strong>
        <span>
          {Math.floor(row.paid)} of {row.needed} ☀
        </span>
      </div>
      <div className="progress" role="progressbar" aria-label={`Pollination of ${label}`} aria-valuenow={Math.round(share)}>
        <span style={{ width: `${share}%` }} />
      </div>
      <div className="row">
        {[10, 50].map((amount) => (
          <button key={amount} className="button quiet" disabled={wallet < 1} onClick={() => void window.api.feedPollination(row.id, amount)}>
            +{amount} ☀
          </button>
        ))}
        <button className="button quiet" disabled={wallet < 1} onClick={() => void window.api.feedPollination(row.id, row.needed - row.paid)}>
          Give all I can
        </button>
      </div>
    </div>
  )
}

function Greenhouse({ snapshot, selected, select }: { snapshot: Snapshot; selected: PlantRow | null; select: (id: number) => void }) {
  const { plants, pollinations, wallet } = snapshot
  const onShow = plants.filter((plant) => plant.location === 'greenhouse')
  const [note, setNote] = useState<string | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  // Plants already here when it opens stay put; only a newly arrived one settles in.
  const known = useRef(new Set(onShow.map((plant) => plant.id)))
  useEffect(() => {
    for (const plant of onShow) known.current.add(plant.id)
  }, [onShow])

  const drop = (event: DragEvent, partner: PlantRow) => {
    event.preventDefault()
    setTarget(null)
    const dragged = plants.find((plant) => plant.id === Number(event.dataTransfer.getData('text/plain')))
    if (!dragged || dragged.id === partner.id) return
    const problem = pollinationProblem(dragged, partner)
    setNote(problem)
    if (!problem) void window.api.startPollination(dragged.id, partner.id)
  }

  return (
    <>
      <div className="glass-content">
        {onShow.length === 0 ? (
          <p className="empty">Nothing on show yet. Sprouted plants can move here from the garden, and flowering ones come by themselves.</p>
        ) : (
          <div className="glass-shelf">
            {onShow.map((plant) => (
              <button
                key={plant.id}
                className={`shelf-plant on-show${selected?.id === plant.id ? ' selected' : ''}${known.current.has(plant.id) ? '' : ' planted'}${target === plant.id ? ' drop-target' : ''}`}
                draggable={plant.growth >= FLOWERING_GROWTH}
                onDragStart={(event) => event.dataTransfer.setData('text/plain', String(plant.id))}
                onDragOver={(event) => {
                  event.preventDefault()
                  setTarget(plant.id)
                }}
                onDragLeave={() => setTarget(null)}
                onDrop={(event) => drop(event, plant)}
                onClick={() => select(plant.id)}
              >
                <PlantView plantId={plant.id} genome={plant.genome} growth={plant.growth} pot={plant.pot} title={plantName(plant)} />
                <span>
                  {plantName(plant)}, {stageProgress(plant.growth).stage}
                </span>
              </button>
            ))}
          </div>
        )}
        {note && (
          <p className="hint" role="status">
            {note}
          </p>
        )}
        {pollinations.length > 0 && (
          <section className="pollinations" aria-label="Pollinations">
            <h3>Pollinating</h3>
            {pollinations.map((row) => (
              <PollinationBar key={row.id} row={row} plants={plants} wallet={wallet} />
            ))}
          </section>
        )}
      </div>
    </>
  )
}

export function Garden({ snapshot }: { snapshot: Snapshot }) {
  const { plants, funds, wallet, streak, gardenBeds } = snapshot
  const [place, setPlace] = useState<'plot' | 'glass'>('plot')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const here = plants.filter((plant) => plant.location === (place === 'plot' ? 'garden' : 'greenhouse'))
  const selected = here.find((plant) => plant.id === selectedId) ?? here.find((plant) => plant.isCurrent) ?? here[0] ?? null
  const freeBeds = gardenBeds - plants.filter((plant) => plant.location === 'garden').length

  return (
    <>
      <nav className="place-tabs" aria-label="Places">
        <button className="tab" aria-current={place === 'plot'} onClick={() => setPlace('plot')}>
          Garden
        </button>
        <button className="tab" aria-current={place === 'glass'} onClick={() => setPlace('glass')}>
          Greenhouse
        </button>
      </nav>
      <div className={`world ${place}`}>
        <div className="world-main">
          {place === 'plot' ? (
            <GardenPlot snapshot={snapshot} selected={selected} select={setSelectedId} />
          ) : (
            <Greenhouse snapshot={snapshot} selected={selected} select={setSelectedId} />
          )}
        </div>
        <aside className="world-side">
          <p className="wallet">{sun(wallet)} to spend</p>
          {/* A new panel per plant, so its name field never carries over. */}
          {selected && <PlantDetail key={selected.id} plant={selected} plants={plants} wallet={wallet} freeBeds={freeBeds} />}
          {funds.length > 0 && (
            <>
              <h3>Finds</h3>
              <ul className="fund-list">
                {funds.map((fund) => (
                  <FundItem key={fund.id} fund={fund} selected={selected} />
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
    </>
  )
}
