import { useCallback, useEffect, useRef, useState } from 'react'
import { POT_COLORS } from '../../core/plants'
import type { SessionState } from '../../core/session'
import type { PlantRow, Snapshot } from '../../shared/api'
import type { CourseRow } from '../../shared/study'
import { fundEffect, fundTitle, Garden } from './Garden'
import { Library } from './Library'
import { PlantView, Pot } from './PlantView'
import { Workspace, type StudyPlace, type StudyTab } from './Workspace'
import { clock, duration, sun, useSnapshot } from './useSnapshot'

function playChime() {
  const context = new AudioContext()
  ;[523.25, 659.25, 783.99].forEach((frequency, i) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + i * 0.22
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.16, start + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 1.2)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + 1.3)
  })
}

function streakLine({ streak }: Snapshot): string {
  const percent = Math.round((streak.sessionMultiplier - 1) * 100)
  if (streak.comeback) return `Good to see you back. Your next session keeps its +${percent}% sun.`
  if (streak.runDays === 0) return `Your first session gets +${percent}% sun.`
  const days = streak.runDays === 1 ? '1 study day' : `${streak.runDays} study days`
  return `${days} in a row, +${percent}% sun.`
}

function currentPlant(snapshot: Snapshot): PlantRow | undefined {
  return snapshot.plants.find((plant) => plant.isCurrent) ?? snapshot.plants[snapshot.plants.length - 1]
}

function ShelfPlant({ snapshot }: { snapshot: Snapshot }) {
  const plant = currentPlant(snapshot)
  return (
    <div className="stage-plant">
      {plant ? (
        <PlantView key={plant.id} plantId={plant.id} genome={plant.genome} growth={plant.growth} pot={plant.pot} />
      ) : (
        <svg viewBox="0 0 400 500" role="img" aria-label="Empty pot, your first seed goes in when you first study">
          <Pot color={POT_COLORS[0]} />
        </svg>
      )}
    </div>
  )
}

function SettingsForm({ snapshot }: { snapshot: Snapshot }) {
  const { settings } = snapshot
  const field = (label: string, key: 'blockMinutes' | 'breakMinutes' | 'longBreakMinutes') => (
    <label>
      {label}
      <input
        type="number"
        min={1}
        max={180}
        defaultValue={settings[key]}
        onBlur={(event) => {
          const value = Number(event.target.value)
          if (value >= 1) void window.api.setSettings({ ...settings, [key]: value })
        }}
      />
    </label>
  )
  return (
    <details className="settings">
      <summary>Change times</summary>
      <div className="settings-fields">
        {field('Study block (min)', 'blockMinutes')}
        {field('Break (min)', 'breakMinutes')}
        {field('Long break (min)', 'longBreakMinutes')}
      </div>
    </details>
  )
}

function Home({ snapshot, openGarden, openLibrary, courses }: { snapshot: Snapshot; openGarden: () => void; openLibrary: () => void; courses: CourseRow[] }) {
  const ready = courses.reduce((total, course) => total + course.cardsReady + course.questionsReady, 0)
  const [task, setTask] = useState(snapshot.lastTask)
  return (
    <main className="home">
      <section className="home-left">
        <button className="sun-button" onClick={() => void window.api.start(task)}>
          Study now
        </button>
        <p className="home-promise">Just 5 minutes. Then decide again.</p>
        <label className="task-field">
          What are you working on?
          <input value={task} placeholder="for example Cell Biology, chapter 6" onChange={(event) => setTask(event.target.value)} />
        </label>
        <div className="home-facts">
          <p>{streakLine(snapshot)}</p>
          {snapshot.todayFocusMs >= 60_000 && <p>{duration(snapshot.todayFocusMs)} studied today.</p>}
          {snapshot.wallet >= 1 && <p>{sun(snapshot.wallet)} for the garden.</p>}
          {ready > 0 && <p>{ready} cards and questions ready in your library.</p>}
        </div>
        <div className="row">
          <button className="button quiet" onClick={openLibrary}>
            Open library
          </button>
          <button className="button quiet" onClick={openGarden}>
            Open garden
          </button>
        </div>
        <SettingsForm snapshot={snapshot} />
      </section>
      <ShelfPlant snapshot={snapshot} />
    </main>
  )
}

export function DipPanel({ session, close, easyCards }: { session: SessionState; close: () => void; easyCards?: () => void }) {
  const [changing, setChanging] = useState(false)
  if (changing) {
    return (
      <div className="dip-panel">
        <label className="task-field">
          What will you do instead?
          <input autoFocus defaultValue={session.task} onChange={(event) => void window.api.setTask(event.target.value)} />
        </label>
        <button className="button" onClick={close}>
          Continue with this
        </button>
      </div>
    )
  }
  return (
    <div className="dip-panel">
      <p>Good catch, that earns 3 ☀. What would help right now?</p>
      <div className="row">
        <button
          className="button"
          onClick={() => {
            void window.api.miniGoal()
            close()
          }}
        >
          Just 10 more minutes
        </button>
        {easyCards && (
          <button
            className="button"
            onClick={() => {
              easyCards()
              close()
            }}
          >
            10 easy cards
          </button>
        )}
        <button className="button" onClick={() => setChanging(true)}>
          Switch topic
        </button>
        <button
          className="button"
          onClick={() => {
            void window.api.takeBreak()
            close()
          }}
        >
          5 minutes in the garden
        </button>
      </div>
      <button className="link" onClick={close}>
        I'm fine again
      </button>
    </div>
  )
}

function goalLine(session: SessionState, miniGoalDone: boolean): string {
  if (session.phase === 'paused') return 'Paused. The timer waits until you continue.'
  if (session.miniGoalAtMs !== null) {
    return `Mini goal: ${clock(session.miniGoalAtMs - session.focusMs)} left`
  }
  if (miniGoalDone) return '10 minutes done. Stopping is fine now, and so is carrying on.'
  if (!session.firstGoalReached) return `First goal: ${clock(5 * 60_000 - session.focusMs)} left`
  return session.completedBlocks === 0
    ? '5 minutes done, today counts. The timer just keeps going.'
    : `${session.completedBlocks} ${session.completedBlocks === 1 ? 'block' : 'blocks'} done.`
}

interface SessionScreenProps {
  snapshot: Snapshot
  session: SessionState
  course: CourseRow | null
  openStudy: (tab: StudyTab) => void
  openLibrary: () => void
}

function SessionScreen({ snapshot, session, course, openStudy, openLibrary }: SessionScreenProps) {
  const [dipOpen, setDipOpen] = useState(false)
  const [miniGoalDone, setMiniGoalDone] = useState(false)
  const hadMiniGoal = useRef(false)

  useEffect(() => {
    if (session.miniGoalAtMs !== null) {
      hadMiniGoal.current = true
      setMiniGoalDone(false)
    } else if (hadMiniGoal.current) {
      hadMiniGoal.current = false
      setMiniGoalDone(true)
    }
  }, [session.miniGoalAtMs])

  const blockMs = session.settings.blockMinutes * 60_000
  const progress = Math.min(1, session.blockFocusMs / blockMs)
  const paused = session.phase === 'paused'

  return (
    <main className="session">
      <div
        className="sky-sun"
        aria-hidden="true"
        style={{
          left: `${6 + progress * 88}%`,
          top: `${14 + (1 - Math.sin(progress * Math.PI)) * 62}px`,
        }}
      />
      <section className="session-left">
        <p className="session-task">{session.task || 'Study time'}</p>
        <p className="session-time" role="timer">
          {clock(blockMs - session.blockFocusMs)}
        </p>
        <p className="session-goal">{goalLine(session, miniGoalDone)}</p>
        <p className="session-earned">
          {sun(session.earnedSun)} this session, {duration(snapshot.todayFocusMs)} today
        </p>
        {dipOpen ? (
          <DipPanel session={session} close={() => setDipOpen(false)} easyCards={course ? () => openStudy('easy') : undefined} />
        ) : (
          <div className="row">
            <button
              className="button"
              onClick={() => {
                void window.api.dip()
                setDipOpen(true)
              }}
            >
              I'm losing steam
            </button>
            <button className="button quiet" onClick={() => void (paused ? window.api.resume() : window.api.pause())}>
              {paused ? 'Continue' : 'Pause'}
            </button>
            <button className="button quiet" onClick={() => void window.api.end()}>
              Done for now
            </button>
          </div>
        )}
        {course ? (
          <div className="row">
            <button className="button quiet" onClick={() => openStudy('cards')}>
              Cards ({course.cardsReady} ready)
            </button>
            <button className="button quiet" onClick={() => openStudy('all')}>
              All cards ({course.cards})
            </button>
            <button className="button quiet" onClick={() => openStudy('questions')}>
              Open questions ({course.questionsReady} ready)
            </button>
            <button className="button quiet" onClick={() => openStudy('read')}>
              Read Lernskript
            </button>
          </div>
        ) : (
          <button className="link" onClick={openLibrary}>
            Add a Lernskript to study from here
          </button>
        )}
      </section>
      <ShelfPlant snapshot={snapshot} />
    </main>
  )
}

function BreakScreen({ snapshot, session }: { snapshot: Snapshot; session: SessionState }) {
  const over = session.phase === 'breakOver'
  const latestFund = session.funds[session.funds.length - 1]
  const showFund = latestFund && session.blockFocusMs === 0
  return (
    <main className="break">
      <header className="break-head">
        <div>
          <h1>{over ? 'Break is over' : `Break, ${clock(session.breakRemainingMs)} left`}</h1>
          <p>
            {over
              ? 'Carry on whenever you are ready.'
              : 'Time for the garden. Coming back on time earns 3 ☀.'}
          </p>
        </div>
        <div className="row">
          <button className="button sunny" onClick={() => void window.api.returnFromBreak()}>
            Keep studying
          </button>
          <button className="button quiet" onClick={() => void window.api.end()}>
            Done for now
          </button>
        </div>
      </header>
      {showFund && (
        <div className="fund-reveal" role="status">
          <strong>Find: {fundTitle(latestFund)}</strong>
          <span>{fundEffect(latestFund)}</span>
        </div>
      )}
      <Garden snapshot={snapshot} />
    </main>
  )
}

function SummaryScreen({ snapshot }: { snapshot: Snapshot }) {
  const summary = snapshot.summary!
  return (
    <main className="summary">
      <ShelfPlant snapshot={snapshot} />
      <section>
        <h1>{summary.focusMs < 60_000 ? 'A quick round' : `${duration(summary.focusMs)} studied`}</h1>
        <p>
          {sun(summary.earnedSun)} earned
          {summary.blocks > 0 && `, ${summary.blocks} ${summary.blocks === 1 ? 'block' : 'blocks'} done`}.
        </p>
        {summary.cardsReviewed + summary.questionsAnswered > 0 && (
          <p>
            {summary.cardsReviewed > 0 && `${summary.cardsReviewed} ${summary.cardsReviewed === 1 ? 'card' : 'cards'}`}
            {summary.cardsReviewed > 0 && summary.questionsAnswered > 0 && ' and '}
            {summary.questionsAnswered > 0 && `${summary.questionsAnswered} ${summary.questionsAnswered === 1 ? 'question' : 'questions'}`} practised.
          </p>
        )}
        {summary.funds.length > 0 && (
          <ul className="summary-funds">
            {summary.funds.map((fund) => (
              <li key={fund.seed}>{fundTitle(fund)}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="button sunny" onClick={() => void window.api.start(summary.task)}>
            One more round
          </button>
          <button className="button quiet" onClick={() => void window.api.dismissSummary()}>
            Done
          </button>
        </div>
      </section>
    </main>
  )
}

const COURSE_KEY = 'studyapp.course'

function rememberedCourse(): number | null {
  try {
    return Number(localStorage.getItem(COURSE_KEY)) || null
  } catch {
    return null
  }
}

export function App() {
  const snapshot = useSnapshot()
  const [view, setView] = useState<'home' | 'garden' | 'library'>('home')
  const [place, setPlace] = useState<StudyPlace | null>(null)
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [courseId, setCourseId] = useState<number | null>(rememberedCourse)
  const previousPhase = useRef<string | undefined>(undefined)

  const refreshCourses = useCallback(() => void window.api.courses().then(setCourses), [])
  useEffect(refreshCourses, [refreshCourses, view, place === null])

  const phase = snapshot?.session?.phase
  const inSession = Boolean(snapshot?.session)
  useEffect(() => {
    if (phase === 'breakOver' && previousPhase.current === 'break') playChime()
    previousPhase.current = phase
  }, [phase])

  // A finished session always lands on its summary, then on the home screen.
  const wasInSession = useRef(inSession)
  useEffect(() => {
    if (wasInSession.current && !inSession) {
      setPlace(null)
      setView('home')
    }
    wasInSession.current = inSession
  }, [inSession])

  if (!snapshot) return null
  const { session, summary } = snapshot
  const onBreak = session?.phase === 'break' || session?.phase === 'breakOver'
  const course = courses.find((row) => row.id === courseId) ?? courses[0] ?? null

  const openStudy = (id: number, tab: StudyTab) => {
    setCourseId(id)
    try {
      localStorage.setItem(COURSE_KEY, String(id))
    } catch {
      // Remembering the course is only a convenience.
    }
    setPlace({ courseId: id, tab })
  }

  return (
    <>
      {session && onBreak && <BreakScreen snapshot={snapshot} session={session} />}
      {place && (
        // Stays mounted during a break, so a half-written answer is still there afterwards.
        <div className="workspace-holder" hidden={onBreak}>
          <Workspace
            snapshot={snapshot}
            place={place}
            courses={courses}
            setPlace={(next) => openStudy(next.courseId, next.tab)}
            refreshCourses={refreshCourses}
            close={() => {
              setPlace(null)
              // During a session, back always means the timer. Outside one, it returns to where you came from.
              if (session) setView('home')
            }}
          />
        </div>
      )}
      {session && !onBreak && !place && (
        <SessionScreen
          snapshot={snapshot}
          session={session}
          course={course}
          openStudy={(tab) => course && openStudy(course.id, tab)}
          openLibrary={() => setView('library')}
        />
      )}
      {!session && summary && <SummaryScreen snapshot={snapshot} />}
      {!session && !summary && !place && view === 'garden' && (
        <main className="garden-page">
          <header className="break-head">
            <h1>Garden</h1>
            <button className="button quiet" onClick={() => setView('home')}>
              Back
            </button>
          </header>
          <Garden snapshot={snapshot} />
        </main>
      )}
      {!session && !summary && !place && view === 'library' && (
        <Library courses={courses} refresh={refreshCourses} open={openStudy} close={() => setView('home')} />
      )}
      {!session && !summary && !place && view === 'home' && (
        <Home snapshot={snapshot} courses={courses} openGarden={() => setView('garden')} openLibrary={() => setView('library')} />
      )}
      {session && !onBreak && !place && view === 'library' && (
        <div className="library-over">
          <Library courses={courses} refresh={refreshCourses} open={openStudy} close={() => setView('home')} />
        </div>
      )}
    </>
  )
}
