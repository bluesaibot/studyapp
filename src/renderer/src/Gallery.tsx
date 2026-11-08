import { makeGenome, SPECIES, type Genome, type Variegation } from '../../core/plants'
import { PlantView } from './PlantView'

const KINDS: Variegation[] = ['none', 'marbled', 'sectoral', 'aurea', 'albo', 'mint']

/** Development view of leaf rendering: open with the #gallery route. */
export function Gallery() {
  const growths = [5, 40, 150, 350, 800]
  return (
    <div className="gallery">
      {SPECIES.map((species, row) => (
        <div className="gallery-row" key={species.id}>
          {growths.map((growth, column) => {
            const genome: Genome = {
              ...makeGenome(species.id, 1000 + row * 37 + column * 11, 'common'),
              variegation: KINDS[(row + column) % KINDS.length],
            }
            return <PlantView key={growth} genome={genome} growth={growth} pot={row} />
          })}
        </div>
      ))}
    </div>
  )
}
