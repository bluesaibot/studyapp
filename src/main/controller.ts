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
import { questionSun } from '../core/rewards'
import { computeStreak, localDate } from '../core/streak'
import type { SessionSummary, Snapshot } from '../shared/api'
import type { ReviewRequest } from '../shared/study'
import type { Calendar } from './calendar'
import type { Db } from './db'
import type { Study } from './study'
import type { Week } from './week'

const PERSIST_EVERY_MS = 5_000

export interface ControllerHooks {
  broadcast(snapshot: Snapshot): void
  onEvent(event: SessionEvent): void
  onSessionChange(active: boolean): void
  onWeekReward(title: string): void
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
    private readonly week: Week,
    private readonly calendar: Calendar,
    private readonly hooks: ControllerHooks,
    /** Time multiplier for development and screenshots. */
    private readonly speed = 1,
  ) {
    db.closeOpenSessions()
    this.week.claimReached(new Date())
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
      gardenBeds: this.db.gardenBeds(),
      beds: this.db.beds(),
      shears: this.db.shears(),
      pollen: this.db.pollen(),
      soilStock: this.db.soilStock(),
      mixes: this.db.mixes(),
      ownedPots: this.db.ownedPots(),
      nursery: this.db.nursery(),
      pollinations: this.db.pollinations(),
      settings: this.db.settings(),
      week: this.week.state(new Date()),
      calendar: this.calendar.state(),
    }
  }

  private publish() {
    for (const title of this.week.claimReached(new Date())) this.hooks.onWeekReward(title)
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
      this.db.ensureCurrentPlant(label || null, true)
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
    if (!kind || !this.session) return
    if (kind === 'card') {
      this.update((state) => rewardReview(state, kind))
      return
    }
    const base = questionSun(request.thinkingMs ?? 0, this.study.paidToday(request.itemId))
    this.study.addPaid(request.itemId, base)
    this.update((state) => rewardReview(state, kind, base))
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
  takeCutting = (plantId: number, leafIndex: number) =>
    this.mutate(() => this.db.takeCutting(plantId, leafIndex, Math.floor(Math.random() * 2 ** 31), this.session?.task || null))
  sow = (nurseryId: number, bedId: number | null) => this.mutate(() => this.db.sow(nurseryId, bedId))
  digUp = (plantId: number) => this.mutate(() => this.db.digUp(plantId))
  buyBed = () => this.mutate(() => this.db.buyBed())
  moveToGreenhouse = (plantId: number) => this.mutate(() => this.db.moveToGreenhouse(plantId))
  moveToGarden = (plantId: number, bedId: number | null) => this.mutate(() => this.db.moveToGarden(plantId, bedId))
  swapBeds = (bedA: number, bedB: number) => this.mutate(() => this.db.swapBeds(bedA, bedB))
  swapShelf = (plantA: number, plantB: number) => this.mutate(() => this.db.swapShelf(plantA, plantB))
  startPollination = (plantA: number, plantB: number) => this.mutate(() => this.db.startPollination(plantA, plantB))
  startWithPollen = (plantId: number) => this.mutate(() => this.db.startWithPollen(plantId))
  feedPollination = (id: number, amount: number) => this.mutate(() => this.db.feedPollination(id, amount))
  setPollinationFill = (id: number, on: boolean) => this.mutate(() => this.db.setPollinationFill(id, on))
  buySoil = (ingredient: string, litres: number) => this.mutate(() => this.db.buySoil(ingredient, litres))
  mixSoil = (recipe: Record<string, number>) => this.mutate(() => this.db.mixSoil(recipe))
  discardMix = (mixId: number) => this.mutate(() => this.db.discardMix(mixId))
  fillBed = (bedId: number, mixId: number) => this.mutate(() => this.db.fillBed(bedId, mixId))
  buyPot = (pot: number) => this.mutate(() => this.db.buyPot(pot))
  setPot = (plantId: number, pot: number) => this.mutate(() => this.db.setPot(plantId, pot))
  buyShears = (id: string) => this.mutate(() => this.db.buyShears(id))
  buyPollen = () => this.mutate(() => this.db.buyPollen())
  taskDone = (taskId: number) => this.mutate(() => this.week.taskDone(taskId, new Date()))
  taskUndo = (taskId: number) => this.mutate(() => this.week.taskUndo(taskId, new Date()))
  addTask = (title: string, timesPerWeek: number) => this.mutate(() => this.week.addTask(title, timesPerWeek))
  removeTask = (taskId: number) => this.mutate(() => this.week.removeTask(taskId))
  addEvent = (event: Parameters<Calendar['addEvent']>[0]) => this.mutate(() => this.calendar.addEvent(event))
  setEventTime = (eventId: number, time: string | null) => this.mutate(() => this.calendar.setEventTime(eventId, time))
  removeEvent = (eventId: number) => this.mutate(() => this.calendar.removeEvent(eventId))
  setGrade = (eventId: number, grade: number) => this.mutate(() => this.calendar.setGrade(eventId, grade, new Date()))
  addTodo = (todo: Parameters<Calendar['addTodo']>[0]) => this.mutate(() => this.calendar.addTodo(todo))
  toggleTodo = (todoId: number) => this.mutate(() => this.calendar.toggleTodo(todoId, new Date()))
  removeTodo = (todoId: number) => this.mutate(() => this.calendar.removeTodo(todoId))
  setCalendarSettings = (settings: Parameters<Calendar['setSettings']>[0]) => this.mutate(() => this.calendar.setSettings(settings))
  addTopic = (name: string, finishesWith: Parameters<Calendar['addTopic']>[1], effort: number | null) => this.mutate(() => this.calendar.addTopic(name, finishesWith, effort))
  renameTopic = (topicId: number, name: string) => this.mutate(() => this.calendar.renameTopic(topicId, name))
  setTopicPinned = (topicId: number, pinned: boolean) => this.mutate(() => this.calendar.setTopicPinned(topicId, pinned))
  setTopicEffort = (topicId: number, effort: number | null) => this.mutate(() => this.calendar.setTopicEffort(topicId, effort))
  completeTopic = (topicId: number) => this.mutate(() => this.calendar.completeTopic(topicId, new Date()))
  setTopicFinish = (topicId: number, finishesWith: Parameters<Calendar['setTopicFinish']>[1]) => this.mutate(() => this.calendar.setTopicFinish(topicId, finishesWith))
  removeTopic = (topicId: number) => this.mutate(() => this.calendar.removeTopic(topicId))
  setTodoTopic = (todoId: number, topic: string | null) => this.mutate(() => this.calendar.setTodoTopic(todoId, topic))
  setTodoEffort = (todoId: number, effort: number | null) => this.mutate(() => this.calendar.setTodoEffort(todoId, effort))
  setEventTopic = (eventId: number, topic: string | null, courseId: number | null) => this.mutate(() => this.calendar.setEventTopic(eventId, topic, courseId))
  /** What should be announced right now; each thing only once. */
  notificationsDue = (now: Date) => this.calendar.takeNotifications(now)
  setSettings = (settings: SessionSettings) => this.mutate(() => this.db.setSettings(settings))
}
