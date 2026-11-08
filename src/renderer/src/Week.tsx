import { useState } from 'react'
import { fundGrowthAmount, fundSunAmount } from '../../core/rewards'
import type { WeekGoalView, WeekReward, WeekState } from '../../core/week'

export function rewardText(reward: WeekReward): string {
  if (reward.amount) return `+${reward.amount} ☀`
  if (reward.bromeliad) return 'Bromeliad seed'
  if (reward.gold) return 'Golden pot'
  if (reward.kind === 'seed') return `${reward.rarity[0].toUpperCase()}${reward.rarity.slice(1)} seed`
  if (reward.kind === 'fertilizer') return `Fertilizer, +${fundGrowthAmount(reward.rarity)} growth`
  if (reward.kind === 'sun') return `Sunbeam, +${fundSunAmount(reward.rarity)} ☀`
  return 'New pot'
}

function hours(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

function goalCount(goal: WeekGoalView): string {
  if (goal.metric === 'focusMinutes') return `${hours(Math.min(goal.progress, goal.target))} of ${goal.target / 60} h`
  return `${Math.min(goal.progress, goal.target)} of ${goal.target}`
}

/** One line for the home screen, about what is closest. */
export function weekLine(week: WeekState): string {
  const openTasks = week.tasks.filter((task) => task.doneCount < task.timesPerWeek)
  const next = week.goals.find((goal) => goal.metric === 'focusMinutes' && !goal.reached)
  const study = next ? `${hours(week.stats.focusMinutes)} of ${next.target / 60} h this week` : `${hours(week.stats.focusMinutes)} studied this week`
  if (openTasks.length === 0) return `${study}, all tasks done.`
  return `${study}, ${openTasks.length} ${openTasks.length === 1 ? 'task' : 'tasks'} open.`
}

function GoalRow({ goal }: { goal: WeekGoalView }) {
  const share = goal.target > 0 ? Math.min(1, goal.progress / goal.target) : 1
  return (
    <li className={`week-item${goal.reached ? ' done' : ''}`}>
      <div className="week-item-head">
        <strong>{goal.title}</strong>
        <span>{goalCount(goal)}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(share * 100)}>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <span className="week-reward">{goal.reached ? `Earned: ${rewardText(goal.reward)}` : `Reward: ${rewardText(goal.reward)}`}</span>
    </li>
  )
}

function AddTask() {
  const [title, setTitle] = useState('')
  const [times, setTimes] = useState(1)
  const add = () => {
    if (!title.trim()) return
    void window.api.addTask(title, times)
    setTitle('')
    setTimes(1)
  }
  return (
    <form
      className="week-add"
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
    >
      <input aria-label="New task" placeholder="Add a task, for example Clean the bathroom" value={title} onChange={(event) => setTitle(event.target.value)} />
      <label>
        Times a week <input type="number" min={1} max={14} value={times} onChange={(event) => setTimes(Number(event.target.value))} />
      </label>
      <button className="button quiet" type="submit" disabled={!title.trim()}>
        Add
      </button>
    </form>
  )
}

export function WeekPanel({ week }: { week: WeekState }) {
  return (
    <div className="week-columns">
      <section>
        <h3>Study goals</h3>
        <ul className="week-list">
          {week.goals.map((goal) => (
            <GoalRow key={goal.id} goal={goal} />
          ))}
        </ul>
      </section>
      <section>
        <h3>Tasks</h3>
        <ul className="week-list">
          {week.tasks.map((task) => {
            const done = task.doneCount >= task.timesPerWeek
            return (
              <li key={task.id} className={`week-item${done ? ' done' : ''}`}>
                <div className="week-item-head">
                  <strong>{task.title}</strong>
                  <span>
                    {task.doneCount} of {task.timesPerWeek}
                  </span>
                </div>
                <span className="week-reward">{done ? `Earned: ${rewardText(task.reward)}` : `Reward: ${rewardText(task.reward)}`}</span>
                <div className="row">
                  <button className="button" onClick={() => void window.api.taskDone(task.id)}>
                    Done
                  </button>
                  {task.doneCount > 0 && (
                    <button className="button quiet" onClick={() => void window.api.taskUndo(task.id)}>
                      Undo
                    </button>
                  )}
                  <button className="link" onClick={() => void window.api.removeTask(task.id)}>
                    Remove task
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <AddTask />
        <h3>Whole week</h3>
        <ul className="week-list">
          <GoalRow goal={week.complete} />
        </ul>
      </section>
    </div>
  )
}

export function WeekPage({ week, close }: { week: WeekState; close: () => void }) {
  return (
    <main className="week">
      <header className="break-head">
        <div>
          <h1>This week</h1>
          <p>Whatever you don't reach just ends on Sunday. Nothing is lost, and a new week starts on Monday.</p>
        </div>
        <button className="button quiet" onClick={close}>
          Back
        </button>
      </header>
      <WeekPanel week={week} />
    </main>
  )
}
