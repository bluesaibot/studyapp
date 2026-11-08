import Database from 'better-sqlite3'
import { join } from 'node:path'
import { crossGenomes, cuttingGenome, pollinationCost, pollinationProblem } from '../core/genetics'
import { fundGrowthAmount, fundSunAmount, REWARDS, type Fund } from '../core/rewards'
import {
  FLOWERING_GROWTH,
  makeGenome,
  POT_COLORS,
  speciesFromSeed,
  SPROUT_GROWTH,
  type Genome,
} from '../core/plants'
import { DEFAULT_SETTINGS, type SessionSettings, type SessionState } from '../core/session'
import { STREAK } from '../core/streak'
import type { FundRow, NurseryRow, PlantRow, PollinationRow } from '../shared/api'

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

  const getMeta = (key: string): string | undefined =>
    (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  const setMeta = (key: string, value: string) =>
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)

  const wallet = () => Number(getMeta('wallet') ?? 0)
  const addToWallet = (amount: number) => setMeta('wallet', String(wallet() + amount))

  function plants(): PlantRow[] {
    const rows = db
      .prepare(
        `SELECT plants.*, o.kind AS origin_kind, o.parent_a, o.parent_b FROM plants
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
      origin: row.origin_kind ? { kind: row.origin_kind, parentA: row.parent_a!, parentB: row.parent_b } : null,
    }))
  }

  function plantSeed(genome: Genome, courseTag: string | null, location: 'garden' | 'greenhouse' = 'garden'): number {
    const now = Date.now()
    return Number(
      db
        .prepare('INSERT INTO plants (genome, course_tag, created_at, location) VALUES (?, ?, ?, ?)')
        .run(JSON.stringify(genome), courseTag, now, location).lastInsertRowid,
    )
  }

  function setCurrentPlant(plantId: number) {
    db.prepare('UPDATE plants SET is_current = (id = ?)').run(plantId)
  }

  const gardenBeds = () => Number(getMeta('gardenBeds') ?? 1)

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

  /** Flowering plants have finished growing, and move to the greenhouse by themselves. */
  function settleGarden() {
    db.prepare("UPDATE plants SET location = 'greenhouse' WHERE location = 'garden' AND growth >= ?").run(FLOWERING_GROWTH)
  }

  /**
   * Keeps track of what grows in the garden. A free seed only comes when studying with an empty
   * garden and an empty seed box, never from moving plants around, so it cannot block a bed.
   */
  function ensureCurrentPlant(courseTag: string | null, mayPlantFreeSeed = false) {
    settleGarden()
    const all = plants()
    const inGarden = all.filter((plant) => plant.location === 'garden')
    const current = inGarden.find((plant) => plant.isCurrent)
    if (current) return
    if (inGarden.length > 0) {
      setCurrentPlant(inGarden[0].id)
      return
    }
    if (!mayPlantFreeSeed || nurseryCount() > 0) return
    const seed = Math.floor(Math.random() * 2 ** 31)
    const speciesId = all.length === 0 ? 'monstera' : speciesFromSeed(seed).id
    setCurrentPlant(plantSeed(makeGenome(speciesId, seed, 'common'), courseTag))
  }

  /** Splits newly earned sun between what grows in the garden and the wallet. */
  function applySun(amount: number, courseTag: string | null) {
    if (amount <= 0) return
    ensureCurrentPlant(courseTag, true)
    const growing = plants().filter((plant) => plant.location === 'garden')
    if (growing.length === 0) {
      // An empty garden loses nothing: all of it can be spent instead.
      addToWallet(amount)
      return
    }
    const each = (amount * REWARDS.autoGrowthShare) / growing.length
    const grow = db.prepare('UPDATE plants SET growth = growth + ? WHERE id = ?')
    for (const plant of growing) grow.run(each, plant.id)
    addToWallet(amount * (1 - REWARDS.autoGrowthShare))
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
      db.prepare('UPDATE plants SET growth = growth + ? WHERE id = ?').run(fundGrowthAmount(fund.rarity), plantId)
    } else {
      db.prepare('UPDATE plants SET pot = ? WHERE id = ?').run(fund.seed % POT_COLORS.length, plantId)
    }
    db.prepare('UPDATE funds SET used_at = ? WHERE id = ?').run(Date.now(), fundId)
    ensureCurrentPlant(courseTag)
  }

  function water(plantId: number) {
    if (wallet() < REWARDS.waterCost) return
    addToWallet(-REWARDS.waterCost)
    db.prepare('UPDATE plants SET growth = growth + ? WHERE id = ?').run(REWARDS.waterGrowth, plantId)
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

  const freeBeds = () => gardenBeds() - plants().filter((plant) => plant.location === 'garden').length

  /** A seed starts from nothing, and a cutting is already a small plant that still has to root. */
  function sow(nurseryId: number) {
    const row = db.prepare('SELECT * FROM nursery WHERE id = ?').get(nurseryId) as
      | { kind: 'seed' | 'cutting'; genome: string; parent_a: number | null; parent_b: number | null; course_tag: string | null }
      | undefined
    if (!row || freeBeds() <= 0) return
    const id = plantSeed(JSON.parse(row.genome) as Genome, row.course_tag)
    if (row.kind === 'cutting') db.prepare('UPDATE plants SET growth = ? WHERE id = ?').run(REWARDS.newPlantGrowth, id)
    if (row.parent_a !== null) {
      db.prepare('INSERT INTO plant_origin (plant_id, kind, parent_a, parent_b) VALUES (?, ?, ?, ?)').run(id, row.kind === 'cutting' ? 'cutting' : 'cross', row.parent_a, row.parent_b)
    }
    db.prepare('DELETE FROM nursery WHERE id = ?').run(nurseryId)
    ensureCurrentPlant(row.course_tag)
  }

  /** A seed that has not sprouted can go back in the box, to make room. It starts over when sown again. */
  function digUp(plantId: number) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.location !== 'garden' || plant.growth >= SPROUT_GROWTH) return
    addToNursery('seed', plant.genome, plant.origin?.parentA ?? null, plant.origin?.parentB ?? null, plant.courseTag)
    db.prepare('DELETE FROM plant_origin WHERE plant_id = ?').run(plantId)
    db.prepare('DELETE FROM plants WHERE id = ?').run(plantId)
    ensureCurrentPlant(null)
  }

  function buyBed() {
    const cost = REWARDS.bedCosts[gardenBeds() - 1]
    if (cost === undefined || wallet() < cost) return
    addToWallet(-cost)
    setMeta('gardenBeds', String(gardenBeds() + 1))
  }

  /** Once it has sprouted, a plant can go on show. It only keeps growing back in a bed. */
  function moveToGreenhouse(plantId: number) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.location !== 'garden' || plant.growth < SPROUT_GROWTH) return
    db.prepare("UPDATE plants SET location = 'greenhouse', is_current = 0 WHERE id = ?").run(plantId)
    ensureCurrentPlant(null)
  }

  function moveToGarden(plantId: number) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.location !== 'greenhouse' || plant.growth >= FLOWERING_GROWTH || freeBeds() <= 0) return
    db.prepare("UPDATE plants SET location = 'garden' WHERE id = ?").run(plantId)
    ensureCurrentPlant(null)
  }

  /** The parent plant loses nothing. Only the sun is spent. The cutting waits in the seed box. */
  function takeCutting(plantId: number, seed: number, courseTag: string | null) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.growth < REWARDS.cuttingMinGrowth || wallet() < REWARDS.cuttingCost) return
    addToWallet(-REWARDS.cuttingCost)
    addToNursery('cutting', cuttingGenome(plant.genome, seed), plantId, null, courseTag)
  }

  function pollinations(): PollinationRow[] {
    return db
      .prepare('SELECT id, plant_a AS plantA, plant_b AS plantB, paid, needed FROM pollinations WHERE done_at IS NULL ORDER BY id')
      .all() as PollinationRow[]
  }

  function startPollination(plantA: number, plantB: number) {
    const all = plants()
    const a = all.find((row) => row.id === plantA)
    const b = all.find((row) => row.id === plantB)
    if (!a || !b || plantA === plantB || pollinationProblem(a, b)) return
    const open = pollinations().some((row) => (row.plantA === plantA && row.plantB === plantB) || (row.plantA === plantB && row.plantB === plantA))
    if (open) return
    db.prepare('INSERT INTO pollinations (plant_a, plant_b, needed, created_at) VALUES (?, ?, ?, ?)').run(plantA, plantB, pollinationCost(a.genome, b.genome), Date.now())
  }

  /** Bought pollen: any flowering plant, whatever its sex, with itself. */
  function startWithPollen(plantId: number) {
    const plant = plants().find((row) => row.id === plantId)
    if (!plant || plant.growth < FLOWERING_GROWTH) return
    if (pollinations().some((row) => row.plantA === plantId && row.plantB === null)) return
    db.prepare('INSERT INTO pollinations (plant_a, plant_b, needed, created_at) VALUES (?, NULL, ?, ?)').run(plantId, REWARDS.pollinateSameSpecies + REWARDS.pollenCost, Date.now())
  }

  /** Fills the bar with sun. When it is full, one to four seeds land in the seed box. */
  function feedPollination(id: number, amount: number, seedFor: () => number) {
    const row = pollinations().find((entry) => entry.id === id)
    if (!row) return
    const spend = Math.min(amount, wallet(), row.needed - row.paid)
    if (spend <= 0) return
    addToWallet(-spend)
    const paid = row.paid + spend
    db.prepare('UPDATE pollinations SET paid = ? WHERE id = ?').run(paid, id)
    if (paid < row.needed) return
    const all = plants()
    const a = all.find((plant) => plant.id === row.plantA)
    const b = row.plantB === null ? a : all.find((plant) => plant.id === row.plantB)
    if (!a || !b) return
    const count = 1 + (seedFor() % 4)
    for (let i = 0; i < count; i += 1) addToNursery('seed', crossGenomes(a.genome, b.genome, seedFor()), a.id, b.id, a.courseTag)
    db.prepare('UPDATE pollinations SET seeds = ?, done_at = ? WHERE id = ?').run(count, Date.now(), id)
  }

  return {
    raw: db,
    getMeta,
    setMeta,
    addToWallet,
    settleGarden,
    gardenBeds,
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
