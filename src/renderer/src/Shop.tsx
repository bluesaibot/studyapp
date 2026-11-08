import { useState, type DragEvent } from 'react'
import { POT_DESIGNS } from '../../core/pots'
import { REWARDS } from '../../core/rewards'
import { BAGS, bagPrice, BED_LITRES, ingredientById, INGREDIENTS, recipeLitres, recipeStats, SHEARS, SOIL_STATS, SOIL_WOBBLE, type Recipe, type SoilStats } from '../../core/soil'
import type { Snapshot } from '../../shared/api'
import { Pot } from './PlantView'

const shown = (stat: { id: keyof SoilStats }, value: number) => (stat.id === 'mutation' ? `+${(value * 100).toFixed(1)}%` : `+${Math.round(value * 100)}%`)

/** The kinds of effect are fixed by what went in. `wobble` shows the range a mix can land in. */
export function SoilBars({ stats, wobble = false }: { stats: SoilStats; wobble?: boolean }) {
  const present = SOIL_STATS.filter((stat) => stats[stat.id] > 0)
  if (present.length === 0) return <p className="hint">No effects yet.</p>
  return (
    <ul className="soil-bars">
      {present.map((stat) => (
        <li key={stat.id}>
          <span>{stat.label}</span>
          <span>{wobble ? `${shown(stat, stats[stat.id] * (1 - SOIL_WOBBLE))} to ${shown(stat, stats[stat.id] * (1 + SOIL_WOBBLE))}` : shown(stat, stats[stat.id])}</span>
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (stats[stat.id] / stat.max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Shop({ snapshot }: { snapshot: Snapshot }) {
  const { wallet, shears, pollen, soilStock, ownedPots } = snapshot
  return (
    <div className="shop">
      <section>
        <h3>Tools</h3>
        <p className="hint">Shears cut leaves for cuttings and wear out with use. You have {Number(shears.toFixed(1))} cuts left.</p>
        <ul className="shop-list">
          {SHEARS.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.name}</strong>, {item.cuts} cuts
              </span>
              <button className="button quiet" disabled={wallet < item.price} onClick={() => void window.api.buyShears(item.id)}>
                Buy ({item.price} ☀)
              </button>
            </li>
          ))}
          <li>
            <span>
              <strong>Pollen</strong>, lets one flowering plant pollinate itself. You have {pollen}.
            </span>
            <button className="button quiet" disabled={wallet < REWARDS.pollenCost} onClick={() => void window.api.buyPollen()}>
              Buy ({REWARDS.pollenCost} ☀)
            </button>
          </li>
        </ul>
      </section>
      <section>
        <h3>Soil</h3>
        <p className="hint">Comes in bags. Mix it on the soil bench. A bed takes {BED_LITRES} L.</p>
        <ul className="shop-list">
          {INGREDIENTS.map((ingredient) => (
            <li key={ingredient.id}>
              <span className="soil-name">
                <i className="soil-swatch" style={{ background: ingredient.color }} />
                <span>
                  <strong>{ingredient.name}</strong>, {soilStock[ingredient.id] ?? 0} L in stock
                  <small>{SOIL_STATS.filter((stat) => ingredient.stats[stat.id]).map((stat) => stat.label).join(', ')}</small>
                </span>
              </span>
              <span className="row">
                {BAGS.map((bag) => (
                  <button key={bag.litres} className="button quiet" disabled={wallet < bagPrice(ingredient, bag.litres)} onClick={() => void window.api.buySoil(ingredient.id, bag.litres)}>
                    {bag.litres} L ({bagPrice(ingredient, bag.litres)} ☀)
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Pots</h3>
        <p className="hint">They only look nice. A bought pot can be used on any plant, as often as you like.</p>
        <ul className="pot-shelf">
          {POT_DESIGNS.map((design, pot) => {
            const owned = ownedPots.includes(pot)
            return (
              <li key={design.name}>
                <svg viewBox="125 380 150 122" role="img" aria-label={design.name}>
                  <Pot design={design} />
                </svg>
                <span>{design.name}</span>
                {owned ? (
                  <small>In your collection</small>
                ) : (
                  <button className="button quiet" disabled={wallet < design.price} onClick={() => void window.api.buyPot(pot)}>
                    Buy ({design.price} ☀)
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

const POURS = [1, 5] as const

export function SoilBench({ snapshot }: { snapshot: Snapshot }) {
  const { soilStock, mixes } = snapshot
  const [recipe, setRecipe] = useState<Recipe>({})
  const [pour, setPour] = useState<(typeof POURS)[number]>(5)
  const [over, setOver] = useState(false)
  const total = recipeLitres(recipe)
  const left = (id: string) => (soilStock[id] ?? 0) - (recipe[id] ?? 0)

  const add = (id: string, litres: number) => {
    setRecipe((current) => {
      const amount = Math.min(litres, (soilStock[id] ?? 0) - (current[id] ?? 0))
      const next = Math.max(0, (current[id] ?? 0) + amount)
      const { [id]: _gone, ...rest } = current
      return next > 0 ? { ...rest, [id]: next } : rest
    })
  }

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const id = event.dataTransfer.getData('text/plain')
    if (ingredientById(id)) add(id, pour)
  }

  const stocked = INGREDIENTS.filter((ingredient) => (soilStock[ingredient.id] ?? 0) > 0)
  return (
    <div className="bench">
      <section className="bench-top">
        <div className="bags">
          <h3>Your soil</h3>
          {stocked.length === 0 && <p className="hint">Nothing here yet. Soil comes in bags from the shop.</p>}
          <div className="bag-row">
            {stocked.map((ingredient) => (
              <button
                key={ingredient.id}
                className="bag"
                draggable={left(ingredient.id) > 0}
                disabled={left(ingredient.id) <= 0}
                onDragStart={(event) => event.dataTransfer.setData('text/plain', ingredient.id)}
                onClick={() => add(ingredient.id, pour)}
              >
                <i className="bag-fill" style={{ background: ingredient.color }} />
                <strong>{ingredient.name}</strong>
                <span>{left(ingredient.id)} L</span>
              </button>
            ))}
          </div>
          <div className="row pour" role="group" aria-label="Litres per pour">
            {POURS.map((litres) => (
              <button key={litres} className="tab" aria-current={pour === litres} onClick={() => setPour(litres)}>
                {litres} L at a time
              </button>
            ))}
          </div>
        </div>
        <div
          className={`mix-bowl${over ? ' over' : ''}`}
          aria-label="Mixing tub"
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          {total === 0 ? (
            <p className="hint">Drag soil in here</p>
          ) : (
            <div className="strata" aria-hidden="true">
              {Object.entries(recipe).map(([id, litres]) => (
                <i key={id} style={{ flexGrow: litres, background: ingredientById(id)?.color }} />
              ))}
            </div>
          )}
        </div>
        <div className="mix-result">
          <h3>{total} L in the tub</h3>
          <ul className="tub-list">
            {Object.entries(recipe).map(([id, litres]) => (
              <li key={id}>
                <span>
                  {ingredientById(id)?.name}, {litres} L
                </span>
                <span className="row">
                  <button className="button quiet" aria-label={`Less ${ingredientById(id)?.name}`} onClick={() => add(id, -pour)}>
                    −
                  </button>
                  <button className="button quiet" aria-label={`More ${ingredientById(id)?.name}`} disabled={left(id) <= 0} onClick={() => add(id, pour)}>
                    +
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {total > 0 && <SoilBars stats={recipeStats(recipe)} wobble />}
          <button
            className="button"
            disabled={total === 0}
            onClick={() => {
              void window.api.mixSoil(recipe)
              setRecipe({})
            }}
          >
            Mix {total} L
          </button>
          {total > 0 && total < BED_LITRES && <p className="hint">A bed takes {BED_LITRES} L, so this would not fill one.</p>}
        </div>
      </section>
      <section>
        <h3>Your mixes</h3>
        {mixes.length === 0 && <p className="hint">Finished mixes wait here. Fill a bed with one from the garden.</p>}
        <ul className="mix-list">
          {mixes.map((mix) => (
            <li key={mix.id}>
              <i className="soil-swatch" style={{ background: mix.color }} />
              <div>
                <strong>{mix.name}</strong>, {mix.litres} L
                <SoilBars stats={mix.stats} />
              </div>
              <button className="button quiet" onClick={() => void window.api.discardMix(mix.id)}>
                Throw out
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
