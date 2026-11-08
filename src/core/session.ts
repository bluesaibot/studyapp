import { dayTier, focusSun, REWARDS, rollFund, type Fund } from './rewards'
import type { Rng } from './rng'

export const FIRST_GOAL_MS = 5 * 60_000
export const MINI_GOAL_MS = 10 * 60_000
export const DIP_BREAK_MS = 5 * 60_000
/** A sleeping laptop stops ticking, so a gap longer than this is not study time. */
export const MAX_TICK_MS = 5_000

export interface SessionSettings {
  blockMinutes: number
  breakMinutes: number
  longBreakMinutes: number
  blocksUntilLongBreak: number
}

export const DEFAULT_SETTINGS: SessionSettings = {
  blockMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  blocksUntilLongBreak: 4,
}

export type SessionPhase = 'study' | 'paused' | 'break' | 'breakOver'

export interface SessionState {
  task: string
  phase: SessionPhase
  settings: SessionSettings
  streakMultiplier: number
  dayFocusAtStartMs: number
  focusMs: number
  blockFocusMs: number
  completedBlocks: number
  breakRemainingMs: number
  breakOvertimeMs: number
  earnedSun: number
  funds: Fund[]
  firstGoalReached: boolean
  /** Focus time at which the current mini goal is done; null when none is set. */
  miniGoalAtMs: number | null
  dips: number
  lastDipFocusMs: number
  cardsReviewed: number
  questionsAnswered: number
}

export type SessionEvent =
  | { type: 'firstGoalReached' }
  | { type: 'miniGoalReached' }
  | { type: 'blockDone'; fund: Fund }
  | { type: 'breakOver' }

export function startSession(
  task: string,
  settings: SessionSettings,
  streakMultiplier: number,
  dayFocusAtStartMs: number,
): SessionState {
  return {
    task,
    phase: 'study',
    settings,
    streakMultiplier,
    dayFocusAtStartMs,
    focusMs: 0,
    blockFocusMs: 0,
    completedBlocks: 0,
    breakRemainingMs: 0,
    breakOvertimeMs: 0,
    earnedSun: 0,
    funds: [],
    firstGoalReached: false,
    miniGoalAtMs: null,
    dips: 0,
    lastDipFocusMs: 0,
    cardsReviewed: 0,
    questionsAnswered: 0,
  }
}

function dayMinutes(state: SessionState): number {
  return (state.dayFocusAtStartMs + state.focusMs) / 60_000
}

export function tick(
  state: SessionState,
  elapsedMs: number,
  rng: Rng,
): { state: SessionState; events: SessionEvent[] } {
  const dt = Math.min(Math.max(elapsedMs, 0), MAX_TICK_MS)
  const events: SessionEvent[] = []
  const next: SessionState = { ...state }

  if (next.phase === 'study') {
    next.earnedSun += focusSun(dayMinutes(next), dt / 60_000, next.streakMultiplier)
    next.focusMs += dt
    next.blockFocusMs += dt

    if (!next.firstGoalReached && next.focusMs >= FIRST_GOAL_MS) {
      next.firstGoalReached = true
      events.push({ type: 'firstGoalReached' })
    }
    if (next.miniGoalAtMs !== null && next.focusMs >= next.miniGoalAtMs) {
      next.miniGoalAtMs = null
      events.push({ type: 'miniGoalReached' })
    }
    if (next.blockFocusMs >= next.settings.blockMinutes * 60_000) {
      const fund = rollFund(rng, dayMinutes(next))
      next.funds = [...next.funds, fund]
      next.completedBlocks += 1
      next.blockFocusMs = 0
      const isLong = next.completedBlocks % next.settings.blocksUntilLongBreak === 0
      next.breakRemainingMs =
        (isLong ? next.settings.longBreakMinutes : next.settings.breakMinutes) * 60_000
      next.breakOvertimeMs = 0
      next.phase = 'break'
      events.push({ type: 'blockDone', fund })
    }
  } else if (next.phase === 'break') {
    next.breakRemainingMs -= dt
    if (next.breakRemainingMs <= 0) {
      next.breakRemainingMs = 0
      next.breakOvertimeMs = 0
      next.phase = 'breakOver'
      events.push({ type: 'breakOver' })
    }
  } else if (next.phase === 'breakOver') {
    next.breakOvertimeMs += dt
  }

  return { state: next, events }
}

export function pause(state: SessionState): SessionState {
  return state.phase === 'study' ? { ...state, phase: 'paused' } : state
}

export function resume(state: SessionState): SessionState {
  return state.phase === 'paused' ? { ...state, phase: 'study' } : state
}

/** Noticing the dip earns sun, whatever happens next. */
export function markDip(state: SessionState): SessionState {
  return {
    ...state,
    dips: state.dips + 1,
    lastDipFocusMs: state.focusMs,
    earnedSun: state.earnedSun + REWARDS.sunForDip,
  }
}

/** Any answer earns sun, right or wrong: doing the work is what counts. */
export function rewardReview(state: SessionState, kind: 'card' | 'question'): SessionState {
  const base = kind === 'card' ? REWARDS.sunPerCard : REWARDS.sunPerOpenQuestion
  const earned = base * dayTier(dayMinutes(state)).sunMultiplier * state.streakMultiplier
  return {
    ...state,
    earnedSun: state.earnedSun + earned,
    cardsReviewed: state.cardsReviewed + (kind === 'card' ? 1 : 0),
    questionsAnswered: state.questionsAnswered + (kind === 'question' ? 1 : 0),
  }
}

export function setMiniGoal(state: SessionState): SessionState {
  return { ...state, miniGoalAtMs: state.focusMs + MINI_GOAL_MS }
}

export function setTask(state: SessionState, task: string): SessionState {
  return { ...state, task }
}

export function takeBreak(state: SessionState, breakMs: number = DIP_BREAK_MS): SessionState {
  if (state.phase !== 'study' && state.phase !== 'paused') return state
  return { ...state, phase: 'break', breakRemainingMs: breakMs, breakOvertimeMs: 0 }
}

/** Coming back on time earns a bonus; coming back late just continues. */
export function returnFromBreak(state: SessionState): SessionState {
  if (state.phase !== 'break' && state.phase !== 'breakOver') return state
  const onTime = state.phase === 'break' || state.breakOvertimeMs <= REWARDS.onTimeGraceMs
  return {
    ...state,
    phase: 'study',
    breakRemainingMs: 0,
    breakOvertimeMs: 0,
    earnedSun: state.earnedSun + (onTime ? REWARDS.sunForOnTimeReturn : 0),
  }
}
