import { PlantView } from './PlantView'
import { clock, useSnapshot } from './useSnapshot'

export function Pill() {
  const snapshot = useSnapshot()
  const session = snapshot?.session
  if (!snapshot || !session) return null
  const plant = snapshot.plants.find((row) => row.isCurrent)
  const blockMs = session.settings.blockMinutes * 60_000

  const time = {
    study: clock(blockMs - session.blockFocusMs),
    paused: clock(blockMs - session.blockFocusMs),
    break: clock(session.breakRemainingMs),
    breakOver: 'Break over',
  }[session.phase]
  const label = { study: 'Studying', paused: 'Paused', break: 'Break', breakOver: 'Ready?' }[session.phase]

  return (
    <div className="pill">
      {plant && <PlantView key={plant.id} plantId={plant.id} className="pill-plant" genome={plant.genome} growth={plant.growth} pot={plant.pot} />}
      <div className="pill-text">
        <span className="pill-time">{time}</span>
        <span className="pill-label">{label}</span>
      </div>
      <button className="pill-open" onClick={() => void window.api.showMain()}>
        Open
      </button>
    </div>
  )
}
