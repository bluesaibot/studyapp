import type { Genome } from '../core/plants'
import type { Fund } from '../core/rewards'
import type { SessionSettings, SessionState } from '../core/session'
import type { StreakState } from '../core/streak'
import type { ChapterRow, CourseRow, DeckRequest, ImportReport, ReviewRequest, StudyItem } from './study'

export interface PlantRow {
  id: number
  genome: Genome
  growth: number
  pot: number
  name: string | null
  courseTag: string | null
  isCurrent: boolean
}

export interface FundRow extends Fund {
  id: number
}

export interface SessionSummary {
  task: string
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
  settings: SessionSettings
}

export interface StudyApi {
  getSnapshot(): Promise<Snapshot>
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void
  start(task: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  dip(): Promise<void>
  miniGoal(): Promise<void>
  setTask(task: string): Promise<void>
  takeBreak(): Promise<void>
  returnFromBreak(): Promise<void>
  end(): Promise<void>
  dismissSummary(): Promise<void>
  water(plantId: number): Promise<void>
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
] as const

export const SNAPSHOT_CHANNEL = 'snapshot'
