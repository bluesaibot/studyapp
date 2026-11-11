import { useCallback, useEffect, useRef, useState } from 'react'
import { clockTime, courseOver } from '../../core/calendar'
import { speciesById, stageIndex, STAGES } from '../../core/plants'
import { POT_DESIGNS } from '../../core/pots'
import { localDate } from '../../core/streak'
import type { SessionState } from '../../core/session'
import type { Todo } from '../../core/calendar'
import type { PlantRow, Snapshot } from '../../shared/api'
import type { CourseRow } from '../../shared/study'
import { Briefing, CalendarPage, SpentPrompt } from './Calendar'
import { fundEffect, fundTitle, Garden } from './Garden'
import { Library } from './Library'
import { PlantStage, PlantView, Pot } from './PlantView'
import { WeekPage, WeekPanel, weekLine } from './Week'
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
        <PlantView key={plant.id} plantId={plant.id} genome={plant.genome} growth={plant.growth} pot={plant.pot} leaves={plant.leaves} closed={plant.flowersClosed} pods={plant.pods} />
      ) : (
        <svg viewBox="0 0 400 500" role="img" aria-label="Empty pot, your first seed goes in when you first study">
          <Pot design={POT_DESIGNS[0]} />
        </svg>
      )}
      {plant && (
        <div className="stage-caption">
          <PlantStage growth={plant.growth} />
        </div>
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

/** Sessions always belong to one of your topics, or to nothing in particular. */
function TopicChoice({ topics, value, onChange }: { topics: readonly string[]; value: string; onChange: (topic: string) => void }) {
  const options = value && !topics.includes(value) ? [value, ...topics] : topics
  return (
    <select lang="de" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((topic) => (
        <option key={topic} value={topic}>
          {topic}
        </option>
      ))}
      <option value="">No topic</option>
    </select>
  )
}

/** Open todos of the picked topic, or the ones without a topic for "No topic". */
function todosFor(snapshot: Snapshot, topic: string): Todo[] {
  const names = snapshot.calendar.topics.map((row) => row.name.toLowerCase())
  // A session label like "Study time" is no topic of yours, so it offers the todos without one.
  const wanted = names.includes(topic.toLowerCase()) ? topic.toLowerCase() : ''
  return snapshot.calendar.todos.filter((todo) => {
    if (todo.doneAt !== null) return false
    const own = todo.topic?.toLowerCase() ?? ''
    return wanted ? own === wanted : !own || !names.includes(own)
  })
}

/** The todo inside the topic, if it is about one thing in particular. Its time then counts for that todo. */
function TodoChoice({ todos, value, onChange }: { todos: readonly Todo[]; value: number | null; onChange: (todoId: number | null) => void }) {
  return (
    <select lang="de" aria-label="Todo" value={value ?? ''} disabled={todos.length === 0} onChange={(event) => onChange(Number(event.target.value) || null)}>
      <option value="">{todos.length === 0 ? 'No open todos' : 'No todo in particular'}</option>
      {todos.map((todo) => (
        <option key={todo.id} value={todo.id}>
          {todo.title}
        </option>
      ))}
    </select>
  )
}

/** The topic and its todo side by side, so a session can be booked on exactly what it was spent on. */
function WorkChoice({ snapshot, topics, topic, todoId, onChange }: { snapshot: Snapshot; topics: readonly string[]; topic: string; todoId: number | null; onChange: (topic: string, todoId: number | null) => void }) {
  const todos = todosFor(snapshot, topic)
  const todo = todos.some((row) => row.id === todoId) ? todoId : null
  return (
    <span className="work-choice">
      <TopicChoice topics={topics} value={topic} onChange={(next) => onChange(next, null)} />
      <TodoChoice todos={todos} value={todo} onChange={(next) => onChange(topic, next)} />
    </span>
  )
}

function Home({ snapshot, openGarden, openLibrary, openWeek, openCalendar, openTopics: showTopics, courses }: { snapshot: Snapshot; openGarden: () => void; openLibrary: () => void; openWeek: () => void; openCalendar: () => void; openTopics: () => void; courses: CourseRow[] }) {
  const now = new Date()
  const ready = courses
    .filter((course) => !courseOver(course.id, snapshot.calendar.events, localDate(now), clockTime(now)))
    .reduce((total, course) => total + course.cardsReady + course.questionsReady, 0)
  const openTopics = snapshot.calendar.topics.filter((topic) => topic.completedAt === null).map((topic) => topic.name)
  const [picked, setPicked] = useState(snapshot.lastTask)
  const [pickedTodo, setPickedTodo] = useState<number | null>(snapshot.lastTodoId)
  // Last time's topic if it is still open, otherwise the first one that is.
  const task = openTopics.includes(picked) || picked === '' ? picked : (openTopics[0] ?? '')
  const todoId = todosFor(snapshot, task).some((todo) => todo.id === pickedTodo) ? pickedTodo : null
  return (
    <main className="home">
      <section className="home-left">
        <button className="sun-button" onClick={() => void window.api.start(task || 'Study time', todoId)}>
          Study now
        </button>
        <p className="home-promise">Just 5 minutes. Then decide again.</p>
        <label className="task-field">
          What are you working on?
          <WorkChoice
            snapshot={snapshot}
            topics={openTopics}
            topic={task}
            todoId={todoId}
            onChange={(topic, todo) => {
              setPicked(topic)
              setPickedTodo(todo)
            }}
          />
        </label>
        {openTopics.length === 0 && (
          <button className="link" onClick={openCalendar}>
            Add your topics in the calendar
          </button>
        )}
        <Briefing snapshot={snapshot} courses={courses} />
        <div className="home-facts">
          <p>{streakLine(snapshot)}</p>
          {snapshot.todayFocusMs >= 60_000 && <p>{duration(snapshot.todayFocusMs)} studied today.</p>}
          {snapshot.wallet >= 1 && <p>{sun(snapshot.wallet)} for the garden.</p>}
          {ready > 0 && <p>{ready} cards and questions ready in your library.</p>}
          <p>{weekLine(snapshot.week)}</p>
          {snapshot.funds.length > 0 && <p>{snapshot.funds.length} {snapshot.funds.length === 1 ? 'find is' : 'finds are'} waiting in the garden.</p>}
        </div>
        <div className="row">
          <button className="button quiet" onClick={showTopics}>
            Topics
          </button>
          <button className="button quiet" onClick={openCalendar}>
            Calendar
          </button>
          <button className="button quiet" onClick={openWeek}>
            This week
          </button>
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

export function DipPanel({ snapshot, session, topics, close, easyCards }: { snapshot: Snapshot; session: SessionState; topics: readonly string[]; close: () => void; easyCards?: () => void }) {
  const [changing, setChanging] = useState(false)
  if (changing) {
    return (
      <div className="dip-panel">
        <label className="task-field">
          What will you do instead?
          <WorkChoice snapshot={snapshot} topics={topics} topic={session.task} todoId={session.todoId ?? null} onChange={(topic, todo) => void window.api.setTask(topic, todo)} />
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
        {todoTitle(snapshot, session.todoId) && (
          <p className="session-todo" lang="de">
            {todoTitle(snapshot, session.todoId)}
          </p>
        )}
        <p className="session-time" role="timer">
          {clock(blockMs - session.blockFocusMs)}
        </p>
        <p className="session-goal">{goalLine(session, miniGoalDone)}</p>
        <p className="session-earned">
          {sun(session.earnedSun)} this session, {duration(snapshot.todayFocusMs)} today
        </p>
        {dipOpen ? (
          <DipPanel
            snapshot={snapshot}
            session={session}
            topics={snapshot.calendar.topics.filter((topic) => topic.completedAt === null).map((topic) => topic.name)}
            close={() => setDipOpen(false)}
            easyCards={course ? () => openStudy('easy') : undefined}
          />
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
            <button className="button quiet" onClick={() => openStudy('allQuestions')}>
              All open questions ({course.questions})
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
  const [showWeek, setShowWeek] = useState(false)
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
          <button className="button quiet" onClick={() => setShowWeek(!showWeek)}>
            {showWeek ? 'Garden' : 'This week'}
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
      {showWeek ? <div className="break-week"><WeekPanel week={snapshot.week} /></div> : <Garden snapshot={snapshot} />}
    </main>
  )
}

function todoTitle(snapshot: Snapshot, todoId: number | null | undefined): string | null {
  return snapshot.calendar.todos.find((todo) => todo.id === todoId)?.title ?? null
}

/** After a session on a todo, it can be ticked off right here, with the time it took. */
function FinishTodo({ todo }: { todo: Todo }) {
  const [asking, setAsking] = useState(false)
  if (asking) return <SpentPrompt todo={todo} close={() => setAsking(false)} />
  return (
    <p>
      <button className="link" onClick={() => setAsking(true)}>
        <span lang="de">{todo.title}</span> is finished
      </button>
    </p>
  )
}

function SummaryScreen({ snapshot }: { snapshot: Snapshot }) {
  const summary = snapshot.summary!
  const todo = snapshot.calendar.todos.find((row) => row.id === summary.todoId && row.doneAt === null)
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
        {todo && <FinishTodo todo={todo} />}
        {summary.funds.length > 0 && (
          <ul className="summary-funds">
            {summary.funds.map((fund) => (
              <li key={fund.seed}>{fundTitle(fund)}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="button sunny" onClick={() => void window.api.start(summary.task, todo?.id ?? null)}>
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

const LEVEL_UP_MS = 6000

/** Notices when any plant reaches a new stage, whichever screen caused it. Nothing shows on launch. */
function useLevelUp(plants: readonly PlantRow[] | undefined): string | null {
  const known = useRef<Map<number, number> | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!plants) return
    const stages = new Map(plants.map((plant) => [plant.id, stageIndex(plant.growth)]))
    const risen = known.current && plants.find((plant) => (known.current!.get(plant.id) ?? 0) < stages.get(plant.id)! && known.current!.has(plant.id))
    known.current = stages
    if (!risen) return
    const name = risen.name ?? speciesById(risen.genome.species).name
    setMessage(`${name} is now: ${STAGES[stages.get(risen.id)!].name}`)
  }, [plants])

  useEffect(() => {
    if (!message) return
    const hide = setTimeout(() => setMessage(null), LEVEL_UP_MS)
    return () => clearTimeout(hide)
  }, [message])

  return message
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
  const [view, setView] = useState<'home' | 'garden' | 'library' | 'week' | 'calendar' | 'topics'>('home')
  const [place, setPlace] = useState<StudyPlace | null>(null)
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [courseId, setCourseId] = useState<number | null>(rememberedCourse)
  const previousPhase = useRef<string | undefined>(undefined)
  const levelUp = useLevelUp(snapshot?.plants)

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
  const now = new Date()
  const current = courses.find((row) => !courseOver(row.id, snapshot.calendar.events, localDate(now), clockTime(now)))
  const course = courses.find((row) => row.id === courseId) ?? current ?? courses[0] ?? null

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
      {levelUp && (
        <div className="level-up" role="status">
          {levelUp}
        </div>
      )}
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
            <h1>Your plants</h1>
            <button className="button quiet" onClick={() => setView('home')}>
              Back
            </button>
          </header>
          <Garden snapshot={snapshot} />
        </main>
      )}
      {!session && !summary && !place && (view === 'calendar' || view === 'topics') && (
        <CalendarPage key={view} snapshot={snapshot} courses={courses} startOn={view} close={() => setView('home')} />
      )}
      {!session && !summary && !place && view === 'week' && <WeekPage week={snapshot.week} close={() => setView('home')} />}
      {!session && !summary && !place && view === 'library' && (
        <Library courses={courses} events={snapshot.calendar.events} refresh={refreshCourses} open={openStudy} close={() => setView('home')} />
      )}
      {!session && !summary && !place && view === 'home' && (
        <Home snapshot={snapshot} courses={courses} openGarden={() => setView('garden')} openLibrary={() => setView('library')} openWeek={() => setView('week')} openCalendar={() => setView('calendar')} openTopics={() => setView('topics')} />
      )}
      {session && !onBreak && !place && view === 'library' && (
        <div className="library-over">
          <Library courses={courses} events={snapshot.calendar.events} refresh={refreshCourses} open={openStudy} close={() => setView('home')} />
        </div>
      )}
    </>
  )
}
