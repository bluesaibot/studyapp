import { bromeliadSeed, GOLD_GLAZE, POT_COLORS } from '../core/plants'
import { STREAK } from '../core/streak'
import { buildWeek, DEFAULT_TASKS, OWN_TASK_REWARD, startOfWeek, weekKey, type WeekReward, type WeekState, type WeekTaskView } from '../core/week'
import type { Db } from './db'

const SCHEMA = `
CREATE TABLE week_tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  times_per_week INTEGER NOT NULL,
  reward TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS week_task_done (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES week_tasks(id),
  week TEXT NOT NULL,
  done_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS week_claims (
  week TEXT NOT NULL,
  goal TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (week, goal)
);
`

export type Week = ReturnType<typeof openWeek>

export function grantReward(database: Db, reward: WeekReward) {
  const seed = reward.bromeliad ? bromeliadSeed(Math.random) : reward.gold ? POT_COLORS.indexOf(GOLD_GLAZE) : Math.floor(Math.random() * 2 ** 31)
  database.addFund({ kind: reward.kind, rarity: reward.rarity, seed }, null)
}

export function openWeek(database: Db) {
  const db = database.raw
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'week_tasks'").get()) {
    database.transaction(() => {
      db.exec(SCHEMA)
      const insert = db.prepare('INSERT INTO week_tasks (title, times_per_week, reward) VALUES (?, ?, ?)')
      for (const task of DEFAULT_TASKS) insert.run(task.title, task.timesPerWeek, JSON.stringify(task.reward))
    })
  }

  function tasks(week: string): WeekTaskView[] {
    const rows = db
      .prepare(
        `SELECT t.id, t.title, t.times_per_week, t.reward, COUNT(d.id) AS done FROM week_tasks t
         LEFT JOIN week_task_done d ON d.task_id = t.id AND d.week = ? WHERE t.active = 1 GROUP BY t.id ORDER BY t.id`,
      )
      .all(week) as { id: number; title: string; times_per_week: number; reward: string; done: number }[]
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      timesPerWeek: row.times_per_week,
      doneCount: row.done,
      reward: JSON.parse(row.reward) as WeekReward,
    }))
  }

  function state(now: Date): WeekState {
    const week = weekKey(now)
    const focus = db.prepare('SELECT COALESCE(SUM(focus_ms), 0) AS total FROM sessions WHERE date >= ?').get(week) as { total: number }
    const days = db
      .prepare('SELECT COUNT(*) AS total FROM (SELECT date FROM sessions WHERE date >= ? GROUP BY date HAVING SUM(focus_ms) >= ?)')
      .get(week, STREAK.minSessionMinutes * 60_000) as { total: number }
    const answers = db.prepare('SELECT COUNT(*) AS total FROM reviews WHERE reviewed_at >= ?').get(startOfWeek(now).getTime()) as { total: number }
    return buildWeek(week, { focusMinutes: Math.floor(focus.total / 60_000), studyDays: days.total, answers: answers.total }, tasks(week))
  }

  /** Hands out each reward once a week. Returns the titles of what was just reached. */
  function claimReached(now: Date): string[] {
    const current = state(now)
    const reached = [
      ...current.goals.filter((goal) => goal.reached).map((goal) => ({ id: goal.id, title: goal.title, reward: goal.reward })),
      ...current.tasks
        .filter((task) => task.doneCount >= task.timesPerWeek)
        .map((task) => ({ id: `task-${task.id}`, title: task.title, reward: task.reward })),
      ...(current.complete.reached && current.tasks.length > 0 ? [{ id: current.complete.id, title: current.complete.title, reward: current.complete.reward }] : []),
    ]
    const claim = db.prepare('INSERT OR IGNORE INTO week_claims (week, goal, claimed_at) VALUES (?, ?, ?)')
    const fresh: string[] = []
    database.transaction(() => {
      for (const item of reached) {
        if (claim.run(current.start, item.id, now.getTime()).changes > 0) {
          grantReward(database, item.reward)
          fresh.push(item.title)
        }
      }
    })
    return fresh
  }

  return {
    state,
    claimReached,
    taskDone(taskId: number, now: Date) {
      db.prepare('INSERT INTO week_task_done (task_id, week, done_at) VALUES (?, ?, ?)').run(taskId, weekKey(now), now.getTime())
    },
    /** Takes back a tap made by mistake. A reward already given stays, and is not given twice. */
    taskUndo(taskId: number, now: Date) {
      db.prepare('DELETE FROM week_task_done WHERE id = (SELECT MAX(id) FROM week_task_done WHERE task_id = ? AND week = ?)').run(taskId, weekKey(now))
    },
    addTask(title: string, timesPerWeek: number) {
      const name = title.trim()
      if (!name) return
      db.prepare('INSERT INTO week_tasks (title, times_per_week, reward) VALUES (?, ?, ?)').run(
        name,
        Math.min(14, Math.max(1, Math.round(timesPerWeek) || 1)),
        JSON.stringify(OWN_TASK_REWARD),
      )
    },
    removeTask(taskId: number) {
      db.prepare('UPDATE week_tasks SET active = 0 WHERE id = ?').run(taskId)
    },
  }
}
