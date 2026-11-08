import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db'

const KEEP = 30

/** Keeps a copy of the plants, sun and study progress from every launch, the newest 30 of them. */
export async function backupOnLaunch(database: Db, dataDir: string, now = new Date()): Promise<void> {
  const folder = join(dataDir, 'backups')
  mkdirSync(folder, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  await database.raw.backup(join(folder, `studyapp-${stamp}.db`))
  const backups = readdirSync(folder)
    .filter((name) => /^studyapp-.*\.db$/.test(name))
    .sort()
  for (const old of backups.slice(0, -KEEP)) rmSync(join(folder, old))
}
