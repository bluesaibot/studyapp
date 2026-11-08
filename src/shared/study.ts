import type { ReviewRating } from '../core/scheduler'
import type { ItemKind, ItemOption, ItemSource, ItemStatus } from '../core/qmd'

export interface CourseRow {
  id: number
  name: string
  sourcePath: string
  chapters: number
  cards: number
  questions: number
  cardsReady: number
  questionsReady: number
  mistakes: number
  reviewed: number
}

export interface ChapterRow {
  id: number
  number: number | null
  title: string
}

export interface ImportReport {
  courseId: number
  name: string
  chapters: number
  added: number
  updated: number
  retired: number
  imagesCopied: number
  imagesMissing: number
  warnings: string[]
}

export type DeckMode = 'review' | 'mistakes' | 'easy' | 'all'

export interface DeckRequest {
  courseId: number
  mode: DeckMode
  kind?: ItemKind
  chapterId?: number | null
  /** Goes past today's limit of new items. */
  moreNew?: boolean
  /** In the "all" deck: continue after this place in the Lernskript. */
  afterPosition?: number
}

export interface StudyItem {
  id: number
  /** Place in the Lernskript, the order of the "all" deck. */
  position: number
  /** How far through the "all" deck this item is. */
  progress?: { index: number; total: number }
  chapterId: number
  chapterTitle: string
  kind: ItemKind
  source: ItemSource
  label: string | null
  front: string
  back: string
  times: number
  status: ItemStatus | null
  /** Present on multiple choice questions. */
  options: ItemOption[] | null
  isNew: boolean
  onMistakeList: boolean
}

export interface ReviewRequest {
  itemId: number
  rating: ReviewRating
  /** What was typed for an open question, kept for AI grading later. */
  answer?: string
}
