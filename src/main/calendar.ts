import { buildTopicView, canEnterGrade, clockTime, DEFAULT_CALENDAR_SETTINGS, dueNotifications, GRADE_REWARDS, type CalendarEvent, type CalendarSettings, type CalendarState, type EventKind, type FinishesWith, type Todo, type TopicRow } from '../core/calendar'
import { todoSun } from '../core/rewards'
import { localDate } from '../core/streak'
import type { Db } from './db'
import { grantReward } from './week'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  course_id INTEGER,
  grade INTEGER,
  graded_at INTEGER
);
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  due TEXT,
  done_at INTEGER
);
CREATE TABLE IF NOT EXISTS notifications_sent (
  key TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
`

export type Calendar = ReturnType<typeof openCalendar>

/** A first guess at the thesis, big enough for the top reward. It can be changed in the topic. */
const THESIS_SIZE_HOURS = 200

const validTime = (time: string | null) => (time && /^\d{2}:\d{2}$/.test(time) ? time : null)

export function openCalendar(database: Db) {
  const db = database.raw
  db.exec(SCHEMA)
  // Added after the first version, so existing tables get them here. Nothing else changes.
  for (const table of ['calendar_events', 'todos']) {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name)
    if (!columns.includes('topic')) db.exec(`ALTER TABLE ${table} ADD COLUMN topic TEXT`)
    if (!columns.includes('effort')) db.exec(`ALTER TABLE ${table} ADD COLUMN effort REAL`)
  }
  const todoColumns = (db.prepare('PRAGMA table_info(todos)').all() as { name: string }[]).map((column) => column.name)
  if (!todoColumns.includes('paid')) db.exec('ALTER TABLE todos ADD COLUMN paid INTEGER NOT NULL DEFAULT 0')
  const eventColumns = (db.prepare('PRAGMA table_info(calendar_events)').all() as { name: string }[]).map((column) => column.name)
  if (!eventColumns.includes('time')) db.exec('ALTER TABLE calendar_events ADD COLUMN time TEXT')

  const hasTopics = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'topics'").get()
  if (!hasTopics) {
    database.transaction(() => {
      db.exec(`CREATE TABLE topics (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        finishes_with TEXT NOT NULL
      )`)
      // Exams entered with a course take its name as their topic, and finish with that exam.
      db.exec(`UPDATE calendar_events SET topic = (SELECT name FROM courses WHERE courses.id = course_id) WHERE topic IS NULL AND course_id IS NOT NULL`)
      db.exec(`INSERT OR IGNORE INTO topics (name, finishes_with) SELECT DISTINCT topic, 'exam' FROM calendar_events WHERE topic IS NOT NULL AND kind = 'exam'`)
      db.exec(`INSERT OR IGNORE INTO topics (name, finishes_with) SELECT DISTINCT topic, 'subtasks' FROM calendar_events WHERE topic IS NOT NULL`)
      db.exec(`INSERT OR IGNORE INTO topics (name, finishes_with) SELECT DISTINCT topic, 'subtasks' FROM todos WHERE topic IS NOT NULL`)
    })
  }

  const topicColumns = (db.prepare('PRAGMA table_info(topics)').all() as { name: string }[]).map((column) => column.name)
  if (!topicColumns.includes('effort')) db.exec('ALTER TABLE topics ADD COLUMN effort REAL')
  if (!topicColumns.includes('completed_at')) db.exec('ALTER TABLE topics ADD COLUMN completed_at INTEGER')

  if (!topicColumns.includes('pinned')) db.exec('ALTER TABLE topics ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
  // The thesis is the big thing, so it starts out there once. Removing it later is final.
  if (!database.getMeta('thesisTopicAdded')) {
    database.transaction(() => {
      const known = (db.prepare('SELECT id, name FROM topics').all() as { id: number; name: string }[]).find((row) => /bachelor/i.test(row.name))
      if (known) db.prepare('UPDATE topics SET pinned = 1 WHERE id = ?').run(known.id)
      else db.prepare("INSERT INTO topics (name, finishes_with, effort, pinned) VALUES ('Bachelorarbeit', 'subtasks', ?, 1)").run(THESIS_SIZE_HOURS)
      database.setMeta('thesisTopicAdded', '1')
    })
  }

  /** Returns the spelling already in use, and creates the topic when it is new. */
  function useTopic(name: string | null, finishesWith: FinishesWith): string | null {
    const wanted = name?.trim()
    if (!wanted) return null
    // Compared here, because SQLite's NOCASE only folds ASCII and would treat Ü and ü as different.
    const known = (db.prepare('SELECT name FROM topics').all() as { name: string }[]).find((row) => row.name.toLowerCase() === wanted.toLowerCase())
    if (known) return known.name
    db.prepare('INSERT INTO topics (name, finishes_with) VALUES (?, ?)').run(wanted, finishesWith)
    return wanted
  }

  const events = (): CalendarEvent[] =>
    db.prepare('SELECT id, title, date, kind, course_id AS courseId, grade, time, topic, effort FROM calendar_events ORDER BY date, time IS NULL, time, id').all() as CalendarEvent[]
  const todos = (): Todo[] =>
    db.prepare('SELECT id, title, due, done_at AS doneAt, topic, effort FROM todos ORDER BY done_at IS NOT NULL, due IS NULL, due, id').all() as Todo[]
  const settings = (): CalendarSettings => ({ ...DEFAULT_CALENDAR_SETTINGS, ...JSON.parse(database.getMeta('calendarSettings') ?? '{}') })
  const topicRows = () =>
    db.prepare(`SELECT id, name, finishes_with AS finishesWith, effort, completed_at AS completedAt, pinned = 1 AS pinned,
       COALESCE((SELECT SUM(focus_ms) FROM sessions WHERE sessions.task = topics.name), 0) / 60000 AS workedMinutes
       FROM topics ORDER BY pinned DESC, name`).all() as TopicRow[]
  const state = (now = new Date()): CalendarState => {
    const allEvents = events()
    const allTodos = todos()
    const topics = topicRows().map((topic) => buildTopicView({ ...topic, pinned: Boolean(topic.pinned), workedMinutes: Math.floor(topic.workedMinutes ?? 0) }, allEvents, allTodos, localDate(now), clockTime(now)))
    return { events: allEvents, todos: allTodos, topics, settings: settings() }
  }

  return {
    state,
    addEvent({ title, date, kind, courseId, topic, effort, time }: { title: string; date: string; kind: EventKind; courseId: number | null; topic: string | null; effort: number | null; time: string | null }) {
      const name = title.trim()
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !['exam', 'deadline', 'event'].includes(kind)) return
      db.prepare('INSERT INTO calendar_events (title, date, kind, course_id, topic, effort, time) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, date, kind, courseId, useTopic(topic, kind === 'exam' ? 'exam' : 'subtasks'), effort, validTime(time))
    },
    setEventTime(eventId: number, time: string | null) {
      db.prepare('UPDATE calendar_events SET time = ? WHERE id = ? AND grade IS NULL').run(validTime(time), eventId)
    },
    /** A graded exam stays, as a record of what you earned. */
    removeEvent(eventId: number) {
      db.prepare('DELETE FROM calendar_events WHERE id = ? AND grade IS NULL').run(eventId)
    },
    /** Once per exam, and only from its day on. The rewards go to the garden's finds. */
    setGrade(eventId: number, grade: number, now: Date) {
      const event = events().find((row) => row.id === eventId)
      if (!event || !canEnterGrade(event, localDate(now), clockTime(now)) || !GRADE_REWARDS[grade]) return
      db.prepare('UPDATE calendar_events SET grade = ?, graded_at = ? WHERE id = ?').run(grade, now.getTime(), eventId)
      for (const reward of GRADE_REWARDS[grade]) grantReward(database, reward)
    },
    addTodo({ title, due, topic, effort }: { title: string; due: string | null; topic: string | null; effort: number | null }) {
      const name = title.trim()
      if (name) db.prepare('INSERT INTO todos (title, due, topic, effort) VALUES (?, ?, ?, ?)').run(name, due || null, useTopic(topic, 'subtasks'), effort)
    },
    /** Pays once, the first time it is ticked; unticking takes nothing back and ticking again adds nothing. */
    toggleTodo(todoId: number, now: Date) {
      const todo = db.prepare('SELECT effort, done_at, paid FROM todos WHERE id = ?').get(todoId) as { effort: number | null; done_at: number | null; paid: number } | undefined
      if (!todo) return
      db.prepare('UPDATE todos SET done_at = CASE WHEN done_at IS NULL THEN ? ELSE NULL END, paid = 1 WHERE id = ?').run(now.getTime(), todoId)
      if (todo.done_at === null && !todo.paid) database.addToWallet(todoSun(todo.effort))
    },
    removeTodo(todoId: number) {
      db.prepare('DELETE FROM todos WHERE id = ?').run(todoId)
    },
    addTopic(name: string, finishesWith: FinishesWith, effort: number | null) {
      const topic = useTopic(name, finishesWith)
      if (topic && effort !== null) db.prepare('UPDATE topics SET effort = ? WHERE name = ?').run(effort, topic)
    },
    renameTopic(topicId: number, name: string) {
      const wanted = name.trim()
      const topic = db.prepare('SELECT name FROM topics WHERE id = ?').get(topicId) as { name: string } | undefined
      const names = (db.prepare('SELECT name FROM topics WHERE id != ?').all(topicId) as { name: string }[]).map((row) => row.name.toLowerCase())
      if (!topic || !wanted || names.includes(wanted.toLowerCase())) return
      database.transaction(() => {
        db.prepare('UPDATE topics SET name = ? WHERE id = ?').run(wanted, topicId)
        db.prepare('UPDATE todos SET topic = ? WHERE topic = ?').run(wanted, topic.name)
        db.prepare('UPDATE calendar_events SET topic = ? WHERE topic = ?').run(wanted, topic.name)
        db.prepare('UPDATE sessions SET task = ? WHERE task = ?').run(wanted, topic.name)
      })
    },
    /** Only one topic is the big one at a time. */
    setTopicPinned(topicId: number, pinned: boolean) {
      db.prepare('UPDATE topics SET pinned = CASE WHEN id = ? THEN ? ELSE 0 END').run(topicId, pinned ? 1 : 0)
    },
    setTopicEffort(topicId: number, effort: number | null) {
      db.prepare('UPDATE topics SET effort = ? WHERE id = ? AND completed_at IS NULL').run(effort, topicId)
    },
    /** By hand, once everything it needs has happened. Pays once, and then it stays completed. */
    completeTopic(topicId: number, now: Date) {
      const topic = state(now).topics.find((row) => row.id === topicId)
      if (!topic?.ready) return
      db.prepare('UPDATE topics SET completed_at = ? WHERE id = ?').run(now.getTime(), topicId)
      database.addToWallet(topic.reward.sun)
      for (const reward of topic.reward.items) grantReward(database, reward)
    },
    setTopicFinish(topicId: number, finishesWith: FinishesWith) {
      db.prepare('UPDATE topics SET finishes_with = ? WHERE id = ?').run(finishesWith, topicId)
    },
    /** Its todos, deadlines and exams stay; they just no longer have a topic. */
    removeTopic(topicId: number) {
      const topic = db.prepare('SELECT name FROM topics WHERE id = ?').get(topicId) as { name: string } | undefined
      if (!topic) return
      db.prepare('UPDATE todos SET topic = NULL WHERE topic = ?').run(topic.name)
      db.prepare('UPDATE calendar_events SET topic = NULL WHERE topic = ?').run(topic.name)
      db.prepare('DELETE FROM topics WHERE id = ?').run(topicId)
    },
    setTodoTopic(todoId: number, topic: string | null) {
      db.prepare('UPDATE todos SET topic = ? WHERE id = ?').run(useTopic(topic, 'subtasks'), todoId)
    },
    setTodoEffort(todoId: number, effort: number | null) {
      db.prepare('UPDATE todos SET effort = ? WHERE id = ?').run(effort, todoId)
    },
    setEventTopic(eventId: number, topic: string | null, courseId: number | null) {
      db.prepare('UPDATE calendar_events SET topic = ?, course_id = ? WHERE id = ?').run(useTopic(topic, 'subtasks'), courseId, eventId)
    },
    setSettings(next: CalendarSettings) {
      database.setMeta('calendarSettings', JSON.stringify(next))
    },
    takeNotifications(now: Date) {
      const sent = new Set((db.prepare('SELECT key FROM notifications_sent').all() as { key: string }[]).map((row) => row.key))
      const notes = dueNotifications(state(now), localDate(now), clockTime(now), sent)
      const remember = db.prepare('INSERT OR IGNORE INTO notifications_sent (key, sent_at) VALUES (?, ?)')
      for (const note of notes) remember.run(note.key, now.getTime())
      return notes
    },
  }
}
