import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReviewRating } from '../../core/scheduler'
import type { ItemKind, ItemOption } from '../../core/qmd'
import type { Snapshot } from '../../shared/api'
import type { ChapterRow, CourseRow, DeckMode, StudyItem } from '../../shared/study'
import { DipPanel } from './App'
import { PlantStage, PlantView } from './PlantView'
import { Prose } from './Prose'
import { clock, sun } from './useSnapshot'

export type StudyTab = 'cards' | 'all' | 'questions' | 'allQuestions' | 'mistakes' | 'easy' | 'read'

export interface StudyPlace {
  courseId: number
  tab: StudyTab
}

const EASY_DECK_SIZE = 10

/** Where the "all" deck stopped, so a long run can continue after a break or a restart. */
const allCursors = new Map<string, number>()

function readCursor(key: string): number {
  const known = allCursors.get(key)
  if (known !== undefined) return known
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}

function writeCursor(key: string, position: number) {
  allCursors.set(key, position)
  try {
    localStorage.setItem(key, String(position))
  } catch {
    // Continuing where you stopped is only a convenience.
  }
}

function clearCursors(courseId: number) {
  const prefixes = [`studyapp.all.${courseId}.`, `studyapp.all.questions.${courseId}.`]
  for (const key of allCursors.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) allCursors.delete(key)
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key)
    }
  } catch {
    // Continuing where you stopped is only a convenience.
  }
}

/** Starts a course over. Asks first, because the schedule cannot be brought back. */
export function ResetProgress({ course, done }: { course: CourseRow; done: () => void }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button className="button quiet" onClick={() => setAsking(true)}>
        Reset progress
      </button>
    )
  }
  return (
    <div className="reset-confirm" role="alertdialog" aria-label="Reset progress">
      <p>
        All {course.cards + course.questions} cards and questions of this course become new again, and the Fehlerliste empties.
        Your sun, plants and streak stay as they are.
      </p>
      <div className="row">
        <button
          className="button"
          onClick={() => {
            void window.api.resetProgress(course.id).then(() => {
              clearCursors(course.id)
              setAsking(false)
              done()
            })
          }}
        >
          Yes, reset
        </button>
        <button className="button quiet" onClick={() => setAsking(false)}>
          Keep my progress
        </button>
      </div>
    </div>
  )
}

const STATUS_NOTE: Record<NonNullable<StudyItem['status']>, string | null> = {
  ok: null,
  wrong: 'The old answer in the catalogue was wrong. Learn the correction.',
  imprecise: 'The old answer in the catalogue was imprecise. Learn the correction.',
  unverified: 'Not fully covered by the Skript, so treat this as textbook knowledge.',
}

function itemMeta(item: StudyItem): string {
  const parts = [item.chapterTitle]
  if (item.label) parts.unshift(item.label)
  if (item.progress) parts.unshift(`${item.progress.index} of ${item.progress.total}`)
  if (item.times > 1) parts.push(`came up ${item.times}× in past exams`)
  if (item.isNew) parts.push('new')
  if (item.onMistakeList) parts.push('on your Fehlerliste')
  return parts.join(', ')
}

const FLAG_NOTE = { unsure: '⚠️ unklar formuliert', 'not-in-skript': '❓ nicht im Skript' } as const

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function ChoiceList({ options, picked, toggle, revealed, courseId }: {
  options: ItemOption[]
  picked: ReadonlySet<ItemOption>
  toggle: (option: ItemOption) => void
  revealed: boolean
  courseId: number
}) {
  return (
    <ol className="choices" lang="de">
      {options.map((option, index) => {
        const isPicked = picked.has(option)
        const judgedRight = isPicked === option.correct
        return (
          <li key={option.text}>
            <button
              className={`choice${isPicked ? ' picked' : ''}${revealed ? (judgedRight ? ' right' : ' off') : ''}`}
              role="checkbox"
              aria-checked={isPicked}
              disabled={revealed}
              onClick={() => toggle(option)}
            >
              <span className="choice-box" aria-hidden="true">{isPicked ? '✓' : ''}</span>
              <span className="choice-text">
                <Prose markdown={option.text} courseId={courseId} />
                {revealed && (
                  <span className="choice-reason">
                    <strong>{option.correct ? 'Richtig' : 'Falsch'}</strong>
                    {option.flag && ` ${FLAG_NOTE[option.flag]}`}
                    <Prose markdown={option.reason} courseId={courseId} />
                    {option.note && <em className="choice-note">{option.note}</em>}
                  </span>
                )}
              </span>
              {!revealed && <kbd>{index + 1}</kbd>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

interface DeckProps {
  courseId: number
  mode: DeckMode
  kind?: ItemKind
  chapterId: number | null
  ensureSession: () => Promise<void>
  /** Called after each answer, to keep the "ready" numbers current. */
  answered: () => void
}

function Deck({ courseId, mode, kind, chapterId, ensureSession, answered }: DeckProps) {
  const [item, setItem] = useState<StudyItem | null | undefined>(undefined)
  const [revealed, setRevealed] = useState(false)
  const [answer, setAnswer] = useState('')
  const [moreNew, setMoreNew] = useState(false)
  const [done, setDone] = useState(0)
  const [picked, setPicked] = useState<ReadonlySet<ItemOption>>(new Set())
  const [restarts, setRestarts] = useState(0)
  const shownAt = useRef(0)
  // A new order each time, so an answer is not remembered by its position.
  const options = useMemo(() => (item?.options ? shuffled(item.options) : null), [item])
  const rightCount = options?.filter((option) => picked.has(option) === option.correct).length ?? 0
  const toggle = (option: ItemOption) => {
    const next = new Set(picked)
    if (!next.delete(option)) next.add(option)
    setPicked(next)
  }
  const isQuestion = kind === 'question' || item?.kind === 'question'
  const easyDone = mode === 'easy' && done >= EASY_DECK_SIZE
  const cursorKey = `studyapp.all.${kind === 'question' ? 'questions.' : ''}${courseId}.${chapterId ?? 'whole'}`

  useEffect(() => {
    if (easyDone) {
      setItem(null)
      return
    }
    let current = true
    const afterPosition = mode === 'all' ? readCursor(cursorKey) : undefined
    void window.api.nextItem({ courseId, mode, kind, chapterId, moreNew, afterPosition }).then((next) => {
      if (!current) return
      shownAt.current = performance.now()
      setItem(next)
      setRevealed(false)
      setAnswer('')
      setPicked(new Set())
    })
    return () => {
      current = false
    }
  }, [courseId, mode, kind, chapterId, moreNew, done, easyDone, cursorKey, restarts])

  const rate = async (rating: ReviewRating) => {
    if (!item) return
    await ensureSession()
    await window.api.review({ itemId: item.id, rating, answer: answer || undefined, thinkingMs: performance.now() - shownAt.current })
    if (mode === 'all') writeCursor(cursorKey, item.position)
    answered()
    setDone((count) => count + 1)
  }

  const ratings: { rating: ReviewRating; label: string }[] =
    item?.kind === 'question'
      ? [
          { rating: 1, label: 'Not yet' },
          { rating: 2, label: 'Partly' },
          { rating: 3, label: 'Got it' },
        ]
      : [
          { rating: 1, label: 'Again' },
          { rating: 2, label: 'Hard' },
          { rating: 3, label: 'Good' },
          { rating: 4, label: 'Easy' },
        ]

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {})
  keyHandler.current = (event) => {
    if (!item || event.metaKey || event.ctrlKey) return
    const typing = event.target instanceof HTMLElement && /^(TEXTAREA|INPUT|SELECT)$/.test(event.target.tagName)
    if (typing) return
    const confirm = event.key === ' ' || event.key === 'Enter'
    if (options) {
      // Space on a focused statement ticks it; the browser already does that.
      if (confirm && event.target instanceof Element && event.target.closest('.choice')) return
      if (!revealed && options[Number(event.key) - 1]) toggle(options[Number(event.key) - 1])
      if (confirm) {
        event.preventDefault()
        if (revealed) void rate(rightCount === options.length ? 3 : 1)
        else setRevealed(true)
      }
      return
    }
    if (!revealed && confirm) {
      event.preventDefault()
      setRevealed(true)
    } else if (revealed && ratings.some(({ rating }) => String(rating) === event.key)) {
      void rate(Number(event.key) as ReviewRating)
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (item === undefined) return null

  if (item === null) {
    return (
      <div className="deck">
        <p className="deck-front">
          {mode === 'all' ? (kind === 'question' ? 'That was every open question.' : 'That was every card.') : mode === 'easy' ? (easyDone ? 'That was ten. Nicely kept going.' : 'No easy cards yet. Practise a few first and they will show up here.')
            : mode === 'mistakes' ? 'Nothing on your Fehlerliste is ready right now.'
            : 'You have done everything ready in this deck.'}
        </p>
        {done > 0 && <p>{done} done just now.</p>}
        {mode === 'all' && (
          <div className="row">
            <button
              className="button"
              onClick={() => {
                writeCursor(cursorKey, 0)
                setDone(0)
                setRestarts((count) => count + 1)
              }}
            >
              Start over
            </button>
          </div>
        )}
        {mode === 'review' && !moreNew && (
          <div className="row">
            <button className="button" onClick={() => setMoreNew(true)}>
              Keep going with new {kind === 'question' ? 'questions' : 'cards'}
            </button>
          </div>
        )}
      </div>
    )
  }

  const note = item.status && STATUS_NOTE[item.status]
  if (options) {
    return (
      <div className="deck">
        <p className="deck-meta" lang="de">{itemMeta(item)}</p>
        <div className="deck-front">
          <Prose markdown={item.front} courseId={courseId} />
        </div>
        {!revealed && <p>Tick every statement you think is correct.</p>}
        <ChoiceList options={options} picked={picked} toggle={toggle} revealed={revealed} courseId={courseId} />
        <div className="row">
          {revealed ? (
            <>
              <p className="choice-score">{rightCount} of {options.length} judged right.</p>
              <button className="button sunny" onClick={() => void rate(rightCount === options.length ? 3 : 1)}>
                Next<kbd>space</kbd>
              </button>
            </>
          ) : (
            <button className="button sunny" onClick={() => setRevealed(true)}>
              Check<kbd>space</kbd>
            </button>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="deck">
      <p className="deck-meta" lang="de">{itemMeta(item)}</p>
      <div className="deck-front">
        <Prose markdown={item.front} courseId={courseId} />
      </div>
      {isQuestion && !revealed && (
        <label className="task-field" style={{ width: '100%' }}>
          Answer on paper first, then type it here if you like.
          <textarea lang="de" value={answer} onChange={(event) => setAnswer(event.target.value)} />
        </label>
      )}
      {!revealed ? (
        <div className="row">
          <button className="button sunny" onClick={() => setRevealed(true)}>
            Show answer<kbd>space</kbd>
          </button>
        </div>
      ) : (
        <>
          {answer.trim() && <p className="your-answer" lang="de">{answer}</p>}
          <div className="deck-back">
            {note && <p className="deck-note">{note}</p>}
            <Prose markdown={item.back || 'Für diese Frage steht keine Musterlösung im Lernskript.'} courseId={courseId} />
          </div>
          <div className="row">
            {ratings.map(({ rating, label }) => (
              <button key={rating} className="button" onClick={() => void rate(rating)}>
                {label}<kbd>{rating}</kbd>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Reader({ courseId, chapters, chapterId, setChapterId }: { courseId: number; chapters: ChapterRow[]; chapterId: number | null; setChapterId: (id: number) => void }) {
  const [body, setBody] = useState('')
  const textRef = useRef<HTMLDivElement>(null)
  const shown = (chapters.some((chapter) => chapter.id === chapterId) ? chapterId : null) ?? chapters.find((chapter) => chapter.number !== null)?.id ?? chapters[0]?.id ?? null

  useEffect(() => {
    if (shown === null) return
    void window.api.chapterBody(shown).then((text) => {
      setBody(text)
      textRef.current?.scrollTo(0, 0)
    })
  }, [shown])

  return (
    <div className="reader">
      <ul className="reader-chapters" lang="de">
        {chapters.map((chapter) => (
          <li key={chapter.id}>
            <button aria-current={chapter.id === shown} onClick={() => setChapterId(chapter.id)}>
              {chapter.number !== null && `${chapter.number}. `}
              {chapter.title}
            </button>
          </li>
        ))}
      </ul>
      <div className="reader-text" ref={textRef}>
        {shown !== null && <h1 lang="de">{chapters.find((chapter) => chapter.id === shown)?.title}</h1>}
        <Prose markdown={body} courseId={courseId} />
      </div>
    </div>
  )
}

interface WorkspaceProps {
  snapshot: Snapshot
  place: StudyPlace
  courses: CourseRow[]
  setPlace: (place: StudyPlace) => void
  refreshCourses: () => void
  close: () => void
}

const TABS: { tab: StudyTab; label: string }[] = [
  { tab: 'cards', label: 'Cards' },
  { tab: 'all', label: 'All cards' },
  { tab: 'questions', label: 'Open questions' },
  { tab: 'allQuestions', label: 'All open questions' },
  { tab: 'mistakes', label: 'Fehlerliste' },
  { tab: 'read', label: 'Read' },
]

export function Workspace({ snapshot, place, courses, setPlace, refreshCourses, close }: WorkspaceProps) {
  const { session } = snapshot
  const { courseId, tab } = place
  // Remembers which course the list belongs to, so another course's chapters are never shown for a moment.
  const [chapterList, setChapterList] = useState<{ courseId: number; rows: ChapterRow[] } | null>(null)
  const chapters = chapterList?.courseId === courseId ? chapterList.rows : []
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [dipOpen, setDipOpen] = useState(false)
  const [resets, setResets] = useState(0)
  const course = courses.find((row) => row.id === courseId)
  const plant = snapshot.plants.find((row) => row.isCurrent)

  useEffect(() => {
    void window.api.chapters(courseId).then((rows) => setChapterList({ courseId, rows }))
    setChapterId(null)
  }, [courseId])

  // Practising is studying, so a session starts by itself with the first answer.
  const ensureSession = async () => {
    if (!snapshot.session) await window.api.start(course?.name ?? '')
  }
  const blockMs = session ? session.settings.blockMinutes * 60_000 : 0
  const paused = session?.phase === 'paused'

  return (
    <main className="workspace">
      <header className="workspace-bar">
        {session && plant && (
          <PlantView className="workspace-plant" plantId={plant.id} genome={plant.genome} growth={plant.growth} pot={plant.pot} leaves={plant.leaves} />
        )}
        {session && plant && <PlantStage growth={plant.growth} compact />}
        {session && <span className="workspace-clock" role="timer">{clock(blockMs - session.blockFocusMs)}</span>}
        {session && <span>{sun(session.earnedSun)} this session</span>}
        <span className="workspace-spacer" />
        {session && (
          <button
            className="button"
            onClick={() => {
              void window.api.dip()
              setDipOpen(true)
            }}
          >
            I'm losing steam
          </button>
        )}
        {session && (
          <button className="button quiet" onClick={() => void (paused ? window.api.resume() : window.api.pause())}>
            {paused ? 'Continue' : 'Pause'}
          </button>
        )}
        {session && (
          <button className="button quiet" onClick={() => void window.api.end()}>
            Done for now
          </button>
        )}
        <button className="button quiet" onClick={close}>
          {session ? 'Back to timer' : 'Back'}
        </button>
      </header>
      {dipOpen && session && (
        <div className="workspace-dip">
          <DipPanel
            session={session}
            topics={snapshot.calendar.topics.filter((topic) => topic.completedAt === null).map((topic) => topic.name)}
            close={() => setDipOpen(false)}
            easyCards={() => setPlace({ courseId, tab: 'easy' })}
          />
        </div>
      )}
      <nav className="workspace-nav" aria-label="Study">
        {courses.length > 1 && (
          <select aria-label="Course" lang="de" value={courseId} onChange={(event) => setPlace({ courseId: Number(event.target.value), tab })}>
            {courses.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        )}
        {TABS.map((entry) => (
          <button key={entry.tab} className="tab" aria-current={tab === entry.tab} onClick={() => setPlace({ courseId, tab: entry.tab })}>
            {entry.label}
            {entry.tab === 'cards' && course ? ` (${course.cardsReady})` : ''}
            {entry.tab === 'questions' && course ? ` (${course.questionsReady})` : ''}
            {entry.tab === 'mistakes' && course ? ` (${course.mistakes})` : ''}
          </button>
        ))}
        {(tab === 'cards' || tab === 'all' || tab === 'questions' || tab === 'allQuestions') && (
          <select
            aria-label="Chapter"
            lang="de"
            value={chapterId ?? ''}
            onChange={(event) => setChapterId(Number(event.target.value) || null)}
          >
            <option value="">All chapters</option>
            {chapters
              .filter((chapter) => chapter.number !== null)
              .map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.number}. {chapter.title}
                </option>
              ))}
          </select>
        )}
      </nav>
      {course && (
        <div className="workspace-reset">
          <ResetProgress
            course={course}
            done={() => {
              refreshCourses()
              setResets((count) => count + 1)
            }}
          />
        </div>
      )}
      <div className="workspace-body">
        {tab === 'read' ? (
          <Reader key={courseId} courseId={courseId} chapters={chapters} chapterId={chapterId} setChapterId={setChapterId} />
        ) : (
          <Deck
            key={`${courseId}-${tab}-${resets}`}
            courseId={courseId}
            mode={tab === 'mistakes' ? 'mistakes' : tab === 'easy' ? 'easy' : tab === 'all' || tab === 'allQuestions' ? 'all' : 'review'}
            kind={tab === 'cards' || tab === 'easy' || tab === 'all' ? 'card' : tab === 'questions' || tab === 'allQuestions' ? 'question' : undefined}
            chapterId={chapterId}
            ensureSession={ensureSession}
            answered={refreshCourses}
          />
        )}
      </div>
    </main>
  )
}
