import { describe, expect, it } from 'vitest'
import { NO_MISTAKE, recordAnswer } from './mistakes'
import { dayTier, focusSun, questionSun, REWARDS, rollFund } from './rewards'
import { createScheduler } from './scheduler'
import { createRng } from './rng'
import {
  DEFAULT_SETTINGS,
  FIRST_GOAL_MS,
  markDip,
  returnFromBreak,
  rewardReview,
  startSession,
  takeBreak,
  tick,
  type SessionState,
} from './session'
import { computeStreak, localDate, multiplierFor } from './streak'
import {
  BROMELIADS,
  FLOWERING_GROWTH,
  flowerProgress,
  leafEmergence,
  leafProgress,
  makeGenome,
  MAX_LEAVES,
  nextStageProgress,
  SPECIES,
  speciesFromSeed,
  SPROUT_GROWTH,
  stageIndex,
} from './plants'

function days(start: string, offsets: number[]): string[] {
  const [year, month, day] = start.split('-').map(Number)
  return offsets.map((offset) => localDate(new Date(year, month - 1, day + offset)))
}

function runFor(state: SessionState, ms: number, seed = 1): SessionState {
  const rng = createRng(seed)
  let current = state
  for (let elapsed = 0; elapsed < ms; elapsed += 5000) {
    current = tick(current, 5000, rng).state
  }
  return current
}

describe('rewards', () => {
  it('pays more for later hours and stops rising after the top tier', () => {
    expect(dayTier(30).sunMultiplier).toBe(1)
    expect(dayTier(150).sunMultiplier).toBe(1.25)
    expect(dayTier(200).sunMultiplier).toBe(1.5)
    expect(dayTier(600).sunMultiplier).toBe(1.5)
  })

  it('applies the streak multiplier', () => {
    expect(focusSun(0, 10, 1.3)).toBeCloseTo(13)
  })

  it('finds rarer funds at higher tiers', () => {
    const count = (minutes: number) => {
      const rng = createRng(7)
      let rare = 0
      for (let i = 0; i < 5000; i += 1) {
        if (rollFund(rng, minutes).rarity === 'rare') rare += 1
      }
      return rare
    }
    expect(count(200)).toBeGreaterThan(count(30) * 3)
  })
})

describe('streak', () => {
  const start = '2026-11-02'

  it('adds 5 % per day, capped at 30 %', () => {
    expect(multiplierFor(1)).toBeCloseTo(1.05)
    expect(multiplierFor(6)).toBeCloseTo(1.3)
    expect(multiplierFor(40)).toBeCloseTo(1.3)
  })

  it('does not count today as missed', () => {
    const [today] = days(start, [1])
    const state = computeStreak(days(start, [0]), today)
    expect(state.runDays).toBe(1)
    expect(state.sessionMultiplier).toBeCloseTo(1.1)
  })

  it('survives two rest days in a week', () => {
    const [today] = days(start, [6])
    const state = computeStreak(days(start, [0, 1, 2, 5, 6]), today)
    expect(state.runDays).toBe(5)
    expect(state.rings).toHaveLength(0)
  })

  it('banks an ended run as a Jahresring and grants the comeback multiplier', () => {
    const [today] = days(start, [9])
    const state = computeStreak(days(start, [0, 1, 2, 3]), today)
    expect(state.runDays).toBe(0)
    expect(state.rings).toEqual([{ start: '2026-11-02', end: '2026-11-05', days: 4 }])
    expect(state.comeback).toBe(true)
    expect(state.sessionMultiplier).toBeCloseTo(1.2)
  })

  it('starts a new run after a comeback and keeps old rings', () => {
    const [today] = days(start, [10])
    const state = computeStreak(days(start, [0, 1, 2, 3, 10]), today)
    expect(state.runDays).toBe(1)
    expect(state.rings).toHaveLength(1)
    expect(state.comeback).toBe(false)
  })
})

describe('never punish', () => {
  it('never loses rings or study days as days pass, whatever the history', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = createRng(seed)
      const history: string[] = []
      let rings = 0
      let total = 0
      for (let offset = 0; offset < 120; offset += 1) {
        const [today] = days('2026-01-01', [offset])
        if (rng() < 0.5) history.push(today)
        const state = computeStreak(history, today)
        expect(state.rings.length).toBeGreaterThanOrEqual(rings)
        expect(state.totalStudyDays).toBeGreaterThanOrEqual(total)
        expect(state.sessionMultiplier).toBeGreaterThanOrEqual(1)
        rings = state.rings.length
        total = state.totalStudyDays
      }
    }
  })

  it('never reduces earned Sonne or funds in any session, however it goes', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const rng = createRng(seed)
      let state = startSession('Test', DEFAULT_SETTINGS, 1, 0)
      let sun = 0
      let funds = 0
      for (let step = 0; step < 3000; step += 1) {
        const action = rng()
        if (action < 0.002) state = markDip(state)
        else if (action < 0.004) state = takeBreak(state)
        else if (action < 0.008) state = returnFromBreak(state)
        state = tick(state, 5000, rng).state
        expect(state.earnedSun).toBeGreaterThanOrEqual(sun)
        expect(state.funds.length).toBeGreaterThanOrEqual(funds)
        sun = state.earnedSun
        funds = state.funds.length
      }
    }
  })

  it('never moves a plant back a stage as growth rises', () => {
    let previous = 0
    for (let growth = 0; growth < 1000; growth += 7) {
      const stage = stageIndex(growth)
      expect(stage).toBeGreaterThanOrEqual(previous)
      previous = stage
    }
  })
})

describe('session', () => {
  it('earns a fund and starts a break after one block', () => {
    const state = runFor(startSession('Test', DEFAULT_SETTINGS, 1, 0), 25 * 60_000)
    expect(state.phase).toBe('break')
    expect(state.completedBlocks).toBe(1)
    expect(state.funds).toHaveLength(1)
    expect(state.earnedSun).toBeCloseTo(25)
    expect(state.firstGoalReached).toBe(true)
  })

  it('reports the first goal once at five minutes', () => {
    const rng = createRng(1)
    let state = startSession('Test', DEFAULT_SETTINGS, 1, 0)
    let reached = 0
    for (let elapsed = 0; elapsed < FIRST_GOAL_MS * 2; elapsed += 5000) {
      const result = tick(state, 5000, rng)
      state = result.state
      reached += result.events.filter((event) => event.type === 'firstGoalReached').length
    }
    expect(reached).toBe(1)
  })

  it('does not count a sleeping laptop as study time', () => {
    const next = tick(startSession('Test', DEFAULT_SETTINGS, 1, 0), 3_600_000, createRng(1)).state
    expect(next.focusMs).toBe(5000)
  })

  it('makes every fourth break the long one', () => {
    const settings = { ...DEFAULT_SETTINGS, blockMinutes: 1 }
    let state = startSession('Test', settings, 1, 0)
    for (let block = 0; block < 3; block += 1) {
      state = returnFromBreak(runFor(state, 60_000))
    }
    state = runFor(state, 60_000)
    expect(state.completedBlocks).toBe(4)
    expect(state.breakRemainingMs).toBe(15 * 60_000)
  })

  it('gives an on-time bonus and no penalty for coming back late', () => {
    const onBreak = runFor(startSession('Test', DEFAULT_SETTINGS, 1, 0), 25 * 60_000)
    const over = runFor(onBreak, 5 * 60_000)
    expect(over.phase).toBe('breakOver')
    expect(returnFromBreak(over).earnedSun).toBeCloseTo(over.earnedSun + 3)
    const late = runFor(over, 30 * 60_000)
    expect(returnFromBreak(late).earnedSun).toBeCloseTo(over.earnedSun)
    expect(returnFromBreak(late).phase).toBe('study')
  })
})

describe('plants', () => {
  it('builds the same genome from the same seed', () => {
    expect(makeGenome('monstera', 42, 'uncommon')).toEqual(makeGenome('monstera', 42, 'uncommon'))
  })

  it('makes variegation rarer on common seeds', () => {
    const count = (rarity: 'common' | 'rare') => {
      let variegated = 0
      for (let seed = 0; seed < 3000; seed += 1) {
        if (makeGenome(SPECIES[seed % 8].id, seed * 7919, rarity).variegation !== 'none') variegated += 1
      }
      return variegated
    }
    expect(count('rare')).toBeGreaterThan(count('common') * 4)
  })

  it('reports progress towards the next stage', () => {
    expect(stageIndex(0)).toBe(0)
    expect(stageIndex(700)).toBe(4)
    expect(nextStageProgress(60)).toBeCloseTo(0.5)
    expect(nextStageProgress(9000)).toBe(1)
  })
})

describe('plant growth drawing', () => {
  it('opens every leaf gradually, with no sudden jump at any growth', () => {
    for (let index = 0; index < MAX_LEAVES; index += 1) {
      let previous = 0
      for (let growth = 0; growth <= 800; growth += 0.25) {
        const progress = leafProgress(growth, index)
        expect(progress).toBeGreaterThanOrEqual(previous)
        expect(progress - previous).toBeLessThan(0.35)
        previous = progress
      }
    }
  })

  it('shows no leaves before the sprout stage and is in full bloom when flowering', () => {
    expect(leafEmergence(SPROUT_GROWTH - 0.1)).toBe(0)
    expect(flowerProgress(FLOWERING_GROWTH - 61)).toBe(0)
    expect(flowerProgress(FLOWERING_GROWTH)).toBe(1)
  })
})

describe('species from seeds', () => {
  const seeds = Array.from({ length: 4000 }, (_, i) => i * 7 + 3)
  const bromeliads = new Set(BROMELIADS.map((species) => species.id))

  it('keeps every common seed on the species it stood for before bromeliads came', () => {
    const before = ['monstera', 'philodendron', 'pothos', 'alocasia', 'anthurium', 'begonia', 'calathea', 'hoya']
    for (const seed of seeds) expect(speciesFromSeed(seed).id).toBe(before[seed % 8])
  })

  it('makes bromeliads rare: never from a common seed, often from a rare one', () => {
    const share = (rarity: 'common' | 'uncommon' | 'rare') =>
      seeds.filter((seed) => bromeliads.has(speciesFromSeed(seed, rarity).id)).length / seeds.length
    expect(share('common')).toBe(0)
    expect(share('uncommon')).toBeGreaterThan(0.04)
    expect(share('uncommon')).toBeLessThan(0.14)
    expect(share('rare')).toBeGreaterThan(0.5)
    expect(share('rare')).toBeLessThan(0.7)
  })

  it('reaches every bromeliad, and a seed always gives the same plant', () => {
    const grown = new Set(seeds.map((seed) => speciesFromSeed(seed, 'rare').id))
    for (const species of BROMELIADS) expect(grown).toContain(species.id)
    expect(speciesFromSeed(1234, 'rare').id).toBe(speciesFromSeed(1234, 'rare').id)
  })
})

describe('study rewards and the mistake list', () => {
  it('earns sun for a wrong answer exactly like a right one', () => {
    const state = startSession('Bio', DEFAULT_SETTINGS, 1, 0)
    const after = rewardReview(state, 'question')
    expect(after.earnedSun).toBe(REWARDS.sunPerOpenQuestion)
    expect(after.questionsAnswered).toBe(1)
    expect(rewardReview(state, 'card').cardsReviewed).toBe(1)
  })

  it('pays an open question in full only after a minute, and once a day', () => {
    expect(questionSun(REWARDS.fullQuestionMs, 0)).toBe(REWARDS.sunPerOpenQuestion)
    expect(questionSun(REWARDS.fullQuestionMs - 1, 0)).toBe(REWARDS.sunPerQuickQuestion)
    expect(questionSun(REWARDS.fullQuestionMs, REWARDS.sunPerOpenQuestion)).toBe(0)
    expect(questionSun(1000, REWARDS.sunPerQuickQuestion)).toBe(0)
  })

  it('tops a quick answer up to the full amount, never above, and never takes sun away', () => {
    expect(REWARDS.sunPerQuickQuestion + questionSun(REWARDS.fullQuestionMs, REWARDS.sunPerQuickQuestion)).toBe(REWARDS.sunPerOpenQuestion)
    const state = startSession('Bio', DEFAULT_SETTINGS, 1, 0)
    const after = rewardReview(state, 'question', questionSun(1000, REWARDS.sunPerOpenQuestion))
    expect(after.earnedSun).toBe(0)
    expect(after.questionsAnswered).toBe(1)
  })

  it('clears a mistake after two good answers on two later days', () => {
    let state = recordAnswer(NO_MISTAKE, false, '2026-11-08')
    expect(state.open).toBe(true)
    state = recordAnswer(state, true, '2026-11-08')
    expect(state.correctDays).toBe(0)
    state = recordAnswer(state, true, '2026-11-09')
    state = recordAnswer(state, true, '2026-11-09')
    expect(state).toMatchObject({ open: true, correctDays: 1 })
    state = recordAnswer(state, true, '2026-11-10')
    expect(state.open).toBe(false)
  })

  it('keeps earlier progress when an item on the list is missed again', () => {
    let state = recordAnswer(NO_MISTAKE, false, '2026-11-08')
    state = recordAnswer(state, true, '2026-11-09')
    state = recordAnswer(state, false, '2026-11-10')
    expect(state).toMatchObject({ open: true, correctDays: 1 })
    expect(recordAnswer(state, true, '2026-11-11').open).toBe(false)
  })
})

describe('scheduler', () => {
  it('survives being stored, and brings a missed card back sooner than a known one', async () => {
    const scheduler = await createScheduler()
    const now = new Date('2026-11-08T12:00:00Z')
    const good = scheduler.review(null, 3, now)
    const again = scheduler.review(null, 1, now)
    expect(again.dueAt).toBeLessThan(good.dueAt)
    const later = new Date(good.dueAt + 60_000)
    const second = scheduler.review(good.state, 3, later)
    expect(second.dueAt).toBeGreaterThan(later.getTime())
    expect(second.stability).toBeGreaterThan(good.stability)
  })
})
