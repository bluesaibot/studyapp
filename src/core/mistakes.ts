/**
 * The Fehlerliste. An item joins when it was missed and leaves after two good answers
 * on two later days. A new miss adds no penalty and never undoes earlier progress.
 */
export const CORRECT_DAYS_TO_CLEAR = 2

export interface MistakeState {
  open: boolean
  correctDays: number
  lastMissDate: string | null
  lastCorrectDate: string | null
}

export const NO_MISTAKE: MistakeState = { open: false, correctDays: 0, lastMissDate: null, lastCorrectDate: null }

export function recordAnswer(state: MistakeState, correct: boolean, today: string): MistakeState {
  if (!correct) {
    return { ...state, open: true, correctDays: state.open ? state.correctDays : 0, lastMissDate: today }
  }
  if (!state.open || state.lastMissDate === today || state.lastCorrectDate === today) return state
  const correctDays = state.correctDays + 1
  return {
    open: correctDays < CORRECT_DAYS_TO_CLEAR,
    correctDays,
    lastMissDate: state.lastMissDate,
    lastCorrectDate: today,
  }
}
