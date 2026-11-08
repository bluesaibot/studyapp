import type { FundKind, Rarity } from './rewards'
import { createRng, pickWeighted } from './rng'
import { localDate } from './streak'

/**
 * Weeks run Monday to Sunday. A goal not reached simply ends with its week: no penalty, nothing lost.
 * Balanced for 5-6 h of work or lab a day with the rest free, so 3-4 h of study on a real day.
 */
export interface WeekReward {
  kind: FundKind
  rarity: Rarity
  /** A seed that is sure to grow a bromeliad. */
  bromeliad?: boolean
  /** The golden glaze. */
  gold?: boolean
}

export interface WeekStats {
  focusMinutes: number
  studyDays: number
  answers: number
}

type Metric = keyof WeekStats

export interface WeekGoal {
  id: string
  title: string
  metric: Metric
  target: number
  reward: WeekReward
}

export const WEEK_GOALS: readonly WeekGoal[] = [
  { id: 'study-10h', title: 'Study 10 hours', metric: 'focusMinutes', target: 600, reward: { kind: 'seed', rarity: 'uncommon' } },
  { id: 'study-20h', title: 'Study 20 hours', metric: 'focusMinutes', target: 1200, reward: { kind: 'seed', rarity: 'rare' } },
  { id: 'study-30h', title: 'Study 30 hours', metric: 'focusMinutes', target: 1800, reward: { kind: 'seed', rarity: 'rare', bromeliad: true } },
  { id: 'days-5', title: 'Study on 5 days', metric: 'studyDays', target: 5, reward: { kind: 'fertilizer', rarity: 'rare' } },
  { id: 'answers-150', title: 'Answer 150 cards or questions', metric: 'answers', target: 150, reward: { kind: 'sun', rarity: 'rare' } },
]

/** For finishing the week: the first study goal and every task. Studying alone does not get it. */
export const WEEK_COMPLETE: { id: string; title: string } = {
  id: 'week-complete',
  title: 'Study 10 hours and finish all tasks',
}

/** Always something good, and different from week to week. */
export const WEEK_COMPLETE_REWARDS: readonly (readonly [WeekReward, number])[] = [
  [{ kind: 'seed', rarity: 'rare' }, 35],
  [{ kind: 'fertilizer', rarity: 'rare' }, 30],
  [{ kind: 'seed', rarity: 'rare', bromeliad: true }, 15],
  [{ kind: 'pot', rarity: 'rare' }, 10],
  [{ kind: 'sun', rarity: 'rare' }, 10],
]

/** Decided by the week, so it can be shown ahead and stays the same all week. */
export function weekCompleteReward(week: string): WeekReward {
  return pickWeighted(createRng(Number(week.replaceAll('-', ''))), WEEK_COMPLETE_REWARDS)
}

export const DEFAULT_TASKS: readonly { title: string; timesPerWeek: number; reward: WeekReward }[] = [
  { title: 'Do the laundry', timesPerWeek: 1, reward: { kind: 'seed', rarity: 'uncommon' } },
  { title: 'Tidy the flat', timesPerWeek: 2, reward: { kind: 'fertilizer', rarity: 'rare' } },
]

export const OWN_TASK_REWARD: WeekReward = { kind: 'sun', rarity: 'uncommon' }

export interface WeekGoalView {
  id: string
  title: string
  progress: number
  target: number
  metric: Metric | 'tasks'
  reached: boolean
  reward: WeekReward
}

export interface WeekTaskView {
  id: number
  title: string
  timesPerWeek: number
  doneCount: number
  reward: WeekReward
}

export interface WeekState {
  start: string
  stats: WeekStats
  goals: WeekGoalView[]
  tasks: WeekTaskView[]
  complete: WeekGoalView
}

export function startOfWeek(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday)
}

export function weekKey(date: Date): string {
  return localDate(startOfWeek(date))
}

export function buildWeek(start: string, stats: WeekStats, tasks: WeekTaskView[]): WeekState {
  const goals = WEEK_GOALS.map((goal) => ({
    id: goal.id,
    title: goal.title,
    metric: goal.metric,
    target: goal.target,
    progress: stats[goal.metric],
    reached: stats[goal.metric] >= goal.target,
    reward: goal.reward,
  }))
  const tasksDone = tasks.filter((task) => task.doneCount >= task.timesPerWeek).length
  return {
    start,
    stats,
    goals,
    tasks,
    complete: {
      id: WEEK_COMPLETE.id,
      title: WEEK_COMPLETE.title,
      metric: 'tasks',
      progress: tasksDone,
      target: tasks.length,
      reached: goals[0].reached && tasksDone === tasks.length,
      reward: weekCompleteReward(start),
    },
  }
}
