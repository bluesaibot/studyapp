import { dateOffset } from './dates'
import { REWARDS } from './rewards'
import type { WeekReward } from './week'

export type EventKind = 'exam' | 'deadline' | 'event'

export interface CalendarEvent {
  id: number
  title: string
  date: string
  kind: EventKind
  courseId: number | null
  grade: number | null
  /** "HH:MM". After it, the exam counts as written. */
  time: string | null
  /** Free text: a subject, a project, anything. */
  topic: string | null
  /** Estimated work in hours. */
  effort: number | null
}

export interface Todo {
  id: number
  title: string
  due: string | null
  doneAt: number | null
  topic: string | null
  effort: number | null
  /** Set when the effort was picked as a size instead of typed in hours. */
  effortLevel: string | null
}

/** When a topic counts as finished. "never" is for anything ongoing or recurring. */
export type FinishesWith = 'subtasks' | 'never' | 'exam'

export interface TopicRow {
  id: number
  name: string
  finishesWith: FinishesWith
  /** The whole topic's size in hours, which sets its reward. */
  effort: number | null
  /** Set when the effort was picked as a size instead of typed in hours. */
  effortLevel: string | null
  completedAt: number | null
  /** The big thing right now: first in the list, the dropdown and the daily briefing. It pays nothing extra. */
  pinned?: boolean
  /** Focus time of sessions that ran under this topic. */
  workedMinutes?: number
}

export interface TopicView extends TopicRow {
  todosDone: number
  todosTotal: number
  /** Hours the todos, deadlines and exams were estimated at, still open. */
  effortOpen: number
  /** Everything it needs has happened, so it can be completed by hand. */
  ready: boolean
  /** What is still missing, in plain words. */
  missing: string[]
  state: string
  reward: TopicReward
}

export interface TopicReward {
  sun: number
  items: readonly WeekReward[]
}

export interface EffortLevel {
  id: string
  label: string
  hours: number
}

/** For when the hours are hard to guess. Each size pays what its hours would. */
export const TODO_LEVELS: readonly EffortLevel[] = [
  { id: 'small', label: 'Small', hours: 1 },
  { id: 'medium', label: 'Medium', hours: 3 },
  { id: 'big', label: 'Big', hours: 5 },
  { id: 'huge', label: 'Huge', hours: 10 },
]

export const TOPIC_LEVELS: readonly EffortLevel[] = [
  { id: 'small', label: 'Small', hours: 3 },
  { id: 'medium', label: 'Medium', hours: 10 },
  { id: 'big', label: 'Big', hours: 30 },
  { id: 'huge', label: 'Huge', hours: 60 },
]

/** A known size sets the hours, and typed hours clear the size. */
export function resolveEffort(levels: readonly EffortLevel[], effort: number | null, level: string | null): { effort: number | null; level: string | null } {
  const known = levels.find((row) => row.id === level)
  return known ? { effort: known.hours, level: known.id } : { effort, level: null }
}

/** Scales with the work. The biggest topics are worth weeks of ordinary rewards. */
export function topicReward(effort: number | null): TopicReward {
  const hours = effort ?? 0
  const sun = Math.min(REWARDS.topicMaxSun, Math.max(REWARDS.topicMinSun, Math.round(hours * REWARDS.topicSunPerHour)))
  if (hours >= 60) {
    return { sun, items: [{ kind: 'seed', rarity: 'rare', bromeliad: true }, { kind: 'pot', rarity: 'rare', gold: true }, { kind: 'fertilizer', rarity: 'rare' }] }
  }
  if (hours >= 20) return { sun, items: [{ kind: 'seed', rarity: 'rare' }, { kind: 'fertilizer', rarity: 'rare' }] }
  if (hours >= 5) return { sun, items: [{ kind: 'seed', rarity: 'uncommon' }, { kind: 'fertilizer', rarity: 'uncommon' }] }
  return { sun, items: [{ kind: 'fertilizer', rarity: 'common' }] }
}

export interface CalendarSettings {
  /** "HH:MM" */
  briefingTime: string
  notifications: boolean
  openAtLogin: boolean
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = { briefingTime: '08:00', notifications: true, openAtLogin: false }

export interface CalendarState {
  events: CalendarEvent[]
  todos: Todo[]
  topics: TopicView[]
  settings: CalendarSettings
}

/** Grades run from 1, the best, to 5. A 5 pays nothing and takes nothing; a retake pays as usual. */
export const GRADE_REWARDS: Record<number, readonly WeekReward[]> = {
  1: [{ kind: 'seed', rarity: 'rare', bromeliad: true }, { kind: 'pot', rarity: 'rare', gold: true }, { kind: 'fertilizer', rarity: 'rare' }, { kind: 'sun', rarity: 'rare' }],
  2: [{ kind: 'seed', rarity: 'rare' }, { kind: 'fertilizer', rarity: 'rare' }],
  3: [{ kind: 'seed', rarity: 'uncommon' }, { kind: 'sun', rarity: 'uncommon' }],
  4: [{ kind: 'sun', rarity: 'uncommon' }, { kind: 'fertilizer', rarity: 'common' }],
  5: [],
}

export function daysBetween(from: string, to: string): number {
  const parse = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((parse(to) - parse(from)) / 86_400_000)
}

/** An exam is over after its time. Without a time, it is over once its day has passed. */
export function examOver(event: CalendarEvent, today: string, time: string): boolean {
  if (event.kind !== 'exam') return false
  if (event.date !== today) return event.date < today
  return event.time !== null && event.time <= time
}

/** From the exam's day on, or from its time if it has one. Only once. */
export function canEnterGrade(event: CalendarEvent, today: string, time = '23:59'): boolean {
  if (event.kind !== 'exam' || event.grade !== null || event.date > today) return false
  return event.date < today || event.time === null || event.time <= time
}

/**
 * A course whose exams are all written goes to the bottom of the library, greyed out.
 * Adding a retake brings it straight back.
 */
export function courseOver(courseId: number, events: readonly CalendarEvent[], today: string, time: string): boolean {
  const exams = events.filter((event) => event.kind === 'exam' && event.courseId === courseId)
  return exams.length > 0 && exams.every((exam) => examOver(exam, today, time))
}

export function clockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Six weeks starting on a Monday, as dates, for a month with month 0 for January. */
export function monthDays(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => dateOffset(start, i))
}

const sameTopic = (a: string | null, b: string) => a?.trim().toLowerCase() === b.trim().toLowerCase()

/** The lowest passing grade is 4; a 5 leaves the topic open for the retake. */
const PASSED = (grade: number | null) => grade !== null && grade <= 4

export function buildTopicView(topic: TopicRow, events: readonly CalendarEvent[], todos: readonly Todo[], today = '0000-00-00', time = '00:00'): TopicView {
  const ownTodos = todos.filter((todo) => sameTopic(todo.topic, topic.name))
  const ownEvents = events.filter((event) => sameTopic(event.topic, topic.name))
  const todosDone = ownTodos.filter((todo) => todo.doneAt !== null).length
  const effortOpen =
    ownTodos.filter((todo) => todo.doneAt === null).reduce((total, todo) => total + (todo.effort ?? 0), 0) +
    ownEvents.filter((event) => event.grade === null).reduce((total, event) => total + (event.effort ?? 0), 0)
  const openTodos = ownTodos.length - todosDone
  const missing: string[] = []
  if (openTodos > 0 && topic.finishesWith !== 'never') missing.push(`${openTodos} ${openTodos === 1 ? 'todo' : 'todos'} still open`)

  let state: string
  if (topic.finishesWith === 'never') {
    state = ownTodos.length > 0 ? `Ongoing, ${todosDone} of ${ownTodos.length} todos done` : 'Ongoing'
  } else if (topic.finishesWith === 'subtasks') {
    if (ownTodos.length === 0) missing.push('No todos yet')
    state = ownTodos.length === 0 ? 'No todos yet' : `${todosDone} of ${ownTodos.length} todos done`
  } else {
    const exams = ownEvents.filter((event) => event.kind === 'exam').sort((a, b) => a.date.localeCompare(b.date))
    const passed = exams.find((exam) => PASSED(exam.grade))
    const open = exams.find((exam) => exam.grade === null && !examOver(exam, today, time))
    const waiting = exams.find((exam) => exam.grade === null && examOver(exam, today, time))
    if (passed) state = `Passed with grade ${passed.grade}`
    else if (open) state = `Exam on ${open.date.split('-').reverse().join('.')}`
    else if (waiting) state = 'Exam written, waiting for your grade'
    else state = exams.length > 0 ? 'Retake still open: add the next exam' : 'No exam yet: add one with this topic'
    if (!passed) missing.push(waiting ? 'Grade not entered yet' : open ? 'Exam still to come' : exams.length > 0 ? 'A passed retake' : 'An exam with this topic')
  }
  const ready = topic.completedAt === null && topic.finishesWith !== 'never' && missing.length === 0
  return { ...topic, todosDone, todosTotal: ownTodos.length, effortOpen, ready, missing, state, reward: topicReward(topic.effort) }
}

/** A course of the same name gives an exam its pace, so a typed topic is all it takes. */
export function courseForTopic<T extends { id: number; name: string }>(topic: string | null, courses: readonly T[]): T | undefined {
  const wanted = topic?.trim().toLowerCase()
  return wanted ? courses.find((course) => course.name.trim().toLowerCase() === wanted) : undefined
}

/** A positive number of hours, or nothing. Comma decimals work, since that is how they get typed here. */
export function parseEffort(text: string): number | null {
  const hours = Number(text.trim().replace(',', '.'))
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 100) / 100 : null
}

export function effortText(hours: number): string {
  return `${String(hours).replace('.', ',')} h`
}

export function whenText(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export interface BriefingItem {
  key: string
  text: string
  todoId?: number
}

export interface CourseProgress {
  id: number
  name: string
  fresh: number
  ready: number
}

/** What a daily pace would be. It simply recalculates each day, so falling behind never shows. */
export function paceText(fresh: number, days: number): string | null {
  if (fresh <= 0) return null
  const perDay = Math.ceil(fresh / Math.max(1, days))
  return `${fresh} still new, about ${perDay} a day`
}

const MAX_BRIEFING = 3

export function workedText(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

function pinnedLine(topic: TopicView): string {
  const worked = topic.workedMinutes ? `, ${workedText(topic.workedMinutes)} worked` : ''
  if (topic.todosTotal === 0) return `${topic.name}: what is your next step? Add it in Topics${worked}.`
  const open = topic.todosTotal - topic.todosDone
  return `${topic.name}: ${open} of ${topic.todosTotal} todos open${worked}.`
}

/** At most three things for today. Open todos from earlier days are simply open, never overdue. */
export function buildBriefing(state: CalendarState, courses: readonly CourseProgress[], today: string, time = '00:00'): BriefingItem[] {
  const items: BriefingItem[] = []
  const pinned = state.topics.find((topic) => topic.pinned && topic.completedAt === null)
  const pinnedItem: BriefingItem | null = pinned ? { key: `topic-${pinned.id}`, text: pinnedLine(pinned) } : null
  const upcoming = state.events
    .filter((event) => event.date >= today && !examOver(event, today, time) && (event.kind === 'event' ? event.date === today : daysBetween(today, event.date) <= 21))
    .sort((a, b) => a.date.localeCompare(b.date))
  // An exam within days comes first; after that the important topic is always there.
  const urgent = upcoming.filter((event) => event.kind === 'exam' && daysBetween(today, event.date) <= 3).length
  for (const [index, event] of upcoming.slice(0, 2).entries()) {
    if (index === urgent && pinnedItem) items.push(pinnedItem)
    const days = daysBetween(today, event.date)
    const course = courses.find((row) => row.id === event.courseId)
    const pace = course ? paceText(course.fresh, days) : null
    const at = event.time ? ` at ${event.time}` : ''
    const text = event.kind === 'event' ? `${event.title} today` : `${event.title}: ${event.kind} ${whenText(days)}${at}`
    items.push({ key: `event-${event.id}`, text: pace ? `${text}. ${pace}.` : `${text}.` })
  }
  if (pinnedItem && !items.includes(pinnedItem)) items.push(pinnedItem)
  const todos = state.todos.filter((todo) => todo.doneAt === null && todo.due !== null && todo.due <= today)
  for (const todo of todos) items.push({ key: `todo-${todo.id}`, text: todo.title, todoId: todo.id })
  const graded = state.events.find((event) => event.grade === null && examOver(event, today, time))
  if (graded) items.push({ key: `grade-${graded.id}`, text: `Got your grade for ${graded.title}? It can earn a reward.` })
  const ready = courses.find((course) => course.ready > 0 && !courseOver(course.id, state.events, today, time))
  if (ready) items.push({ key: `ready-${ready.id}`, text: `${ready.ready} ready in ${ready.name}.` })
  return items.slice(0, MAX_BRIEFING)
}

export interface DueNotification {
  key: string
  title: string
  body: string
}

const EXAM_REMINDER_DAYS = [14, 7, 3, 1, 0]

/** Reminders from the briefing time on. The caller remembers keys, so each fires once. */
export function dueNotifications(state: CalendarState, today: string, time: string, sent: ReadonlySet<string>): DueNotification[] {
  if (!state.settings.notifications || time < state.settings.briefingTime) return []
  const notes: DueNotification[] = []
  const add = (note: DueNotification) => {
    if (!sent.has(note.key)) notes.push(note)
  }
  const dueToday = state.todos.filter((todo) => todo.doneAt === null && todo.due === today)
  const events = state.events.filter((event) => event.kind === 'event' && event.date === today)
  const firstThings = [...events.map((event) => event.title), ...dueToday.map((todo) => todo.title)]
  add({
    key: `briefing:${today}`,
    title: 'Your day',
    body: firstThings.length > 0 ? firstThings.slice(0, 3).join(', ') : 'Open the app for today. Just 5 minutes, then decide again.',
  })
  for (const item of state.events.filter((event) => event.kind !== 'event' && event.grade === null)) {
    if (examOver(item, today, time)) {
      add({ key: `exam-over:${item.id}`, title: item.title, body: 'Done! Enter your grade in the calendar when you have it.' })
      continue
    }
    const days = daysBetween(today, item.date)
    const word = item.kind === 'exam' ? 'Exam' : 'Deadline'
    if (EXAM_REMINDER_DAYS.includes(days)) {
      add({ key: `exam:${item.id}:${days}`, title: item.title, body: days === 0 ? `${word} today. Good luck!` : `${word} ${whenText(days)}.` })
    }
  }
  return notes
}
