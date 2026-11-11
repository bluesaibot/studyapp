import type { Genome } from '../core/plants'
import type { LeafState } from '../core/leaves'
import type { Fund } from '../core/rewards'
import type { Soil, SoilStats } from '../core/soil'
import type { SessionSettings, SessionState } from '../core/session'
import type { StreakState } from '../core/streak'
import type { CalendarSettings, CalendarState, EventKind, FinishesWith } from '../core/calendar'
import type { WeekState } from '../core/week'
import type { ChapterRow, CourseRow, DeckRequest, ImportReport, ReviewRequest, StudyItem } from './study'

export interface PlantRow {
  id: number
  genome: Genome
  growth: number
  pot: number
  name: string | null
  courseTag: string | null
  isCurrent: boolean
  location: 'garden' | 'greenhouse'
  bedId: number | null
  /** Its place in the greenhouse. */
  shelf: number | null
  /** What it grows in. Without one it is plain garden soil, with no effects. */
  soil: Soil | null
  /** Studied sun until it can bloom again. */
  restLeft: number
  /** Its flowers are shut: it is resting, or in the greenhouse. */
  flowersClosed: boolean
  /** Seed pods on it, from green and new (0) to brown and ripe (1). */
  pods: number | null
  leaves: LeafState
  /** Where it came from, when it grew from your own plants. */
  origin: { kind: 'cutting' | 'cross'; parentA: number; parentB: number | null } | null
}

/** A place in the garden, next to the beds before and after it. */
export interface BedRow {
  id: number
  position: number
  x: number
  y: number
  soil: Soil | null
}

/** Soil mixed on the bench and waiting for a bed. */
export interface MixRow {
  id: number
  name: string
  color: string
  litres: number
  stats: SoilStats
}

/** A seed or a cutting waiting for a free garden bed. */
export interface NurseryRow {
  id: number
  kind: 'seed' | 'cutting'
  genome: Genome
  parentA: number | null
  parentB: number | null
}

export interface PollinationRow {
  id: number
  plantA: number
  /** Empty when it runs on bought pollen. */
  plantB: number | null
  paid: number
  needed: number
  /** Sun on top of `needed` that pops the ripe seeds. */
  popNeeded: number
  /** Whether the sun earned while studying goes in here. */
  studyFill: boolean
}

export interface FundRow extends Fund {
  id: number
}

export interface SessionSummary {
  task: string
  todoId: number | null
  focusMs: number
  earnedSun: number
  funds: Fund[]
  blocks: number
  cardsReviewed: number
  questionsAnswered: number
}

export interface Snapshot {
  session: SessionState | null
  summary: SessionSummary | null
  wallet: number
  plants: PlantRow[]
  funds: FundRow[]
  streak: StreakState
  todayFocusMs: number
  lastTask: string
  /** The todo picked for the last session, so the home screen can offer it again. */
  lastTodoId: number | null
  settings: SessionSettings
  gardenBeds: number
  beds: BedRow[]
  /** Cuts left in your shears. */
  shears: number
  pollen: number
  soilStock: Record<string, number>
  mixes: MixRow[]
  ownedPots: number[]
  /** The plant you last clicked on, for the small window. */
  shownPlantId: number | null
  nursery: NurseryRow[]
  pollinations: PollinationRow[]
  week: WeekState
  calendar: CalendarState
}

export interface StudyApi {
  getSnapshot(): Promise<Snapshot>
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void
  start(task: string, todoId?: number | null): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  dip(): Promise<void>
  miniGoal(): Promise<void>
  setTask(task: string, todoId?: number | null): Promise<void>
  takeBreak(): Promise<void>
  returnFromBreak(): Promise<void>
  end(): Promise<void>
  dismissSummary(): Promise<void>
  water(plantId: number, amount?: number): Promise<void>
  useFund(fundId: number, plantId: number | null): Promise<void>
  setCurrentPlant(plantId: number): Promise<void>
  renamePlant(plantId: number, name: string): Promise<void>
  setSettings(settings: SessionSettings): Promise<void>
  showMain(): Promise<void>
  courses(): Promise<CourseRow[]>
  /** Opens a folder picker. Resolves to null when cancelled. */
  importCourse(): Promise<ImportReport | { error: string } | null>
  reimportCourse(courseId: number): Promise<ImportReport | { error: string } | null>
  renameCourse(courseId: number, name: string): Promise<void>
  chapters(courseId: number): Promise<ChapterRow[]>
  chapterBody(chapterId: number): Promise<string>
  nextItem(request: DeckRequest): Promise<StudyItem | null>
  review(request: ReviewRequest): Promise<void>
  resetProgress(courseId: number): Promise<void>
  takeCutting(plantId: number, leafIndex: number): Promise<void>
  sow(nurseryId: number, bedId: number | null): Promise<void>
  digUp(plantId: number): Promise<void>
  buyBed(x: number, y: number): Promise<void>
  setShownPlant(plantId: number): Promise<void>
  moveToGreenhouse(plantId: number): Promise<void>
  moveToGarden(plantId: number, bedId: number | null): Promise<void>
  swapBeds(bedA: number, bedB: number): Promise<void>
  swapShelf(plantA: number, plantB: number): Promise<void>
  startPollination(plantA: number, plantB: number): Promise<void>
  startWithPollen(plantId: number): Promise<void>
  feedPollination(id: number, amount: number): Promise<void>
  setPollinationFill(id: number, on: boolean): Promise<void>
  buySoil(ingredient: string, litres: number): Promise<void>
  mixSoil(recipe: Record<string, number>): Promise<void>
  discardMix(mixId: number): Promise<void>
  fillBed(bedId: number, mixId: number): Promise<void>
  buyPot(pot: number): Promise<void>
  setPot(plantId: number, pot: number): Promise<void>
  buyShears(id: string): Promise<void>
  buyPollen(): Promise<void>
  taskDone(taskId: number): Promise<void>
  taskUndo(taskId: number): Promise<void>
  addTask(title: string, timesPerWeek: number): Promise<void>
  removeTask(taskId: number): Promise<void>
  addEvent(event: { title: string; date: string; kind: EventKind; courseId: number | null; topic: string | null; effort: number | null; time: string | null }): Promise<void>
  setEventTime(eventId: number, time: string | null): Promise<void>
  removeEvent(eventId: number): Promise<void>
  setGrade(eventId: number, grade: number): Promise<void>
  addTodo(todo: { title: string; due: string | null; topic: string | null; effort: number | null; level: string | null }): Promise<void>
  toggleTodo(todoId: number): Promise<void>
  /** Ticks an open todo off with the time it really took, or none to go by the timer. */
  finishTodo(todoId: number, spentMinutes: number | null): Promise<void>
  setTodoSpent(todoId: number, spentMinutes: number | null): Promise<void>
  removeTodo(todoId: number): Promise<void>
  setCalendarSettings(settings: CalendarSettings): Promise<void>
  addTopic(name: string, finishesWith: FinishesWith, effort: number | null, level: string | null): Promise<void>
  renameTopic(topicId: number, name: string): Promise<void>
  setTopicEffort(topicId: number, effort: number | null, level: string | null): Promise<void>
  completeTopic(topicId: number): Promise<void>
  setMainTopic(topicId: number): Promise<void>
  setTopicFinish(topicId: number, finishesWith: FinishesWith): Promise<void>
  removeTopic(topicId: number): Promise<void>
  setTodoTopic(todoId: number, topic: string | null): Promise<void>
  setTodoEffort(todoId: number, effort: number | null, level: string | null): Promise<void>
  setEventTopic(eventId: number, topic: string | null, courseId: number | null): Promise<void>
}

export const API_METHODS = [
  'getSnapshot',
  'start',
  'pause',
  'resume',
  'dip',
  'miniGoal',
  'setTask',
  'takeBreak',
  'returnFromBreak',
  'end',
  'dismissSummary',
  'water',
  'useFund',
  'setCurrentPlant',
  'renamePlant',
  'setSettings',
  'showMain',
  'courses',
  'importCourse',
  'reimportCourse',
  'renameCourse',
  'chapters',
  'chapterBody',
  'nextItem',
  'review',
  'resetProgress',
  'takeCutting',
  'sow',
  'digUp',
  'buyBed',
  'setShownPlant',
  'moveToGreenhouse',
  'moveToGarden',
  'startPollination',
  'startWithPollen',
  'feedPollination',
  'swapBeds',
  'swapShelf',
  'setPollinationFill',
  'buySoil',
  'mixSoil',
  'discardMix',
  'fillBed',
  'buyPot',
  'setPot',
  'buyShears',
  'buyPollen',
  'taskDone',
  'taskUndo',
  'addTask',
  'removeTask',
  'addEvent',
  'setEventTime',
  'removeEvent',
  'setGrade',
  'addTodo',
  'toggleTodo',
  'finishTodo',
  'setTodoSpent',
  'removeTodo',
  'setCalendarSettings',
  'addTopic',
  'renameTopic',
  'setTopicEffort',
  'completeTopic',
  'setMainTopic',
  'setTopicFinish',
  'removeTopic',
  'setTodoTopic',
  'setTodoEffort',
  'setEventTopic',
] as const

export const SNAPSHOT_CHANNEL = 'snapshot'
