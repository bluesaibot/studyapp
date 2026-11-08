import Database from 'better-sqlite3'
import { join } from 'node:path'
import { crossGenomes, cuttingGenome, pollinationCost, pollinationProblem } from '../core/genetics'
import { cutLeaf, cutProblem, leafType, NO_LEAF_STATE, regrowLeaves, rollNewLeaves, type LeafState } from '../core/leaves'
import { fundGrowthAmount, fundSunAmount, REWARDS, type Fund } from '../core/rewards'
import {
  FLOWERING_GROWTH,
  growthFromSun,
  makeGenome,
  speciesFromSeed,
  sproutCost,
  SPROUT_GROWTH,
  type Genome,
} from '../core/plants'
import { POT_DESIGNS } from '../core/pots'
import { bagPrice, BED_LITRES, ingredientById, mixStats, NO_SOIL_STATS, recipeColor, recipeLitres, recipeName, SHEARS, type Recipe, type Soil, type SoilStats } from '../core/soil'
import { DEFAULT_SETTINGS, type SessionSettings, type SessionState } from '../core/session'
import { STREAK } from '../core/streak'
import type { BedRow, FundRow, MixRow, NurseryRow, PlantRow, PollinationRow } from '../shared/api'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  task TEXT NOT NULL,
  date TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  focus_ms INTEGER NOT NULL DEFAULT 0,
  earned_sun REAL NOT NULL DEFAULT 0,
  blocks INTEGER NOT NULL DEFAULT 0,
  dips INTEGER NOT NULL DEFAULT 0,
  last_dip_focus_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plants (
  id INTEGER PRIMARY KEY,
  genome TEXT NOT NULL,
  growth REAL NOT NULL DEFAULT 0,
  pot INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  course_tag TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plant_origin (
  plant_id INTEGER PRIMARY KEY REFERENCES plants(id),
  kind TEXT NOT NULL,
  parent_a INTEGER NOT NULL,
  parent_b INTEGER
);
CREATE TABLE IF NOT EXISTS nursery (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  genome TEXT NOT NULL,
  parent_a INTEGER,
  parent_b INTEGER,
  course_tag TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pollinations (
  id INTEGER PRIMARY KEY,
  plant_a INTEGER NOT NULL,
  plant_b INTEGER,
  paid REAL NOT NULL DEFAULT 0,
  needed REAL NOT NULL,
  seeds INTEGER,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS funds (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  rarity TEXT NOT NULL,
  seed INTEGER NOT NULL,
  session_id INTEGER,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS beds (
  id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL,
  soil TEXT
);
CREATE TABLE IF NOT EXISTS soil_stock (ingredient TEXT PRIMARY KEY, litres REAL NOT NULL);
CREATE TABLE IF NOT EXISTS soil_mixes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  litres REAL NOT NULL,
  stats TEXT NOT NULL,
  recipe TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS owned_pots (pot INTEGER PRIMARY KEY);
`

interface PlantDbRow {
  id: number
  genome: string
  growth: number
  pot: number
  name: string | null
  course_tag: string | null
  is_current: number
  location: 'garden' | 'greenhouse'
  bed_id: number | null
  shelf: number | null
  own_soil: string | null
  bed_soil: string | null
  bloom_rest: number
  leaves: string | null
  origin_kind: 'cutting' | 'cross' | null
  parent_a: number | null
  parent_b: number | null
}

export type Db = ReturnType<typeof openDb>

export function openDb(dataDir: string) {
  const db = new Database(join(dataDir, 'studyapp.db'))
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  // Plants that were growing before there was a garden: the current one gets the first bed.
  const plantColumns = (db.prepare('PRAGMA table_info(plants)').all() as { name: string }[]).map((column) => column.name)
  if (!plantColumns.includes('location')) {
    db.transaction(() => {
      db.exec("ALTER TABLE plants ADD COLUMN location TEXT NOT NULL DEFAULT 'greenhouse'")
      db.exec("UPDATE plants SET location = 'garden' WHERE is_current = 1")
    })()
  }
  const addColumn = (table: string, column: string, type: string) => {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
  addColumn('plants', 'bed_id', 'INTEGER')
  addColumn('plants', 'shelf', 'INTEGER')
  addColumn('plants', 'soil', 'TEXT')
  addColumn('plants', 'bloom_rest', 'REAL NOT NULL DEFAULT 0')
  addColumn('plants', 'leaves', 'TEXT')
  addColumn('pollinations', 'study_fill', 'INTEGER NOT NULL DEFAULT 1')
  db.exec("UPDATE plants SET shelf = id WHERE location = 'greenhouse' AND shelf IS NULL")

  const getMeta = (key: string): string | undefined =>
    (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  const setMeta = (key: string, value: string) =>
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)

  const wallet = () => Number(getMeta('wallet') ?? 0)
  const addToWallet = (amount: number) => setMeta('wallet', String(wallet() + amount))

  // Beds used to be only a number. Each one is its own place now, and plants already growing get theirs.
  if ((db.prepare('SELECT COUNT(*) AS total FROM beds').get() as { total: number }).total === 0) {
    db.transaction(() => {
      const growing = db.prepare("SELECT id FROM plants WHERE location = 'garden' ORDER BY created_at, id").all() as { id: number }[]
      const count = Math.max(Number(getMeta('gardenBeds') ?? 1), growing.length, 1)
      for (let position = 0; position < count; position += 1) {
        const bed = db.prepare('INSERT INTO beds (position) VALUES (?)').run(position).lastInsertRowid
        if (growing[position]) db.prepare('UPDATE plants SET bed_id = ? WHERE id = ?').run(bed, growing[position].id)
      }
    })()
  }

  const parseSoil = (text: string | null): Soil | null => (text ? (JSON.parse(text) as Soil) : null)
  const statsOf = (plant: PlantRow): SoilStats => plant.soil?.stats ?? NO_SOIL_STATS

  function plants(): PlantRow[] {
    const rows = db
      .prepare(
        `SELECT plants.*, plants.soil AS own_soil, beds.soil AS bed_soil, o.kind AS origin_kind, o.parent_a, o.parent_b FROM plants
         LEFT JOIN beds ON beds.id = plants.bed_id
         LEFT JOIN plant_origin o ON o.plant_id = plants.id ORDER BY plants.created_at, plants.id`,
      )
      .all() as PlantDbRow[]
    return rows.map((row) => ({
      id: row.id,
      genome: JSON.parse(row.genome) as Genome,
      growth: row.growth,
      pot: row.pot,
      name: row.name,
      courseTag: row.course_tag,
      isCurrent: row.is_current === 1,
      location: row.location,
      bedId: row.bed_id,
      shelf: row.shelf,
      soil: parseSoil(row.location === 'garden' ? row.bed_soil : row.own_soil),
      restLeft: row.bloom_rest,
      leaves: row.leaves ? (JSON.parse(row.leaves) as LeafState) : NO_LEAF_STATE,
      origin: row.origin_kind ? { kind: row.origin_kind, parentA: row.parent_a!, parentB: row.parent_b } : null,
    }))
  }

  function plantSeed(genome: Genome, courseTag: string | null, bedId: number): number {
    return Number(
      db
        .prepare("INSERT INTO plants (genome, course_tag, created_at, location, bed_id) VALUES (?, ?, ?, 'garden', ?)")
        .run(JSON.stringify(genome), courseTag, Date.now(), bedId).lastInsertRowid,
    )
  }

  function setCurrentPlant(plantId: number) {
    db.prepare('UPDATE plants SET is_current = (id = ?)').run(plantId)
  }

  function beds(): BedRow[] {
    const rows = db.prepare('SELECT id, position, soil FROM beds ORDER BY position').all() as { id: number; position: number; soil: string | null }[]
    return rows.map((row) => ({ id: row.id, position: row.position, soil: parseSoil(row.soil) }))
  }
  const gardenBeds = () => beds().length
  const emptyBeds = () => {
    const taken = new Set(plants().map((plant) => plant.bedId))
    return beds().filter((bed) => !taken.has(bed.id))
  }

  const nurseryCount = () => (db.prepare('SELECT COUNT(*) AS total FROM nursery').get() as { total: number }).total

  function nursery(): NurseryRow[] {
    const rows = db.prepare('SELECT id, kind, genome, parent_a, parent_b FROM nursery ORDER BY id').all() as {
      id: number
      kind: 'seed' | 'cutting'
      genome: string
      parent_a: number | null
      parent_b: number | null
    }[]
    return rows.map((row) => ({ id: row.id, kind: row.kind, genome: JSON.parse(row.genome) as Genome, parentA: row.parent_a, parentB: row.parent_b }))
  }

  /**
   * Keeps track of what grows in the garden. A free seed only comes when studying with nothing growing, a
   * free bed and an empty seed box, never from moving plants around, so it cannot block a bed.
   */
  function ensureCurrentPlant(courseTag: string | null, mayPlantFreeSeed = false) {
    const all = plants()
    const growing = all.filter((plant) => plant.location === 'garden' && plant.growth < FLOWERING_GROWTH)
    if (growing.some((plant) => plant.isCurrent)) return
    if (growing.length > 0) {
      setCurrentPlant(growing[0].id)
      return
    }
    const free = emptyBeds()[0]
    if (!mayPlantFreeSeed || nurseryCount() > 0 || !free) return
    const seed = Math.floor(Math.random() * 2 ** 31)
    const speciesId = all.length === 0 ? 'monstera' : speciesFromSeed(seed).id
    setCurrentPlant(plantSeed(makeGenome(speciesId, seed, 'common'), courseTag, free.id))
  }

  /** Sun for one plant: its soil adds to it, waiting leaves come first, and the rest makes it grow. */
  function growPlant(plant: PlantRow, sun: number) {
    const stats = statsOf(plant)
    const regrow = regrowLeaves(plant.genome, plant.leaves, sun * (1 + stats.speed), plant.growth, true, stats.mutation, Math.random)
    const growth = growthFromSun(plant.growth, regrow.left, sproutCost(plant.genome, plant.origin?.kind === 'cutting'))
    const leaves = rollNewLeaves(plant.genome, regrow.state, plant.growth, growth, stats.mutation, Math.random)
    db.prepare('UPDATE plants SET growth = ?, leaves = ? WHERE id = ?').run(growth, JSON.stringify(leaves), plant.id)
  }

  /** Splits newly earned sun between what grows in the garden and the wallet or an open pollination. */
  function applySun(amount: number, courseTag: string | null) {
    if (amount <= 0) return
    ensureCurrentPlant(courseTag, true)
    const all = plants()
    const growing = all.filter((plant) => plant.location === 'garden' && plant.growth < FLOWERING_GROWTH)
    // Plants that are done growing still regrow leaves and get ready to bloom again, from studying alone.
    for (const plant of all) {
      if (growing.includes(plant) || plant.leaves.queue.length === 0) continue
      const stats = statsOf(plant)
      const regrow = regrowLeaves(plant.genome, plant.leaves, amount * REWARDS.autoGrowthShare * (1 + stats.speed), plant.growth, false, stats.mutation, Math.random)
      db.prepare('UPDATE plants SET leaves = ? WHERE id = ?').run(JSON.stringify(regrow.state), plant.id)
    }
    db.prepare('UPDATE plants SET bloom_rest = MAX(0, bloom_rest - ?) WHERE bloom_rest > 0').run(amount)
    // An empty garden loses nothing: all of it can be spent instead.
    const toSpend = growing.length === 0 ? amount : amount * (1 - REWARDS.autoGrowthShare)
    for (const plant of growing) growPlant(plant, (amount * REWARDS.autoGrowthShare) / growing.length)
    addToWallet(toSpend)
    // Studying fills an open pollination bar, unless that was switched off.
    const open = pollinations().find((row) => row.studyFill)
    if (open) payPollination(open, toSpend)
    ensureCurrentPlant(courseTag, true)
  }

  function createSession(task: string, date: string): number {
    setMeta('lastTask', task)
    return Number(
      db.prepare('INSERT INTO sessions (task, date, started_at) VALUES (?, ?, ?)').run(task, date, Date.now()).lastInsertRowid,
    )
  }

  function saveSession(id: number, state: SessionState, ended: boolean) {
    db.prepare(
      `UPDATE sessions SET task = ?, focus_ms = ?, earned_sun = ?, blocks = ?, dips = ?, last_dip_focus_ms = ?,
       ended_at = ? WHERE id = ?`,
    ).run(
      state.task,
      Math.round(state.focusMs),
      state.earnedSun,
      state.completedBlocks,
      state.dips,
      Math.round(state.lastDipFocusMs),
      ended ? Date.now() : null,
      id,
    )
  }

  function addFund(fund: Fund, sessionId: number | null) {
    db.prepare('INSERT INTO funds (kind, rarity, seed, session_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      fund.kind,
      fund.rarity,
      fund.seed,
      sessionId,
      Date.now(),
    )
  }

  function unusedFunds(): FundRow[] {
    return db.prepare('SELECT id, kind, rarity, seed FROM funds WHERE used_at IS NULL ORDER BY id DESC').all() as FundRow[]
  }

  function useFund(fundId: number, plantId: number | null, courseTag: string | null) {
    const fund = unusedFunds().find((row) => row.id === fundId)
    if (!fund) return
    if ((fund.kind === 'fertilizer' || fund.kind === 'pot') && plantId === null) return

    if (fund.kind === 'seed') {
      addToNursery('seed', makeGenome(speciesFromSeed(fund.seed, fund.rarity).id, fund.seed, fund.rarity), null, null, courseTag)
    } else if (fund.kind === 'sun') {
      addToWallet(fundSunAmount(fund.rarity))
    } else if (fund.kind === 'fertilizer') {
      const plant = plants().find((row) => row.id === plantId)
      if (plant) growPlant(plant, fundGrowthAmount(fund.rarity))
    } else {
      const pot = fund.seed % POT_DESIGNS.length
      db.prepare('UPDATE plants SET pot = ? WHERE id = ?').run(pot, plantId)
      db.prepare('INSERT OR IGNORE INTO owned_pots (pot) VALUES (?)').run(pot)
    }
    db.prepare('UPDATE funds SET used_at = ? WHERE id = ?').run(Date.now(), fundId)
    ensureCurrentPlant(courseTag)
  }

  function water(plantId: number) {
    if (wallet() < REWARDS.waterCost) return
    const plant = plants().find((row) => row.id === plantId)
    if (!plant) return
    addToWallet(-REWARDS.waterCost)
    growPlant(plant, REWARDS.waterGrowth)
    ensureCurrentPlant(null)
  }

  function addToNursery(kind: 'seed' | 'cutting', genome: Genome, parentA: number | null, parentB: number | null, courseTag: string | null) {
    db.prepare('INSERT INTO nursery (kind, genome, parent_a, parent_b, course_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      kind,
      JSON.stringify(genome),
      parentA,
      parentB,
      courseTag,
      Date.now(),
    )
  }

  /** Seeds and cuttings both start from nothing, and take the sun they need to sprout. */
  function sow(nurseryId: number, bedId: number | null = null) {
    const row = db.prepare('SELECT * FROM nursery WHERE id = ?').get(nurseryId) as
      | { kind: 'seed' | 'cutting'; genome: string; parent_a: number | null; parent_b: number | null; course_tag: string | null }
      | undefined
    const free = emptyBeds()
    const bed = free.find((candidate) => candidate.id === bedId) ?? free[0]
    if (!row || !bed) return
    const id = plantSeed(JSON.parse(row.genome) as Genome, row.course_tag, bed.id)
    if (row.parent_a !== null) {
      db.prepare('INSERT INTO plant_origin (plant_id, kind, parent_a, parent_b) VALUES (?, ?, ?, ?)').run(id, row.kind === 'cutting' ? 'cutting' : 'cross', row.parent_a, row.parent_b)
    }
    db.prepare('DELETE FROM nursery WHERE id = ?').run(nurseryId)
    ensureCurrentPlant(row.course_tag)
  }

  /** A plant that has not sprouted can go back in the box, to make room. It starts over when sown again. */
  function digUp(plantId: number) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.location !== 'garden' || plant.growth >= SPROUT_GROWTH) return
    addToNursery(plant.origin?.kind === 'cutting' ? 'cutting' : 'seed', plant.genome, plant.origin?.parentA ?? null, plant.origin?.parentB ?? null, plant.courseTag)
    db.prepare('DELETE FROM plant_origin WHERE plant_id = ?').run(plantId)
    db.prepare('DELETE FROM plants WHERE id = ?').run(plantId)
    ensureCurrentPlant(null)
  }

  function buyBed() {
    const cost = REWARDS.bedCosts[gardenBeds() - 1]
    if (cost === undefined || wallet() < cost) return
    addToWallet(-cost)
    const last = beds().at(-1)?.position ?? -1
    db.prepare('INSERT INTO beds (position) VALUES (?)').run(last + 1)
  }

  const inPollination = (plantId: number) => pollinations().some((row) => row.plantA === plantId || row.plantB === plantId)

  /** A plant takes its soil along into its pot. It is on show there, and only grows back in a bed. */
  function moveToGreenhouse(plantId: number) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.location !== 'garden' || plant.growth < REWARDS.showGrowth || inPollination(plantId)) return
    const shelf = (db.prepare('SELECT COALESCE(MAX(shelf), 0) + 1 AS next FROM plants').get() as { next: number }).next
    db.prepare("UPDATE beds SET soil = NULL WHERE id = ?").run(plant.bedId)
    db.prepare("UPDATE plants SET location = 'greenhouse', is_current = 0, bed_id = NULL, shelf = ?, soil = ? WHERE id = ?").run(shelf, plant.soil ? JSON.stringify(plant.soil) : null, plantId)
    ensureCurrentPlant(null)
  }

  /** Back into a bed, to grow on or to pollinate. Its pot waits, and fresh soil in the bed wins over its own. */
  function moveToGarden(plantId: number, bedId: number | null = null) {
    const plant = plants().find((row) => row.id === plantId)
    const free = emptyBeds()
    const bed = free.find((candidate) => candidate.id === bedId) ?? free[0]
    if (!plant || plant.location !== 'greenhouse' || !bed) return
    if (!bed.soil && plant.soil) db.prepare('UPDATE beds SET soil = ? WHERE id = ?').run(JSON.stringify(plant.soil), bed.id)
    db.prepare("UPDATE plants SET location = 'garden', bed_id = ?, shelf = NULL, soil = NULL WHERE id = ?").run(bed.id, plantId)
    ensureCurrentPlant(null)
  }

  /** Swaps two beds, with their soil and their plants. */
  function swapBeds(bedA: number, bedB: number) {
    const all = beds()
    const a = all.find((bed) => bed.id === bedA)
    const b = all.find((bed) => bed.id === bedB)
    if (!a || !b || a.id === b.id) return
    const move = db.prepare('UPDATE beds SET position = ? WHERE id = ?')
    move.run(b.position, a.id)
    move.run(a.position, b.id)
  }

  function swapShelf(plantA: number, plantB: number) {
    const all = plants()
    const a = all.find((plant) => plant.id === plantA)
    const b = all.find((plant) => plant.id === plantB)
    if (!a || !b || a.id === b.id || a.location !== 'greenhouse' || b.location !== 'greenhouse') return
    const move = db.prepare('UPDATE plants SET shelf = ? WHERE id = ?')
    move.run(b.shelf, a.id)
    move.run(a.shelf, b.id)
  }

  const shears = () => Number(getMeta('shears') ?? 0)
  const pollen = () => Number(getMeta('pollen') ?? 0)

  /** The leaf goes with the shears, and the plant regrows it, not always as it was. */
  function takeCutting(plantId: number, leafIndex: number, seed: number, courseTag: string | null) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || cutProblem(plant.genome, plant.leaves, plant.growth, leafIndex)) return
    const stats = statsOf(plant)
    const wear = 1 - stats.cuttings
    if (shears() < wear) return
    setMeta('shears', String(shears() - wear))
    const genome = cuttingGenome(plant.genome, seed, { leaf: leafType(plant.genome, plant.leaves, leafIndex), mutation: stats.mutation })
    addToNursery('cutting', genome, plantId, null, courseTag)
    db.prepare('UPDATE plants SET leaves = ? WHERE id = ?').run(JSON.stringify(cutLeaf(plant.genome, plant.leaves, plant.growth, leafIndex)), plantId)
  }

  function pollinations(): PollinationRow[] {
    const rows = db
      .prepare('SELECT id, plant_a AS plantA, plant_b AS plantB, paid, needed, study_fill AS fill FROM pollinations WHERE done_at IS NULL ORDER BY id')
      .all() as (Omit<PollinationRow, 'studyFill'> & { fill: number })[]
    return rows.map(({ fill, ...row }) => ({ ...row, studyFill: fill === 1 }))
  }

  /** Only plants in neighbouring beds reach each other. */
  function nextToEachOther(a: PlantRow, b: PlantRow): boolean {
    const all = beds()
    const bedA = all.findIndex((bed) => bed.id === a.bedId)
    const bedB = all.findIndex((bed) => bed.id === b.bedId)
    return bedA >= 0 && bedB >= 0 && Math.abs(bedA - bedB) === 1
  }

  function startPollination(plantA: number, plantB: number) {
    const all = plants()
    const a = all.find((row) => row.id === plantA)
    const b = all.find((row) => row.id === plantB)
    if (!a || !b || plantA === plantB || !nextToEachOther(a, b) || pollinationProblem(a, b)) return
    if (inPollination(plantA) || inPollination(plantB)) return
    db.prepare('INSERT INTO pollinations (plant_a, plant_b, needed, created_at) VALUES (?, ?, ?, ?)').run(plantA, plantB, pollinationCost(a.genome, b.genome), Date.now())
  }

  /** Bought pollen: any flowering plant in a bed, whatever its sex, by itself. */
  function startWithPollen(plantId: number) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.location !== 'garden' || plant.growth < FLOWERING_GROWTH || plant.restLeft > 0 || pollen() < 1 || inPollination(plantId)) return
    setMeta('pollen', String(pollen() - 1))
    db.prepare('INSERT INTO pollinations (plant_a, plant_b, needed, created_at) VALUES (?, NULL, ?, ?)').run(plantId, REWARDS.pollinateSameVariety, Date.now())
  }

  /** Puts sun from the wallet into the bar. When it is full, one to four seeds form. */
  function payPollination(row: PollinationRow, amount: number) {
    const spend = Math.min(amount, wallet(), row.needed - row.paid)
    if (spend <= 0) return
    addToWallet(-spend)
    const paid = row.paid + spend
    db.prepare('UPDATE pollinations SET paid = ? WHERE id = ?').run(paid, row.id)
    if (paid < row.needed) return
    const all = plants()
    const a = all.find((plant) => plant.id === row.plantA)
    const b = row.plantB === null ? a : all.find((plant) => plant.id === row.plantB)
    if (!a || !b) return
    const seedFor = () => Math.floor(Math.random() * 2 ** 31)
    const help = {
      mutation: (statsOf(a).mutation + statsOf(b).mutation) / 2,
      crossing: (statsOf(a).crossing + statsOf(b).crossing) / 2,
    }
    const count = 1 + (seedFor() % 4)
    // The first seed falls into a free bed next to the parents, if there is one. The others go to the seed box.
    const order = beds()
    const taken = new Set(all.map((plant) => plant.bedId))
    const neighbour = order.find((bed, place) => !taken.has(bed.id) && [order[place - 1], order[place + 1]].some((next) => next && (next.id === a.bedId || next.id === b.bedId)))
    for (let i = 0; i < count; i += 1) {
      const genome = crossGenomes(a.genome, b.genome, seedFor(), help)
      if (i === 0 && neighbour) {
        const id = plantSeed(genome, a.courseTag, neighbour.id)
        db.prepare("INSERT INTO plant_origin (plant_id, kind, parent_a, parent_b) VALUES (?, 'cross', ?, ?)").run(id, a.id, b.id)
      } else {
        addToNursery('seed', genome, a.id, b.id, a.courseTag)
      }
    }
    const rest = db.prepare('UPDATE plants SET bloom_rest = ? WHERE id = ?')
    for (const parent of a.id === b.id ? [a] : [a, b]) rest.run(REWARDS.bloomRestSun * (1 - statsOf(parent).bloom), parent.id)
    db.prepare('UPDATE pollinations SET seeds = ?, done_at = ? WHERE id = ?').run(count, Date.now(), row.id)
    ensureCurrentPlant(a.courseTag)
  }

  function feedPollination(id: number, amount: number) {
    const row = pollinations().find((entry) => entry.id === id)
    if (row) payPollination(row, amount)
  }

  const setPollinationFill = (id: number, on: boolean) => db.prepare('UPDATE pollinations SET study_fill = ? WHERE id = ?').run(on ? 1 : 0, id)

  function soilStock(): Record<string, number> {
    const rows = db.prepare('SELECT ingredient, litres FROM soil_stock').all() as { ingredient: string; litres: number }[]
    return Object.fromEntries(rows.map((row) => [row.ingredient, row.litres]))
  }

  function buySoil(ingredientId: string, litres: number) {
    const ingredient = ingredientById(ingredientId)
    if (!ingredient) return
    const price = bagPrice(ingredient, litres)
    if (wallet() < price) return
    addToWallet(-price)
    db.prepare('INSERT INTO soil_stock (ingredient, litres) VALUES (?, ?) ON CONFLICT(ingredient) DO UPDATE SET litres = litres + excluded.litres').run(ingredientId, litres)
  }

  function mixes(): MixRow[] {
    const rows = db.prepare('SELECT id, name, color, litres, stats FROM soil_mixes ORDER BY id DESC').all() as { id: number; name: string; color: string; litres: number; stats: string }[]
    return rows.map((row) => ({ ...row, stats: JSON.parse(row.stats) as SoilStats }))
  }

  /** Whatever is poured together stays a mix. The numbers come out a little different each time. */
  function mixSoil(recipe: Recipe) {
    const stock = soilStock()
    const entries = Object.entries(recipe).filter(([, litres]) => litres > 0)
    if (entries.length === 0 || entries.some(([id, litres]) => !ingredientById(id) || (stock[id] ?? 0) < litres)) return
    const used = Object.fromEntries(entries)
    const take = db.prepare('UPDATE soil_stock SET litres = litres - ? WHERE ingredient = ?')
    for (const [id, litres] of entries) take.run(litres, id)
    db.prepare('DELETE FROM soil_stock WHERE litres <= 0').run()
    db.prepare('INSERT INTO soil_mixes (name, color, litres, stats, recipe, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      recipeName(used),
      recipeColor(used),
      recipeLitres(used),
      JSON.stringify(mixStats(used, Math.random)),
      JSON.stringify(used),
      Date.now(),
    )
  }

  const discardMix = (mixId: number) => db.prepare('DELETE FROM soil_mixes WHERE id = ?').run(mixId)

  /** Fresh soil for a bed. Whatever grew there stays, and feels the new soil from now on. */
  function fillBed(bedId: number, mixId: number) {
    const mix = mixes().find((row) => row.id === mixId)
    if (!mix || mix.litres < BED_LITRES || !beds().some((bed) => bed.id === bedId)) return
    const soil: Soil = { name: mix.name, color: mix.color, stats: mix.stats }
    db.prepare('UPDATE beds SET soil = ? WHERE id = ?').run(JSON.stringify(soil), bedId)
    if (mix.litres - BED_LITRES <= 0) discardMix(mixId)
    else db.prepare('UPDATE soil_mixes SET litres = litres - ? WHERE id = ?').run(BED_LITRES, mixId)
  }

  /** Pots on your plants and the first pot count as yours without buying them. */
  function ownedPots(): number[] {
    const bought = (db.prepare('SELECT pot FROM owned_pots').all() as { pot: number }[]).map((row) => row.pot)
    return [...new Set([0, ...bought, ...plants().map((plant) => plant.pot)])].sort((a, b) => a - b)
  }

  function buyPot(pot: number) {
    const design = POT_DESIGNS[pot]
    if (!design || ownedPots().includes(pot) || wallet() < design.price) return
    addToWallet(-design.price)
    db.prepare('INSERT INTO owned_pots (pot) VALUES (?)').run(pot)
  }

  function setPot(plantId: number, pot: number) {
    if (ownedPots().includes(pot)) db.prepare('UPDATE plants SET pot = ? WHERE id = ?').run(pot, plantId)
  }

  function buyShears(id: string) {
    const item = SHEARS.find((row) => row.id === id)
    if (!item || wallet() < item.price) return
    addToWallet(-item.price)
    setMeta('shears', String(shears() + item.cuts))
  }

  function buyPollen() {
    if (wallet() < REWARDS.pollenCost) return
    addToWallet(-REWARDS.pollenCost)
    setMeta('pollen', String(pollen() + 1))
  }

  return {
    raw: db,
    getMeta,
    setMeta,
    addToWallet,
    gardenBeds,
    beds,
    swapBeds,
    swapShelf,
    shears,
    pollen,
    soilStock,
    buySoil,
    mixes,
    mixSoil,
    discardMix,
    fillBed,
    ownedPots,
    buyPot,
    setPot,
    buyShears,
    buyPollen,
    setPollinationFill,
    nursery,
    pollinations,
    sow,
    digUp,
    buyBed,
    moveToGreenhouse,
    moveToGarden,
    startPollination,
    startWithPollen,
    feedPollination,
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
    wallet,
    plants,
    ensureCurrentPlant,
    setCurrentPlant,
    applySun,
    createSession,
    saveSession,
    addFund,
    unusedFunds,
    useFund,
    water,
    takeCutting,
    renamePlant: (plantId: number, name: string) =>
      db.prepare('UPDATE plants SET name = ? WHERE id = ?').run(name.trim() || null, plantId),
    lastTask: () => getMeta('lastTask') ?? '',
    settings: (): SessionSettings => ({ ...DEFAULT_SETTINGS, ...JSON.parse(getMeta('settings') ?? '{}') }),
    setSettings: (settings: SessionSettings) => setMeta('settings', JSON.stringify(settings)),
    dayFocusMs: (date: string): number =>
      (db.prepare('SELECT COALESCE(SUM(focus_ms), 0) AS total FROM sessions WHERE date = ?').get(date) as { total: number }).total,
    studyDays: (): string[] =>
      (
        db
          .prepare('SELECT date FROM sessions GROUP BY date HAVING SUM(focus_ms) >= ?')
          .all(STREAK.minSessionMinutes * 60_000) as { date: string }[]
      ).map((row) => row.date),
    closeOpenSessions: () => db.prepare('UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL').run(Date.now()),
    close: () => db.close(),
  }
}
