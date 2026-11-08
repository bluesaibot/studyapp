import { useEffect, useState } from 'react'
import type { Snapshot } from '../../shared/api'

export function useSnapshot(): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    void window.api.getSnapshot().then(setSnapshot)
    return window.api.onSnapshot(setSnapshot)
  }, [])
  return snapshot
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} h ${String(rest).padStart(2, '0')}`
}

export function sun(amount: number): string {
  return `${Math.floor(amount)} ☀`
}
