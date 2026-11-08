import { localDate } from './streak'

export function dateOffset(start: Date, days: number): string {
  return localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days))
}
