import {
  markDip,
  MAX_TICK_MS,
  pause,
  resume,
  returnFromBreak,
  rewardReview,
  setMiniGoal,
  setTask,
  startSession,
  takeBreak,
  tick,
  type SessionEvent,
  type SessionSettings,
  type SessionState,
} from '../core/session'
import { computeStreak, localDate } from '../core/streak'
import type { SessionSummary, Snapshot } from '../shared/api'
import type { ReviewRequest } from '../shared/study'
import type { Db } from './db'
import type { Study } from './study'

const PERSIST_EVERY_MS = 5_000

export interface ControllerHooks {
  broadcast(snapshot: Snapshot): void
  onEvent(event: SessionEvent): void
  onSessionChange(active: boolean): void
}

/** Single owner of the running session; all windows only see its snapshots. */
export class Controller {
  private session: SessionState | null = null
  private sessionId: number | null = null
  private sessionDate = ''
  private summary: SessionSummary | null = null
  private appliedSun = 0
  private lastTickAt = 0
  private lastPersistAt = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: Db,
    private readonly study: Study,
    private readonly hooks: ControllerHooks,
    /** Time multiplier for development and screenshots. */
    private readonly speed = 1,
  ) {
    db.closeOpenSessions()
  }

  snapshot(): Snapshot {
    const today = localDate(new Date())
    const savedToday = this.db.dayFocusMs(today)
    return {
      session: this.session,
      summary: this.summary,
      wallet: this.db.wallet(),
      plants: this.db.plants(),
      funds: this.db.unusedFunds(),
      streak: computeStreak(this.db.studyDays(), today),
      todayFocusMs: this.session ? this.session.dayFocusAtStartMs + this.session.focusMs : savedToday,
      lastTask: this.session?.task ?? this.db.lastTask(),
      settings: this.db.settings(),
    }
  }

  private publish() {
    this.hooks.broadcast(this.snapshot())
  }

  private persist(ended = false) {
    if (!this.session || this.sessionId === null) return
    const session = this.session
    const id = this.sessionId
    this.db.transaction(() => {
      this.db.applySun(session.earnedSun - this.appliedSun, session.task || null)
      this.db.saveSession(id, session, ended)
    })
    this.appliedSun = session.earnedSun
    this.lastPersistAt = Date.now()
  }

  private update(change: (state: SessionState) => SessionState) {
    if (!this.session) return
    this.session = change(this.session)
    this.persist()
    this.publish()
  }

  start(task: string) {
    if (this.session) return
    const date = localDate(new Date())
    const label = task.trim()
    this.summary = null
    this.db.transaction(() => {
      this.db.ensureCurrentPlant(label || null)
      this.sessionId = this.db.createSession(label, date)
    })
    const multiplier = computeStreak(this.db.studyDays(), date).sessionMultiplier
    this.session = startSession(label, this.db.settings(), multiplier, this.db.dayFocusMs(date))
    this.sessionDate = date
    this.appliedSun = 0
    this.lastTickAt = Date.now()
    this.timer = setInterval(() => this.onTimer(), 1000)
    this.hooks.onSessionChange(true)
    this.publish()
  }

  private onTimer() {
    if (!this.session) return
    const now = Date.now()
    // A gap from a sleeping laptop is capped here, before any development speed-up.
    let remaining = Math.min(now - this.lastTickAt, MAX_TICK_MS) * this.speed
    this.lastTickAt = now
    const events: SessionEvent[] = []
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_TICK_MS)
      const result = tick(this.session, step, Math.random)
      this.session = result.state
      events.push(...result.events)
      remaining -= step
    }
    for (const event of events) {
      if (event.type === 'blockDone') this.db.addFund(event.fund, this.sessionId)
      this.hooks.onEvent(event)
    }
    if (events.length > 0 || now - this.lastPersistAt >= PERSIST_EVERY_MS) this.persist()
    this.publish()
  }

  pause = () => this.update(pause)
  resume = () => this.update(resume)
  dip = () => this.update(markDip)
  miniGoal = () => this.update(setMiniGoal)
  setTask = (task: string) => this.update((state) => setTask(state, task))
  takeBreak = () => this.update((state) => takeBreak(state))
  returnFromBreak = () => this.update(returnFromBreak)

  end() {
    if (!this.session) return
    this.persist(true)
    const { task, focusMs, earnedSun, funds, completedBlocks, cardsReviewed, questionsAnswered } = this.session
    this.summary = { task, focusMs, earnedSun, funds, blocks: completedBlocks, cardsReviewed, questionsAnswered }
    this.session = null
    this.sessionId = null
    this.sessionDate = ''
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.hooks.onSessionChange(false)
    this.publish()
  }

  /** Records an answer; inside a session it also earns sun, whatever the answer was. */
  review(request: ReviewRequest) {
    const kind = this.study.review(request)
    if (kind) this.update((state) => rewardReview(state, kind))
  }

  private mutate(change: () => void) {
    this.db.transaction(change)
    this.publish()
  }

  dismissSummary() {
    this.summary = null
    this.publish()
  }

  water = (plantId: number) => this.mutate(() => this.db.water(plantId))
  useFund = (fundId: number, plantId: number | null) =>
    this.mutate(() => this.db.useFund(fundId, plantId, this.session?.task || null))
  setCurrentPlant = (plantId: number) => this.mutate(() => this.db.setCurrentPlant(plantId))
  renamePlant = (plantId: number, name: string) => this.mutate(() => this.db.renamePlant(plantId, name))
  setSettings = (settings: SessionSettings) => this.mutate(() => this.db.setSettings(settings))
}
