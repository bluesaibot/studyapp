import { useEffect, useRef, useState } from 'react'
import { FLOWERING_GROWTH, nextStageProgress, speciesById, STAGES, stageIndex } from '../../core/plants'
import { fundGrowthAmount, fundSunAmount, REWARDS, type Fund } from '../../core/rewards'
import type { FundRow, PlantRow, Snapshot } from '../../shared/api'
import { PlantView } from './PlantView'
import { sun } from './useSnapshot'

export function fundTitle(fund: Fund): string {
  const kind = { seed: 'Seed', fertilizer: 'Fertilizer', sun: 'Sunbeam', pot: 'New pot' }[fund.kind]
  return `${kind} (${fund.rarity})`
}

export function fundEffect(fund: Fund): string {
  if (fund.kind === 'seed') return 'A new plant. The rarer the seed, the likelier it is variegated.'
  if (fund.kind === 'fertilizer') return `Grows a plant by ${fundGrowthAmount(fund.rarity)}.`
  if (fund.kind === 'sun') return `Adds ${fundSunAmount(fund.rarity)} ☀ for the garden.`
  return 'Gives a plant a new glaze.'
}

function plantName(plant: PlantRow): string {
  return plant.name ?? speciesById(plant.genome.species).name
}

function PlantDetail({ plant, wallet }: { plant: PlantRow; wallet: number }) {
  const stage = stageIndex(plant.growth)
  const finished = plant.growth >= FLOWERING_GROWTH
  return (
    <div className="plant-detail">
      <input
        key={plant.id}
        className="plant-name"
        aria-label="Plant name"
        defaultValue={plantName(plant)}
        onBlur={(event) => void window.api.renamePlant(plant.id, event.target.value)}
      />
      <p>
        {speciesById(plant.genome.species).name}, {STAGES[stage].name}
        {plant.genome.variegation !== 'none' && `, variegated (${plant.genome.variegation})`}
        {plant.courseTag && `. Grown during: ${plant.courseTag}`}
      </p>
      {!finished && (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(nextStageProgress(plant.growth) * 100)}>
          <span style={{ width: `${nextStageProgress(plant.growth) * 100}%` }} />
        </div>
      )}
      <div className="row">
        <button
          className="button"
          disabled={finished || wallet < REWARDS.waterCost}
          onClick={() => void window.api.water(plant.id)}
        >
          Water ({REWARDS.waterCost} ☀)
        </button>
        {!plant.isCurrent && !finished && (
          <button className="button quiet" onClick={() => void window.api.setCurrentPlant(plant.id)}>
            Grow this one while studying
          </button>
        )}
      </div>
    </div>
  )
}

function FundItem({ fund, selected }: { fund: FundRow; selected: PlantRow | null }) {
  const needsPlant = fund.kind === 'fertilizer' || fund.kind === 'pot'
  const action = { seed: 'Plant', fertilizer: 'Fertilize', sun: 'Collect', pot: 'Repot' }[fund.kind]
  return (
    <li className="fund-item">
      <div>
        <strong>{fundTitle(fund)}</strong>
        <p>{fundEffect(fund)}</p>
      </div>
      <button
        className="button quiet"
        disabled={needsPlant && !selected}
        onClick={() => void window.api.useFund(fund.id, selected?.id ?? null)}
      >
        {action}
      </button>
    </li>
  )
}

export function Garden({ snapshot }: { snapshot: Snapshot }) {
  const { plants, funds, wallet, streak } = snapshot
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = plants.find((plant) => plant.id === selectedId) ?? plants.find((plant) => plant.isCurrent) ?? plants[0] ?? null
  // Plants already here when the garden opens stay put; only a newly planted one settles in.
  const known = useRef(new Set(plants.map((plant) => plant.id)))
  useEffect(() => {
    for (const plant of plants) known.current.add(plant.id)
  }, [plants])

  return (
    <div className="garden">
      <div className="shelf-area">
        {plants.length === 0 ? (
          <p className="empty">Your first seed gets planted when you first study.</p>
        ) : (
          <div className="shelf">
            {plants.map((plant) => (
              <button
                key={plant.id}
                className={`shelf-plant${selected?.id === plant.id ? ' selected' : ''}${known.current.has(plant.id) ? '' : ' planted'}`}
                onClick={() => setSelectedId(plant.id)}
              >
                <PlantView plantId={plant.id} genome={plant.genome} growth={plant.growth} pot={plant.pot} title={plantName(plant)} />
                <span>{plantName(plant)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <aside className="garden-side">
        <p className="wallet">{sun(wallet)} to spend</p>
        {selected && <PlantDetail plant={selected} wallet={wallet} />}
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
                <li key={ring.start}>{ring.days} study days from {ring.start.split('-').reverse().join('.')}</li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}
