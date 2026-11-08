import Database from 'better-sqlite3'
import { join } from 'node:path'
import { fundGrowthAmount, fundSunAmount, REWARDS, type Fund } from '../core/rewards'
import {
  FLOWERING_GROWTH,
  makeGenome,
  POT_COLORS,
  speciesFromSeed,
  type Genome,
} from '../core/plants'
import { DEFAULT_SETTINGS, type SessionSettings, type SessionState } from '../core/session'
import { STREAK } from '../core/streak'
import type { FundRow, PlantRow } from '../shared/api'

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
}

export type Db = ReturnType<typeof openDb>

export function openDb(dataDir: string) {
  const db = new Database(join(dataDir, 'studyapp.db'))
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  const getMeta = (key: string): string | undefined =>
    (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  const setMeta = (key: string, value: string) =>
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)

  const wallet = () => Number(getMeta('wallet') ?? 0)
  const addToWallet = (amount: number) => setMeta('wallet', String(wallet() + amount))

  function plants(): PlantRow[] {
    const rows = db.prepare('SELECT * FROM plants ORDER BY created_at, id').all() as PlantDbRow[]
    return rows.map((row) => ({
      id: row.id,
      genome: JSON.parse(row.genome) as Genome,
      growth: row.growth,
      pot: row.pot,
      name: row.name,
      courseTag: row.course_tag,
      isCurrent: row.is_current === 1,
    }))
  }

  function plantSeed(genome: Genome, courseTag: string | null): number {
    const now = Date.now()
    return Number(
      db
        .prepare('INSERT INTO plants (genome, course_tag, created_at) VALUES (?, ?, ?)')
        .run(JSON.stringify(genome), courseTag, now).lastInsertRowid,
    )
  }

  function setCurrentPlant(plantId: number) {
    db.prepare('UPDATE plants SET is_current = (id = ?)').run(plantId)
  }

  /** Keeps one unfinished plant in focus, and plants a free seed when all have flowered. */
  function ensureCurrentPlant(courseTag: string | null) {
    const all = plants()
    const current = all.find((plant) => plant.isCurrent)
    if (current && current.growth < FLOWERING_GROWTH) return
    const next = all.find((plant) => plant.growth < FLOWERING_GROWTH)
    if (next) {
      setCurrentPlant(next.id)
      return
    }
    const seed = Math.floor(Math.random() * 2 ** 31)
    const speciesId = all.length === 0 ? 'monstera' : speciesFromSeed(seed).id
    setCurrentPlant(plantSeed(makeGenome(speciesId, seed, 'common'), courseTag))
  }

  /** Splits newly earned sun between the current plant and the wallet. */
  function applySun(amount: number, courseTag: string | null) {
    if (amount <= 0) return
    ensureCurrentPlant(courseTag)
    db.prepare('UPDATE plants SET growth = growth + ? WHERE is_current = 1').run(amount * REWARDS.autoGrowthShare)
    addToWallet(amount * (1 - REWARDS.autoGrowthShare))
    ensureCurrentPlant(courseTag)
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
      plantSeed(makeGenome(speciesFromSeed(fund.seed, fund.rarity).id, fund.seed, fund.rarity), courseTag)
    } else if (fund.kind === 'sun') {
      addToWallet(fundSunAmount(fund.rarity))
    } else if (fund.kind === 'fertilizer') {
      db.prepare('UPDATE plants SET growth = growth + ? WHERE id = ?').run(fundGrowthAmount(fund.rarity), plantId)
    } else {
      db.prepare('UPDATE plants SET pot = ? WHERE id = ?').run(fund.seed % POT_COLORS.length, plantId)
    }
    db.prepare('UPDATE funds SET used_at = ? WHERE id = ?').run(Date.now(), fundId)
  }

  function water(plantId: number) {
    if (wallet() < REWARDS.waterCost) return
    addToWallet(-REWARDS.waterCost)
    db.prepare('UPDATE plants SET growth = growth + ? WHERE id = ?').run(REWARDS.waterGrowth, plantId)
  }

  return {
    raw: db,
    getMeta,
    setMeta,
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
