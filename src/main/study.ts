import { NO_MISTAKE, recordAnswer, type MistakeState } from '../core/mistakes'
import type { ParsedCourse } from '../core/qmd'
import type { ReviewRating, Scheduler } from '../core/scheduler'
import type { ChapterRow, CourseRow, DeckRequest, ImportReport, ReviewRequest, StudyItem } from '../shared/study'
import type { Db } from './db'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  imported_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  position INTEGER NOT NULL,
  number INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0,
  UNIQUE (course_id, title)
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  key TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  label TEXT,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  times INTEGER NOT NULL DEFAULT 1,
  status TEXT,
  options TEXT,
  retired INTEGER NOT NULL DEFAULT 0,
  fsrs TEXT,
  due_at INTEGER,
  stability REAL,
  first_reviewed_at INTEGER,
  last_reviewed_at INTEGER,
  mistake TEXT,
  mistake_open INTEGER NOT NULL DEFAULT 0,
  UNIQUE (course_id, key)
);
CREATE INDEX IF NOT EXISTS items_due ON items (course_id, kind, due_at);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  rating INTEGER NOT NULL,
  answer TEXT,
  reviewed_at INTEGER NOT NULL
);
`

/** New items a day, so a fresh import never turns into a wall. "More" goes past this. */
const NEW_PER_DAY = { card: 30, question: 10 } as const
/** Learning steps due within this time are shown early once nothing else is left. */
const LEARNING_AHEAD_MS = 20 * 60_000
/** Keeps a card that was just answered from coming straight back in the shorter decks. */
const RECENT_MS = 60_000

const ACTIVE_ITEM = 'retired = 0'

interface ItemDbRow {
  id: number
  position: number
  chapter_id: number
  chapter_title: string
  kind: StudyItem['kind']
  source: StudyItem['source']
  label: string | null
  front: string
  back: string
  times: number
  status: StudyItem['status']
  options: string | null
  fsrs: string | null
  mistake_open: number
}

function toStudyItem(row: ItemDbRow): StudyItem {
  return {
    id: row.id,
    position: row.position,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    kind: row.kind,
    source: row.source,
    label: row.label,
    front: row.front,
    back: row.back,
    times: row.times,
    status: row.status,
    options: row.options ? (JSON.parse(row.options) as StudyItem['options']) : null,
    isNew: row.fsrs === null,
    onMistakeList: row.mistake_open === 1,
  }
}

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

export type Study = ReturnType<typeof openStudy>

const QUESTION_PAID_SCHEMA = `
CREATE TABLE question_paid (
  item_id INTEGER NOT NULL REFERENCES items(id),
  date TEXT NOT NULL,
  paid REAL NOT NULL,
  PRIMARY KEY (item_id, date)
);
`

export function openStudy(database: Db, scheduler: Scheduler, today: () => string) {
  const db = database.raw
  db.exec(SCHEMA)
  // Questions answered today before this rule existed were paid in full under the old one.
  const hasPaidTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'question_paid'").get()
  if (!hasPaidTable) {
    db.exec(QUESTION_PAID_SCHEMA)
    db.prepare(
      `INSERT INTO question_paid (item_id, date, paid)
       SELECT DISTINCT r.item_id, ?, 5 FROM reviews r JOIN items i ON i.id = r.item_id
       WHERE i.kind = 'question' AND r.reviewed_at >= ?`,
    ).run(today(), startOfDay(new Date()))
  }

  const selectItem = `SELECT i.id, i.position, i.chapter_id, c.title AS chapter_title, i.kind, i.source, i.label, i.front, i.back,
    i.times, i.status, i.options, i.fsrs, i.mistake_open
    FROM items i JOIN chapters c ON c.id = i.chapter_id`

  function saveCourse(parsed: ParsedCourse, sourcePath: string, fallbackName: string): ImportReport {
    return database.transaction(() => {
      const now = Date.now()
      const existing = db.prepare('SELECT id, name FROM courses WHERE source_path = ?').get(sourcePath) as
        | { id: number; name: string }
        | undefined
      const name = existing?.name ?? parsed.title ?? fallbackName
      const courseId = existing
        ? existing.id
        : Number(db.prepare('INSERT INTO courses (name, source_path, imported_at) VALUES (?, ?, ?)').run(name, sourcePath, now).lastInsertRowid)
      if (existing) db.prepare('UPDATE courses SET imported_at = ? WHERE id = ?').run(now, courseId)

      // Nothing with progress is ever deleted. What left the Lernskript is only hidden.
      db.prepare('UPDATE chapters SET retired = 1 WHERE course_id = ?').run(courseId)
      const before = db.prepare(`SELECT COUNT(*) AS total FROM items WHERE course_id = ? AND ${ACTIVE_ITEM}`).get(courseId) as { total: number }
      db.prepare('UPDATE items SET retired = 1 WHERE course_id = ?').run(courseId)

      const upsertChapter = db.prepare(`INSERT INTO chapters (course_id, position, number, title, body) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (course_id, title) DO UPDATE SET position = excluded.position, number = excluded.number,
        body = excluded.body, retired = 0 RETURNING id`)
      const findItem = db.prepare('SELECT id FROM items WHERE course_id = ? AND key = ?')
      const upsertItem = db.prepare(`INSERT INTO items (course_id, chapter_id, key, position, kind, source, label, front, back, times, status, options)
        VALUES (@courseId, @chapterId, @key, @position, @kind, @source, @label, @front, @back, @times, @status, @options)
        ON CONFLICT (course_id, key) DO UPDATE SET chapter_id = excluded.chapter_id, position = excluded.position, kind = excluded.kind,
        source = excluded.source, label = excluded.label, front = excluded.front, back = excluded.back, times = excluded.times,
        status = excluded.status, options = excluded.options, retired = 0`)

      let added = 0
      let updated = 0
      let position = 0
      parsed.chapters.forEach((chapter, chapterIndex) => {
        const { id: chapterId } = upsertChapter.get(courseId, chapterIndex, chapter.number, chapter.title, chapter.body) as { id: number }
        for (const item of chapter.items) {
          if (findItem.get(courseId, item.key)) updated += 1
          else added += 1
          position += 1
          upsertItem.run({ ...item, options: item.options ? JSON.stringify(item.options) : null, courseId, chapterId, position })
        }
      })

      return {
        courseId,
        name,
        chapters: parsed.chapters.length,
        added,
        updated,
        retired: Math.max(0, before.total - updated),
        imagesCopied: 0,
        imagesMissing: 0,
        warnings: parsed.warnings,
      }
    })
  }

  function newToday(courseId: number, kind: string, now: Date): number {
    return (
      db
        .prepare('SELECT COUNT(*) AS total FROM items WHERE course_id = ? AND kind = ? AND first_reviewed_at >= ?')
        .get(courseId, kind, startOfDay(now)) as { total: number }
    ).total
  }

  function courses(): CourseRow[] {
    const now = new Date()
    const rows = db.prepare('SELECT id, name, source_path FROM courses ORDER BY id').all() as {
      id: number
      name: string
      source_path: string
    }[]
    const count = (courseId: number, where: string, ...args: unknown[]) =>
      (
        db.prepare(`SELECT COUNT(*) AS total FROM items WHERE course_id = ? AND ${ACTIVE_ITEM} AND ${where}`).get(courseId, ...args) as {
          total: number
        }
      ).total
    return rows.map((row) => {
      const ready = (kind: 'card' | 'question') => {
        const due = count(row.id, 'kind = ? AND due_at <= ?', kind, now.getTime())
        const fresh = count(row.id, 'kind = ? AND fsrs IS NULL', kind)
        return due + Math.min(fresh, Math.max(0, NEW_PER_DAY[kind] - newToday(row.id, kind, now)))
      }
      return {
        id: row.id,
        name: row.name,
        sourcePath: row.source_path,
        chapters: (db.prepare('SELECT COUNT(*) AS total FROM chapters WHERE course_id = ? AND retired = 0').get(row.id) as { total: number }).total,
        cards: count(row.id, "kind = 'card'"),
        questions: count(row.id, "kind = 'question'"),
        cardsReady: ready('card'),
        questionsReady: ready('question'),
        mistakes: count(row.id, 'mistake_open = 1'),
        reviewed: count(row.id, 'fsrs IS NOT NULL'),
      }
    })
  }

  function nextItem(request: DeckRequest): StudyItem | null {
    const now = new Date()
    const time = now.getTime()
    const filters = [`i.course_id = @courseId`, `i.${ACTIVE_ITEM}`]
    const values: Record<string, unknown> = { courseId: request.courseId, time, recent: time - RECENT_MS }
    if (request.kind) {
      filters.push('i.kind = @kind')
      values.kind = request.kind
    }
    if (request.chapterId) {
      filters.push('i.chapter_id = @chapterId')
      values.chapterId = request.chapterId
    }
    const scope = filters.join(' AND ')
    const first = (where: string, order: string): StudyItem | null => {
      const row = db.prepare(`${selectItem} WHERE ${scope} AND ${where} ORDER BY ${order} LIMIT 1`).get(values) as ItemDbRow | undefined
      return row ? toStudyItem(row) : null
    }

    if (request.mode === 'all') {
      // Every item in Lernskript order, whatever its schedule says. Answers still count for the schedule.
      values.after = request.afterPosition ?? 0
      const item = first('i.position > @after', 'i.position')
      if (!item) return null
      const counts = db
        .prepare(`SELECT COUNT(*) AS total, SUM(i.position <= @after) AS done FROM items i WHERE ${scope}`)
        .get(values) as { total: number; done: number | null }
      return { ...item, progress: { index: (counts.done ?? 0) + 1, total: counts.total } }
    }

    if (request.mode === 'mistakes') {
      return first(
        `i.mistake_open = 1 AND (i.last_reviewed_at IS NULL OR i.last_reviewed_at < @recent)`,
        'i.last_reviewed_at',
      )
    }
    if (request.mode === 'easy') {
      // Well-known items first; a topic you have never seen is only used if there is nothing else.
      return (
        first(`i.kind = 'card' AND i.fsrs IS NOT NULL AND i.last_reviewed_at < @recent`, 'i.stability DESC') ??
        first(`i.kind = 'card' AND i.fsrs IS NULL AND i.source = 'falle'`, 'i.position')
      )
    }

    const due = first('i.due_at <= @time', 'i.due_at')
    if (due) return due

    // Most-asked exam topics first, then the order of the Lernskript.
    const canTakeNew =
      request.moreNew ||
      request.chapterId ||
      (request.kind !== undefined && newToday(request.courseId, request.kind, now) < NEW_PER_DAY[request.kind])
    if (canTakeNew) {
      const fresh = first('i.fsrs IS NULL', 'i.times DESC, i.position')
      if (fresh) return fresh
    }

    values.ahead = time + LEARNING_AHEAD_MS
    return first('i.due_at <= @ahead', 'i.due_at')
  }

  /** Returns the item's kind, for the session reward. */
  function review(request: ReviewRequest): StudyItem['kind'] | null {
    return database.transaction(() => {
      const item = db.prepare('SELECT kind, fsrs, mistake, first_reviewed_at FROM items WHERE id = ?').get(request.itemId) as
        | { kind: StudyItem['kind']; fsrs: string | null; mistake: string | null; first_reviewed_at: number | null }
        | undefined
      if (!item) return null
      const now = new Date()
      const time = now.getTime()
      const scheduled = scheduler.review(item.fsrs, request.rating, now)
      const missed = isMiss(item.kind, request.rating)
      const mistake = recordAnswer(
        item.mistake ? (JSON.parse(item.mistake) as MistakeState) : NO_MISTAKE,
        !missed,
        today(),
      )
      db.prepare(
        `UPDATE items SET fsrs = ?, due_at = ?, stability = ?, first_reviewed_at = COALESCE(first_reviewed_at, ?), last_reviewed_at = ?,
         mistake = ?, mistake_open = ? WHERE id = ?`,
      ).run(scheduled.state, scheduled.dueAt, scheduled.stability, time, time, JSON.stringify(mistake), mistake.open ? 1 : 0, request.itemId)
      db.prepare('INSERT INTO reviews (item_id, rating, answer, reviewed_at) VALUES (?, ?, ?, ?)').run(
        request.itemId,
        request.rating,
        request.answer?.trim() || null,
        time,
      )
      return item.kind
    })
  }

  /** Makes every item new again. Sun, plants and the streak live elsewhere and stay as they are. */
  function resetProgress(courseId: number) {
    db.prepare(
      `UPDATE items SET fsrs = NULL, due_at = NULL, stability = NULL, first_reviewed_at = NULL, last_reviewed_at = NULL,
       mistake = NULL, mistake_open = 0 WHERE course_id = ?`,
    ).run(courseId)
  }

  const paidToday = (itemId: number): number =>
    (db.prepare('SELECT paid FROM question_paid WHERE item_id = ? AND date = ?').get(itemId, today()) as { paid: number } | undefined)?.paid ?? 0

  function addPaid(itemId: number, amount: number) {
    db.prepare(
      `INSERT INTO question_paid (item_id, date, paid) VALUES (?, ?, ?)
       ON CONFLICT (item_id, date) DO UPDATE SET paid = paid + excluded.paid`,
    ).run(itemId, today(), amount)
  }

  return {
    saveCourse,
    courses,
    paidToday,
    addPaid,
    resetProgress,
    nextItem,
    review,
    renameCourse: (courseId: number, name: string) => {
      if (name.trim()) db.prepare('UPDATE courses SET name = ? WHERE id = ?').run(name.trim(), courseId)
    },
    chapters: (courseId: number): ChapterRow[] =>
      db.prepare('SELECT id, number, title FROM chapters WHERE course_id = ? AND retired = 0 ORDER BY position').all(courseId) as ChapterRow[],
    chapterBody: (chapterId: number): string =>
      (db.prepare('SELECT body FROM chapters WHERE id = ?').get(chapterId) as { body: string } | undefined)?.body ?? '',
    sourcePath: (courseId: number): string | null =>
      (db.prepare('SELECT source_path FROM courses WHERE id = ?').get(courseId) as { source_path: string } | undefined)?.source_path ?? null,
  }
}

/** Cards: only "Again" is a miss. Open questions: "Partly" also goes on the list. */
export function isMiss(kind: StudyItem['kind'], rating: ReviewRating): boolean {
  return rating === 1 || (kind === 'question' && rating === 2)
}
