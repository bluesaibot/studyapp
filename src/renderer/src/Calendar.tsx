import { useMemo, useState } from 'react'
import {
  buildBriefing,
  buildTimeTable,
  canEnterGrade,
  durationInput,
  parseDuration,
  type TimeGroup,
  clockTime,
  courseForTopic,
  daysBetween,
  effortText,
  examOver,
  GRADE_REWARDS,
  monthDays,
  paceText,
  parseEffort,
  whenText,
  type CalendarEvent,
  type CourseProgress,
  type EventKind,
  type FinishesWith,
  type Todo,
  type TopicView,
  workedText,
  TODO_LEVELS,
  TOPIC_LEVELS,
  type EffortLevel,
} from '../../core/calendar'
import { localDate } from '../../core/streak'
import type { Snapshot } from '../../shared/api'
import type { CourseRow } from '../../shared/study'
import { rewardText } from './Week'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function progress(courses: readonly CourseRow[]): CourseProgress[] {
  return courses.map((course) => ({
    id: course.id,
    name: course.name,
    fresh: course.cards + course.questions - course.reviewed,
    ready: course.cardsReady + course.questionsReady,
  }))
}

function shortDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

export function Briefing({ snapshot, courses }: { snapshot: Snapshot; courses: readonly CourseRow[] }) {
  const today = localDate(new Date())
  const items = buildBriefing(snapshot.calendar, progress(courses), today, clockTime(new Date()))
  if (items.length === 0) return null
  return (
    <section className="briefing" aria-label="Today">
      <h3>Today</h3>
      <ul>
        {items.map((item) => {
          const todo = item.todoId === undefined ? undefined : snapshot.calendar.todos.find((row) => row.id === item.todoId)
          return <li key={item.key}>{todo ? <TodoTick todo={todo} /> : <span lang="de">{item.text}</span>}</li>
        })}
      </ul>
    </section>
  )
}

/** Asks what an open todo really took, with the timer's count filled in. Skipping goes by the timer. */
export function SpentPrompt({ todo, close }: { todo: Todo; close: () => void }) {
  const tracked = Math.floor(todo.trackedMinutes ?? 0)
  const [text, setText] = useState(tracked > 0 ? durationInput(tracked) : '')
  const minutes = parseDuration(text)
  const finish = (spent: number | null) => {
    void window.api.finishTodo(todo.id, spent)
    close()
  }
  return (
    <form
      className="spent-prompt"
      onSubmit={(event) => {
        event.preventDefault()
        if (minutes !== null) finish(minutes)
      }}
    >
      <span>
        How long did <strong lang="de">{todo.title}</strong> really take?
      </span>
      <span className="hint">
        {todo.effort !== null ? `Planned ${workedText(Math.round(todo.effort * 60))}` : 'No plan set'}
        {tracked > 0 && `, timer counted ${workedText(tracked)}`}. Type 1:30, 1,5 or 90 min.
      </span>
      <span className="row">
        <input className="cal-effort" autoFocus aria-label={`Time spent on ${todo.title}`} placeholder="1:30" value={text} onChange={(event) => setText(event.target.value)} />
        <button className="button sunny" type="submit" disabled={minutes === null}>
          Done
        </button>
        <button className="button quiet" type="button" onClick={() => finish(null)} title={tracked > 0 ? 'Keeps the timer count' : 'Leaves the time empty'}>
          Skip
        </button>
        <button className="link" type="button" onClick={close}>
          Not done yet
        </button>
      </span>
    </form>
  )
}

/** A todo's checkbox. Ticking it off asks for the real time; unticking just reopens it. */
export function TodoTick({ todo, disabled = false }: { todo: Todo; disabled?: boolean }) {
  const [asking, setAsking] = useState(false)
  if (asking) return <SpentPrompt todo={todo} close={() => setAsking(false)} />
  const done = todo.doneAt !== null
  return (
    <label className={done ? 'todo-done' : ''}>
      <input type="checkbox" disabled={disabled} checked={done} onChange={() => (done ? void window.api.toggleTodo(todo.id) : setAsking(true))} /> <span lang="de">{todo.title}</span>
    </label>
  )
}

function GradeEntry({ event }: { event: CalendarEvent }) {
  const [grade, setGrade] = useState<number | null>(null)
  return (
    <div>
      <div className="grade-row" role="group" aria-label={`Grade for ${event.title}`}>
        <span>Grade:</span>
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} className={`button${grade === value ? '' : ' quiet'}`} aria-pressed={grade === value} onClick={() => setGrade(value)}>
            {value}
          </button>
        ))}
      </div>
      {grade !== null && (
        <>
          <p className="grade-reward">
            {GRADE_REWARDS[grade].length > 0 ? `Rewards: ${GRADE_REWARDS[grade].map(rewardText).join(', ')}.` : 'A 5 brings no reward and costs nothing. A retake can still earn one.'}
            {' '}You can enter this only once.
          </p>
          <button className="button sunny" onClick={() => void window.api.setGrade(event.id, grade)}>
            Enter grade {grade}
          </button>
        </>
      )}
    </div>
  )
}

const FINISHES_LABEL: Record<FinishesWith, string> = { subtasks: 'all todos done', never: 'never (ongoing)', exam: 'the exam, plus all todos' }

function FinishesSelect({ value, onChange }: { value: FinishesWith; onChange: (value: FinishesWith) => void }) {
  return (
    <label className="finishes">
      Completes with{' '}
      <select value={value} onChange={(event) => onChange(event.target.value as FinishesWith)}>
        {(Object.keys(FINISHES_LABEL) as FinishesWith[]).map((option) => (
          <option key={option} value={option}>
            {FINISHES_LABEL[option]}
          </option>
        ))}
      </select>
    </label>
  )
}

function TopicSelect({ value, topics, onChange }: { value: string | null; topics: readonly TopicView[]; onChange: (topic: string | null) => void }) {
  return (
    <select aria-label="Topic" lang="de" value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">No topic</option>
      {topics.map((topic) => (
        <option key={topic.id} value={topic.name}>
          {topic.name}
        </option>
      ))}
    </select>
  )
}

function topicRewardText(topic: TopicView): string {
  return [`+${topic.reward.sun} ☀`, ...topic.reward.items.map(rewardText)].join(', ')
}

const HOURS = 'hours'

/** Hours when you can guess them, or a size when you cannot. It reports every change. */
function EffortPicker({ levels, effort, level, name, placeholder, onChange }: { levels: readonly EffortLevel[]; effort: number | null; level: string | null; name: string; placeholder: string; onChange: (effort: number | null, level: string | null) => void }) {
  const [mode, setMode] = useState(level ?? HOURS)
  const [text, setText] = useState(level || effort === null ? '' : String(effort).replace('.', ','))
  return (
    <span className="effort-picker">
      <select
        aria-label={`Effort of ${name}`}
        value={mode}
        onChange={(event) => {
          const next = event.target.value
          setMode(next)
          setText('')
          if (next === HOURS) onChange(null, null)
          else onChange(null, next)
        }}
      >
        <option value={HOURS}>Hours</option>
        {levels.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}, about {option.hours} h
          </option>
        ))}
      </select>
      {mode === HOURS && (
        <label>
          <input
            className="cal-effort"
            inputMode="decimal"
            aria-label={`Hours for ${name}`}
            placeholder={placeholder}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              onChange(parseEffort(event.target.value), null)
            }}
          />{' '}
          h
        </label>
      )}
    </span>
  )
}

function TodoEffort({ todo }: { todo: Todo }) {
  return <EffortPicker levels={TODO_LEVELS} effort={todo.effort} level={todo.effortLevel} name={todo.title} placeholder="2,5" onChange={(effort, level) => void window.api.setTodoEffort(todo.id, effort, level)} />
}

function AddTopicTodo({ topic }: { topic: string }) {
  const [title, setTitle] = useState('')
  const [size, setSize] = useState<{ effort: number | null; level: string | null }>({ effort: null, level: null })
  const [round, setRound] = useState(0)
  return (
    <form
      className="topic-add-todo"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim()) return
        void window.api.addTodo({ title, due: null, topic, ...size })
        setTitle('')
        setSize({ effort: null, level: null })
        setRound(round + 1)
      }}
    >
      <input type="text" className="topic-todo-title" lang="de" aria-label={`New todo for ${topic}`} placeholder="Add a todo" value={title} onChange={(event) => setTitle(event.target.value)} />
      <EffortPicker key={round} levels={TODO_LEVELS} effort={null} level={null} name={`the new todo of ${topic}`} placeholder="2,5" onChange={(effort, level) => setSize({ effort, level })} />
      <button className="button quiet" type="submit" disabled={!title.trim()}>
        Add
      </button>
    </form>
  )
}

function TopicCard({ topic, todos }: { topic: TopicView; todos: readonly Todo[] }) {
  const own = todos.filter((todo) => todo.topic?.toLowerCase() === topic.name.toLowerCase())
  const completed = topic.completedAt !== null
  return (
    <li className={`topic-card${completed ? ' completed' : ''}${topic.pinned && !completed ? ' pinned' : ''}`}>
      <div className="week-item-head">
        <input
          key={topic.name}
          className="topic-name"
          lang="de"
          aria-label="Topic name"
          defaultValue={topic.name}
          disabled={completed}
          onBlur={(event) => {
            if (event.target.value !== topic.name) void window.api.renameTopic(topic.id, event.target.value)
          }}
        />
        {completed && <strong>Completed ✓</strong>}
        {topic.pinned && !completed && <strong>Main topic</strong>}
      </div>
      <p className="week-reward">
        {topic.state}
        {topic.effortOpen > 0 && `. ${effortText(topic.effortOpen)} of todos and exams open`}
        {Boolean(topic.workedMinutes) && `. ${workedText(topic.workedMinutes ?? 0)} worked${topic.effort ? ` of ${topic.effortLevel ? 'about ' : ''}${String(topic.effort).replace('.', ',')} h` : ''}`}
      </p>
      {topic.todosTotal > 0 && (
        <div className="progress" role="progressbar" aria-label="Todos done" aria-valuenow={Math.round((topic.todosDone / topic.todosTotal) * 100)}>
          <span style={{ width: `${(topic.todosDone / topic.todosTotal) * 100}%` }} />
        </div>
      )}
      {own.length > 0 && (
        <ul className="topic-todos">
          {own.map((todo) => (
            <li key={todo.id} className="topic-todo">
              <TodoTick todo={todo} disabled={completed} />
              {!completed && !todo.doneAt && <TodoEffort todo={todo} />}
            </li>
          ))}
        </ul>
      )}
      {!completed && <AddTopicTodo topic={topic.name} />}
      {!completed && (
        <>
          <div className="row">
            <span className="finishes">
              Effort <EffortPicker levels={TOPIC_LEVELS} effort={topic.effort} level={topic.effortLevel} name={topic.name} placeholder="40" onChange={(effort, level) => void window.api.setTopicEffort(topic.id, effort, level)} />
            </span>
            <FinishesSelect value={topic.finishesWith} onChange={(value) => void window.api.setTopicFinish(topic.id, value)} />
          </div>
          {topic.finishesWith !== 'never' && <p className="week-reward">Completing pays: {topicRewardText(topic)}</p>}
          {topic.ready ? (
            <button className="button sunny" onClick={() => void window.api.completeTopic(topic.id)}>
              Complete {topic.name}
            </button>
          ) : (
            topic.missing.length > 0 && <p className="hint">Still needed: {topic.missing.join(', ')}.</p>
          )}
          <div className="row">
            {!topic.pinned && (
              <button className="link" onClick={() => void window.api.setMainTopic(topic.id)}>
                Make this my main topic
              </button>
            )}
            <button className="link" onClick={() => void window.api.removeTopic(topic.id)}>
              Remove topic
            </button>
          </div>
        </>
      )}
    </li>
  )
}

function TopicsTab({ topics, todos }: { topics: readonly TopicView[]; todos: readonly Todo[] }) {
  const [name, setName] = useState('')
  const [finishes, setFinishes] = useState<FinishesWith>('subtasks')
  const [size, setSize] = useState<{ effort: number | null; level: string | null }>({ effort: null, level: null })
  const [round, setRound] = useState(0)
  const open = topics.filter((topic) => topic.completedAt === null).sort((a, b) => Number(b.ready) - Number(a.ready))
  const done = topics.filter((topic) => topic.completedAt !== null)
  return (
    <div className="topics-page">
      <form
        className="cal-form topic-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          void window.api.addTopic(name, finishes, size.effort, size.level)
          setName('')
          setSize({ effort: null, level: null })
          setRound(round + 1)
        }}
      >
        <input type="text" className="cal-title" lang="de" aria-label="New topic" placeholder="Add a topic, for example Bachelorarbeit, Vorlesungsprüfungen or Labore" value={name} onChange={(event) => setName(event.target.value)} />
        <span className="finishes">
          Effort <EffortPicker key={round} levels={TOPIC_LEVELS} effort={null} level={null} name="the new topic" placeholder="40" onChange={(effort, level) => setSize({ effort, level })} />
        </span>
        <FinishesSelect value={finishes} onChange={setFinishes} />
        <button className="button" type="submit" disabled={!name.trim()}>
          Add topic
        </button>
      </form>
      <p className="hint">Set a topic's hours, or pick a size if you cannot guess them. That sets what completing it pays, however it completes, with the best rewards from 60 h. Your main topic is only highlighted and pays the same.</p>
      {open.length === 0 && done.length === 0 && <p className="empty">Your topics show up here, each with its own todos and reward.</p>}
      <ul className="topic-grid">
        {open.map((topic) => (
          <TopicCard key={topic.id} topic={topic} todos={todos} />
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <h3>Completed</h3>
          <ul className="topic-grid">
            {done.map((topic) => (
              <TopicCard key={topic.id} topic={topic} todos={todos} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function EventRow({ event, today, courses, topics, courseRows }: { event: CalendarEvent; today: string; courses: readonly CourseProgress[]; topics: readonly TopicView[]; courseRows: readonly CourseRow[] }) {
  const days = daysBetween(today, event.date)
  const now = clockTime(new Date())
  const over = examOver(event, today, now)
  const course = courses.find((row) => row.id === event.courseId)
  const pace = course && !over && days >= 0 && event.grade === null ? paceText(course.fresh, days) : null
  return (
    <li className="week-item">
      <div className="week-item-head">
        <strong lang="de">{event.title}</strong>
        <span>
          {shortDate(event.date)}
          {event.time && `, ${event.time}`}
        </span>
      </div>
      <span className="week-reward">
        {KIND_LABEL[event.kind]}
        {over ? (event.grade === null ? ', written. Enter your grade when you have it' : ', written') : days >= 0 && `, ${whenText(days)}`}
        {event.topic ? `. ${event.topic}` : course && `. ${course.name}`}
        {event.effort !== null && `. ${effortText(event.effort)}`}
        {pace && `. ${pace}`}
        {event.grade !== null && `. Grade ${event.grade}`}
      </span>
      {canEnterGrade(event, today, now) && <GradeEntry event={event} />}
      {event.grade === null && (
        <div className="row">
          {event.kind === 'exam' && !over && (
            <label>
              Time <input type="time" value={event.time ?? ''} onChange={(change) => void window.api.setEventTime(event.id, change.target.value || null)} />
            </label>
          )}
          <TopicSelect value={event.topic} topics={topics} onChange={(topic) => void window.api.setEventTopic(event.id, topic, courseForTopic(topic, courseRows)?.id ?? null)} />
          <button className="link" onClick={() => void window.api.removeEvent(event.id)}>
            Remove
          </button>
        </div>
      )}
    </li>
  )
}

const KIND_LABEL: Record<EventKind, string> = { exam: 'Exam', deadline: 'Deadline', event: 'Event' }
const TOPICS_LIST = 'calendar-topics'

/** Type anything; topics you used before and your courses are offered as you type. */
function TopicField({ topic, setTopic }: { topic: string; setTopic: (value: string) => void }) {
  return (
    <label>
      Topic <input type="text" className="cal-topic" lang="de" list={TOPICS_LIST} placeholder="any topic" value={topic} onChange={(event) => setTopic(event.target.value)} />
    </label>
  )
}

function TopicEffort({ topic, effort, setTopic, setEffort }: { topic: string; effort: string; setTopic: (value: string) => void; setEffort: (value: string) => void }) {
  return (
    <>
      <label>
        Topic <input type="text" className="cal-topic" lang="de" list={TOPICS_LIST} placeholder="any topic" value={topic} onChange={(event) => setTopic(event.target.value)} />
      </label>
      <label>
        Hours <input className="cal-effort" inputMode="decimal" aria-label="Hours" placeholder="2,5" value={effort} onChange={(event) => setEffort(event.target.value)} /> h
      </label>
    </>
  )
}

function AddEvent({ date, courses }: { date: string; courses: readonly CourseRow[] }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<EventKind>('exam')
  const [topic, setTopic] = useState('')
  const [effort, setEffort] = useState('')
  const [time, setTime] = useState('')
  return (
    <form
      className="cal-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim()) return
        void window.api.addEvent({ title, date, kind, courseId: courseForTopic(topic, courses)?.id ?? null, topic: topic.trim() || null, effort: parseEffort(effort), time: kind === 'exam' ? time || null : null })
        setTitle('')
        setTopic('')
        setEffort('')
        setTime('')
      }}
    >
      <input type="text" className="cal-title" lang="de" aria-label="Title" placeholder="for example Protokoll abgeben" value={title} onChange={(event) => setTitle(event.target.value)} />
      <select aria-label="Type" value={kind} onChange={(event) => setKind(event.target.value as EventKind)}>
        <option value="exam">Exam</option>
        <option value="deadline">Deadline</option>
        <option value="event">Event</option>
      </select>
      {kind === 'exam' && (
        <label>
          Time <input type="time" aria-label="Exam time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
      )}
      <TopicEffort topic={topic} effort={effort} setTopic={setTopic} setEffort={setEffort} />
      <button className="button" type="submit" disabled={!title.trim()}>
        Add on {shortDate(date)}
      </button>
    </form>
  )
}

function AddTodo({ today }: { today: string }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState(today)
  const [topic, setTopic] = useState('')
  const [size, setSize] = useState<{ effort: number | null; level: string | null }>({ effort: null, level: null })
  const [round, setRound] = useState(0)
  return (
    <form
      className="cal-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim()) return
        void window.api.addTodo({ title, due: due || null, topic: topic.trim() || null, ...size })
        setTitle('')
        setTopic('')
        setSize({ effort: null, level: null })
        setRound(round + 1)
      }}
    >
      <input type="text" className="cal-title" lang="de" aria-label="New todo" placeholder="What needs doing?" value={title} onChange={(event) => setTitle(event.target.value)} />
      <label>
        Due <input type="date" aria-label="Due date, optional" value={due} onChange={(event) => setDue(event.target.value)} />
      </label>
      <TopicField topic={topic} setTopic={setTopic} />
      <span>
        Effort <EffortPicker key={round} levels={TODO_LEVELS} effort={null} level={null} name="the new todo" placeholder="2,5" onChange={(effort, level) => setSize({ effort, level })} />
      </span>
      <button className="button" type="submit" disabled={!title.trim()}>
        Add todo
      </button>
    </form>
  )
}

function TodosTab({ snapshot, today }: { snapshot: Snapshot; today: string }) {
  const { todos, topics } = snapshot.calendar
  const open = todos.filter((todo) => todo.doneAt === null)
  const done = todos.filter((todo) => todo.doneAt !== null).slice(-10)
  return (
    <div className="calendar-columns">
      <section>
        <h3>Add a todo</h3>
        <AddTodo today={today} />
        <h3>Open</h3>
        {open.length === 0 ? (
          <p className="hint">Nothing open.</p>
        ) : (
          <ul className="week-list">
            {open.map((todo) => (
              <li key={todo.id} className="week-item">
                <div className="week-item-head">
                  <TodoTick todo={todo} />
                  {todo.due && <span>{shortDate(todo.due)}</span>}
                </div>
                <div className="row">
                  <TopicSelect value={todo.topic} topics={topics} onChange={(topic) => void window.api.setTodoTopic(todo.id, topic)} />
                  <TodoEffort todo={todo} />
                  <button className="link" onClick={() => void window.api.removeTodo(todo.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <div className="done-todos">
            <h3>Done</h3>
            <ul className="week-list">
              {done.map((todo) => (
                <li key={todo.id} className="week-item">
                  <div className="week-item-head">
                    <TodoTick todo={todo} />
                    <span className="week-reward">{spentLine(todo.spentMinutes ?? Math.floor(todo.trackedMinutes ?? 0), todo.effort)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}

function spentLine(spent: number, effort: number | null): string {
  const planned = effort === null ? null : Math.round(effort * 60)
  return `${spent > 0 ? workedText(spent) : '0 min'} of ${planned === null ? 'no plan' : workedText(planned)}`
}

/** How far the spent time got against the plan. Past the plan the bar turns into a warning. */
function TimeBar({ spent, planned, label }: { spent: number; planned: number; label: string }) {
  if (planned <= 0) return null
  const share = spent / planned
  return (
    <div className={`progress time-bar${share > 1 ? ' over' : ''}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(share * 100)}>
      <span style={{ width: `${Math.min(1, share) * 100}%` }} />
    </div>
  )
}

function differenceText(spent: number, planned: number): string {
  if (planned <= 0) return ''
  const gap = spent - planned
  if (Math.abs(gap) < 1) return 'right on plan'
  return gap > 0 ? `${workedText(gap)} over plan` : `${workedText(-gap)} left in the plan`
}

/** A done todo's time can be corrected later, in the same forms as when ticking it off. */
function SpentField({ id, title, minutes }: { id: number; title: string; minutes: number }) {
  return (
    <input
      key={minutes}
      className="cal-effort"
      aria-label={`Time spent on ${title}`}
      defaultValue={minutes > 0 ? durationInput(minutes) : ''}
      placeholder="add"
      onBlur={(event) => {
        const next = parseDuration(event.target.value)
        if (next !== minutes) void window.api.setTodoSpent(id, next)
      }}
    />
  )
}

function TimeCard({ group }: { group: TimeGroup }) {
  const greyed = group.completed
  return (
    <li className={`topic-card time-card${greyed ? ' completed' : ''}${group.pinned && !greyed ? ' pinned' : ''}`}>
      <div className="week-item-head">
        <strong lang="de" className="time-name">
          {group.name}
        </strong>
        <span className="time-total">
          <strong>{workedText(group.spentMinutes)}</strong> of {group.plannedMinutes > 0 ? workedText(group.plannedMinutes) : 'no plan'}
        </span>
      </div>
      <TimeBar spent={group.spentMinutes} planned={group.plannedMinutes} label={`Time spent on ${group.name}`} />
      <p className="week-reward">
        {[
          greyed ? 'Completed' : null,
          differenceText(group.spentMinutes, group.plannedMinutes),
          group.estimateMinutes !== null ? `topic estimate ${workedText(group.estimateMinutes)}` : null,
          group.looseMinutes > 0 ? `${workedText(group.looseMinutes)} studied without picking a todo` : null,
        ]
          .filter(Boolean)
          .join(', ')}
      </p>
      {group.todos.length > 0 && (
        <ul className="topic-todos time-todos">
          {group.todos.map((todo) => (
            <li key={todo.id} className={`time-todo${todo.done ? ' done' : ''}`}>
              <span lang="de" className="time-todo-title">
                {todo.done ? '✓ ' : ''}
                {todo.title}
              </span>
              <span className="time-todo-numbers">
                {todo.done && !greyed ? <SpentField id={todo.id} title={todo.title} minutes={todo.spentMinutes} /> : <strong>{todo.spentMinutes > 0 ? workedText(todo.spentMinutes) : '0 min'}</strong>}
                {' of '}
                {todo.plannedMinutes === null ? 'no plan' : workedText(todo.plannedMinutes)}
                {!todo.done && todo.spentMinutes > 0 && ' so far'}
                {todo.done && !todo.entered && todo.spentMinutes > 0 && ' (timer)'}
              </span>
              {todo.spentMinutes > 0 && <TimeBar spent={todo.spentMinutes} planned={todo.plannedMinutes ?? 0} label={`Time spent on ${todo.title}`} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function TimeTab({ snapshot }: { snapshot: Snapshot }) {
  const groups = buildTimeTable(snapshot.calendar)
  const active = groups.filter((group) => !group.completed)
  const done = groups.filter((group) => group.completed)
  const spent = active.reduce((total, group) => total + group.spentMinutes, 0)
  const planned = active.reduce((total, group) => total + group.plannedMinutes, 0)
  return (
    <div className="topics-page">
      <p className="hint">
        Pick a todo next to your topic on the home screen and the timer counts towards it. When you tick a todo off, you can enter what it really took. Open topics: <strong>{workedText(spent)}</strong> spent of {workedText(planned)} planned.
      </p>
      {groups.length === 0 && <p className="empty">Add topics and todos with hours, and planned against real time shows up here.</p>}
      <ul className="time-list">
        {active.map((group) => (
          <TimeCard key={group.topicId ?? 'none'} group={group} />
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <h3>Completed</h3>
          <ul className="time-list">
            {done.map((group) => (
              <TimeCard key={group.topicId ?? 'none'} group={group} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Reminders({ snapshot }: { snapshot: Snapshot }) {
  const { settings } = snapshot.calendar
  return (
    <details className="settings">
      <summary>Reminders</summary>
      <div className="cal-form">
        <label>
          <input type="checkbox" checked={settings.notifications} onChange={(event) => void window.api.setCalendarSettings({ ...settings, notifications: event.target.checked })} /> Show reminders
        </label>
        <label>
          Daily at <input type="time" value={settings.briefingTime} onChange={(event) => event.target.value && void window.api.setCalendarSettings({ ...settings, briefingTime: event.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={settings.openAtLogin} onChange={(event) => void window.api.setCalendarSettings({ ...settings, openAtLogin: event.target.checked })} /> Open the app at login
        </label>
      </div>
      <p className="hint">Reminders only arrive while the app is running.</p>
    </details>
  )
}

export function CalendarPage({ snapshot, courses, close, startOn = 'calendar' }: { snapshot: Snapshot; courses: readonly CourseRow[]; close: () => void; startOn?: 'calendar' | 'topics' | 'time' }) {
  const today = localDate(new Date())
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selected, setSelected] = useState(today)
  const { events, todos } = snapshot.calendar
  const days = useMemo(() => monthDays(cursor.year, cursor.month), [cursor])
  const courseProgress = progress(courses)
  const monthKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const move = (by: number) => {
    const next = new Date(cursor.year, cursor.month + by, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }
  const upcoming = events.filter((event) => event.grade === null && (event.date >= today || event.kind === 'exam'))
  const past = events.filter((event) => event.grade !== null).slice(-5)
  const [tab, setTab] = useState<'calendar' | 'todos' | 'topics' | 'time'>(startOn)
  const topics = [...new Set([...snapshot.calendar.topics.map((topic) => topic.name), ...courses.map((course) => course.name)])]

  return (
    <main className="calendar">
      <header className="break-head">
        <h1>{tab === 'topics' ? 'Topics' : tab === 'todos' ? 'Todos' : tab === 'time' ? 'Time spent' : 'Calendar'}</h1>
        <button className="button quiet" onClick={close}>
          Back
        </button>
      </header>
      <datalist id={TOPICS_LIST}>
        {topics.map((topic) => (
          <option key={topic} value={topic} />
        ))}
      </datalist>
      <nav className="calendar-tabs" aria-label="Calendar sections">
        <button className="tab" aria-current={tab === 'calendar'} onClick={() => setTab('calendar')}>
          Calendar
        </button>
        <button className="tab" aria-current={tab === 'todos'} onClick={() => setTab('todos')}>
          Todos ({todos.filter((todo) => todo.doneAt === null).length})
        </button>
        <button className="tab" aria-current={tab === 'topics'} onClick={() => setTab('topics')}>
          Topics
        </button>
        <button className="tab" aria-current={tab === 'time'} onClick={() => setTab('time')}>
          Time spent
        </button>
      </nav>
      {tab === 'time' ? <TimeTab snapshot={snapshot} /> : tab === 'topics' ? <TopicsTab topics={snapshot.calendar.topics} todos={todos} /> : tab === 'todos' ? <TodosTab snapshot={snapshot} today={today} /> : <div className="calendar-columns">
        <section>
          <div className="month-head">
            <button className="button quiet" aria-label="Previous month" onClick={() => move(-1)}>
              ‹
            </button>
            <h2>{monthName}</h2>
            <button className="button quiet" aria-label="Next month" onClick={() => move(1)}>
              ›
            </button>
          </div>
          <div className="month">
            {WEEKDAYS.map((day) => (
              <div key={day} className="month-weekday">
                {day}
              </div>
            ))}
            {days.map((day) => {
              const dayEvents = events.filter((event) => event.date === day)
              const dayTodos = todos.filter((todo) => todo.due === day)
              const classes = ['day', day.startsWith(monthKey) ? '' : 'other', day === today ? 'today' : '', day === selected ? 'selected' : ''].filter(Boolean).join(' ')
              return (
                <button key={day} className={classes} aria-pressed={day === selected} onClick={() => setSelected(day)}>
                  <span className="day-number">{Number(day.slice(8))}</span>
                  {dayEvents.map((event) => (
                    <span key={event.id} lang="de" className={`day-entry ${event.kind}`}>
                      {event.title}
                    </span>
                  ))}
                  {dayTodos.map((todo) => (
                    <span key={todo.id} lang="de" className={`day-entry${todo.doneAt ? ' done' : ''}`}>
                      {todo.title}
                    </span>
                  ))}
                </button>
              )
            })}
          </div>
          <h3>Add on {shortDate(selected)}</h3>
          <AddEvent date={selected} courses={courses} />
          <h3>Grades pay rewards</h3>
          <ul className="week-list">
            {[1, 2, 3, 4].map((grade) => (
              <li key={grade} className="week-item">
                <span className="grade-reward">
                  <strong>{grade}</strong>: {GRADE_REWARDS[grade].map(rewardText).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Coming up</h3>
          {upcoming.length === 0 ? (
            <p className="empty">Pick a day and add your exams, and they show up here and in your daily briefing.</p>
          ) : (
            <ul className="week-list">
              {upcoming.map((event) => (
                <EventRow key={event.id} event={event} today={today} courses={courseProgress} topics={snapshot.calendar.topics} courseRows={courses} />
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <>
              <h3>Your grades</h3>
              <ul className="week-list">
                {past.map((event) => (
                  <EventRow key={event.id} event={event} today={today} courses={courseProgress} topics={snapshot.calendar.topics} courseRows={courses} />
                ))}
              </ul>
            </>
          )}
          <Reminders snapshot={snapshot} />
        </section>
      </div>}
    </main>
  )
}
