export const STREAK = {
  bonusPerDay: 0.05,
  maxBonus: 0.3,
  maxMissedPerWeek: 2,
  minRunDaysForRing: 3,
  minSessionMinutes: 5,
} as const

export interface Jahresring {
  start: string
  end: string
  days: number
}

export interface StreakState {
  /** Study days in the current run; 0 when no run is active. */
  runDays: number
  totalStudyDays: number
  rings: Jahresring[]
  /** Multiplier for the next session started today. */
  sessionMultiplier: number
  /** True when the next session gets the old run's multiplier. */
  comeback: boolean
}

export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addDays(day: string, amount: number): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return localDate(new Date(year, month - 1, dayOfMonth + amount))
}

export function multiplierFor(runDays: number): number {
  return 1 + Math.min(runDays * STREAK.bonusPerDay, STREAK.maxBonus)
}

/**
 * Derives the streak from study days alone. Today never counts as missed, and a run
 * survives up to two missed days in any seven-day window.
 */
export function computeStreak(studyDays: readonly string[], today: string): StreakState {
  const days = new Set(studyDays.filter((day) => day <= today))
  const sorted = [...days].sort()
  const rings: Jahresring[] = []
  let runDays = 0
  let runStart = ''
  let lastStudy = ''
  let missed: string[] = []
  let lastEndedDays = 0

  if (sorted.length > 0) {
    for (let day = sorted[0]; day <= today; day = addDays(day, 1)) {
      if (days.has(day)) {
        if (runDays === 0) runStart = day
        runDays += 1
        lastStudy = day
      } else if (day !== today && runDays > 0) {
        const windowStart = addDays(day, -6)
        missed = [...missed.filter((m) => m >= windowStart), day]
        if (missed.length > STREAK.maxMissedPerWeek) {
          if (runDays >= STREAK.minRunDaysForRing) {
            rings.push({ start: runStart, end: lastStudy, days: runDays })
          }
          lastEndedDays = runDays
          runDays = 0
          missed = []
        }
      }
    }
  }

  const studiedToday = days.has(today)
  const comeback = runDays === 0 && lastEndedDays > 0
  const sessionMultiplier = comeback
    ? multiplierFor(Math.max(lastEndedDays, 1))
    : multiplierFor(runDays + (studiedToday ? 0 : 1))

  return { runDays, totalStudyDays: days.size, rings, sessionMultiplier, comeback }
}
