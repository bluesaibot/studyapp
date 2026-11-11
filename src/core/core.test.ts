import { describe, expect, it } from 'vitest'
import {
  buildBriefing,
  buildTopicView,
  canEnterGrade,
  courseForTopic,
  courseOver,
  daysBetween,
  DEFAULT_CALENDAR_SETTINGS,
  dueNotifications,
  effortText,
  resolveEffort,
  TODO_LEVELS,
  TOPIC_LEVELS,
  type TopicRow,
  examOver,
  GRADE_REWARDS,
  monthDays,
  paceText,
  parseEffort,
  type CalendarEvent,
  type CalendarState,
  topicReward,
  type FinishesWith,
  buildTimeTable,
  parseDuration,
  durationInput,
} from './calendar'
import { crossChance, crossGenomes, cuttingGenome, pollinationCost, pollinationProblem, sexOf } from './genetics'
import { cutLeaf, cutProblem, NO_LEAF_STATE, regrowLeaves, regrowthOf, rollNewLeaves } from './leaves'
import { bedsTouch, GOLD_POT, emergenceOf, growthCost, growthFromSun, plantRarity, sproutCost, varietyShare, type Genome } from './plants'
import { POT_DESIGNS } from './pots'
import { bagPrice, ingredientById, mixStats, recipeStats, SOIL_WOBBLE } from './soil'
import { varietiesOf, varietyById } from './varieties'

function growthPastGate(genome: Genome, gate: number): number {
  let growth = 300
  while (emergenceOf(genome, growth) < gate) growth += 1
  return growth
}
import { NO_MISTAKE, recordAnswer } from './mistakes'
import { buildWeek, WEEK_COMPLETE, WEEK_COMPLETE_REWARDS, weekCompleteReward, WEEK_GOALS, weekKey } from './week'
import { bedCost, dayTier, focusSun, questionSun, REWARDS, rollFund, todoSun } from './rewards'
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
  bromeliadSeed,
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
  stageProgress,
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

  it('almost never makes a variegated plant by itself', () => {
    const count = (rarity: 'common' | 'rare') => {
      let variegated = 0
      for (let seed = 0; seed < 3000; seed += 1) {
        if (makeGenome(SPECIES[seed % 8].id, seed * 7919, rarity).variegation !== 'none') variegated += 1
      }
      return variegated
    }
    expect(count('common')).toBeLessThan(15)
    expect(count('rare')).toBeLessThan(30)
  })

  it('gives every group its real varieties, and keeps rare ones from common seeds', () => {
    for (const species of SPECIES.filter((row) => !BROMELIADS.includes(row))) {
      expect(varietiesOf(species.id).length).toBeGreaterThanOrEqual(5)
      expect(varietiesOf(species.id).length).toBeLessThanOrEqual(10)
    }
    expect(new Set(SPECIES.map((row) => row.group)).size).toBe(12)
    const share = (rarity: 'common' | 'rare', id: string) => {
      let found = 0
      for (let seed = 0; seed < 8000; seed += 1) if (makeGenome('anthurium', seed * 31, rarity).variety === id) found += 1
      return found / 8000
    }
    // A scale, not a tag: anything can come from any seed, and better seeds reach further.
    expect(share('common', 'andraeanum')).toBeGreaterThan(0.3)
    expect(share('common', 'warocqueanum')).toBeGreaterThan(0)
    expect(share('common', 'warocqueanum')).toBeLessThan(0.04)
    expect(share('rare', 'warocqueanum')).toBeGreaterThan(share('common', 'warocqueanum') * 2)
    expect(plantRarity({ ...makeGenome('anthurium', 1, 'common', 'andraeanum'), variegation: 'none' })).toBe(0)
    expect(plantRarity({ ...makeGenome('anthurium', 1, 'common', 'warocqueanum'), variegation: 'none' })).toBeGreaterThan(0)
    expect(varietyShare(makeGenome('guzmania', 1, 'rare', 'lingulata'))).toBeLessThan(0.5)
    expect(varietyById('monstera', undefined).id).toBe('deliciosa')
  })

  it('makes seeds slower to sprout than cuttings, and rare plants slower still', () => {
    const plain = { ...makeGenome('pothos', 11, 'common', 'jade'), variegation: 'none' as const }
    const rare = { ...plain, variegation: 'albo' as const, crossed: true }
    expect(sproutCost(plain, false)).toBe(REWARDS.sproutSeedSun)
    expect(sproutCost(plain, true)).toBeLessThan(sproutCost(plain, false))
    expect(sproutCost(rare, false)).toBe(sproutCost(plain, false) * 8)
    expect(growthCost(rare)).toBe(2)
    expect(growthCost(plain)).toBe(1)
    expect(plantRarity({ ...plain, variegation: 'albo' })).toBe(3)
    expect(plantRarity(makeGenome('guzmania', 3, 'rare', 'lingulata'))).toBe(2)
  })

  it('spreads sun over the sprouting cost and then grows one to one', () => {
    expect(growthFromSun(0, 50, 100)).toBeCloseTo(10)
    expect(growthFromSun(0, 100, 100)).toBeCloseTo(SPROUT_GROWTH)
    expect(growthFromSun(0, 130, 100)).toBeCloseTo(SPROUT_GROWTH + 30)
    expect(growthFromSun(150, 10, 400)).toBeCloseTo(160)
    expect(growthFromSun(150, 10, 400, 2)).toBeCloseTo(155)
    expect(growthFromSun(0, 130, 100, 2)).toBeCloseTo(SPROUT_GROWTH + 15)
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

describe('stage progress', () => {
  it('says the stage and how far it is to the next one', () => {
    expect(stageProgress(0)).toMatchObject({ stage: 'Seed', next: 'Sprout', goal: 20, share: 0 })
    expect(stageProgress(60)).toMatchObject({ stage: 'Sprout', next: 'Young plant', goal: 100, share: 0.5 })
    expect(stageProgress(300)).toMatchObject({ stage: 'Mature', next: 'Flowering', goal: 700, share: 0 })
  })

  it('has nothing further to reach once flowering', () => {
    expect(stageProgress(900)).toMatchObject({ stage: 'Flowering', next: null, goal: null, share: 1 })
  })
})

describe('species from seeds', () => {
  const seeds = Array.from({ length: 4000 }, (_, i) => i * 7 + 3)
  const bromeliads = new Set(BROMELIADS.map((species) => species.id))

  it('spreads common seeds evenly over the common groups', () => {
    const groups = ['monstera', 'philodendron', 'pothos', 'alocasia', 'anthurium', 'begonia', 'calathea', 'hoya', 'syngonium', 'peperomia']
    for (const seed of seeds) expect(speciesFromSeed(seed).id).toBe(groups[seed % 10])
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

describe('breeding', () => {
  const deliciosa = { ...makeGenome('monstera', 101, 'common', 'deliciosa'), variegation: 'none' as const }
  const adansonii = { ...makeGenome('monstera', 102, 'common', 'adansonii'), variegation: 'none' as const }
  const peru = { ...makeGenome('monstera', 103, 'common', 'karstenii'), variegation: 'none' as const }
  const pothos = makeGenome('pothos', 104, 'common')
  const seeds = Array.from({ length: 3000 }, (_, i) => i * 13 + 5)
  const variegated = (kind: 'marbled' | 'albo', genome = deliciosa) => ({ ...genome, variegation: kind })

  it('makes about half of all plants female, fixed by their seed', () => {
    const share = seeds.filter((seed) => sexOf(makeGenome('monstera', seed, 'common')) === 'female').length / seeds.length
    expect(share).toBeGreaterThan(0.45)
    expect(share).toBeLessThan(0.55)
  })

  it('keeps the sex of the parent in a cutting', () => {
    for (const seed of seeds.slice(0, 50)) expect(sexOf(cuttingGenome(deliciosa, seed))).toBe(sexOf(deliciosa))
  })

  it('charges more for crossing two varieties', () => {
    expect(pollinationCost(deliciosa, makeGenome('monstera', 9, 'common', 'deliciosa'))).toBe(REWARDS.pollinateSameVariety)
    expect(pollinationCost(deliciosa, adansonii)).toBe(REWARDS.pollinateSameGroup)
  })

  it('only crosses flowering plants of one group and opposite sex', () => {
    const female = { genome: { ...deliciosa, sex: 'female' as const }, growth: 700 }
    const male = { genome: { ...adansonii, sex: 'male' as const }, growth: 700 }
    expect(pollinationProblem(female, male)).toBeNull()
    expect(pollinationProblem(female, female)).toContain('Both are female')
    expect(pollinationProblem(female, { ...male, growth: 699 })).toContain('flowering')
    expect(pollinationProblem(female, { genome: { ...pothos, sex: 'male' as const }, growth: 700 })).toContain('different groups')
    expect(pollinationProblem(female, { ...male, restLeft: 10 })).toContain('resting')
  })

  it('is the same from the same seed, and keeps the group', () => {
    expect(crossGenomes(deliciosa, adansonii, 77)).toEqual(crossGenomes(deliciosa, adansonii, 77))
    const varieties = new Set(seeds.map((seed) => crossGenomes(deliciosa, adansonii, seed).variety))
    expect([...varieties].sort()).toEqual(['adansonii', 'deliciosa'])
  })

  it('makes a cross a lottery that the soil can improve', () => {
    const took = (help: number) => seeds.filter((seed) => crossGenomes(deliciosa, adansonii, seed, { crossing: help }).crossed).length / seeds.length
    expect(took(0)).toBeGreaterThan(0.2)
    expect(took(0)).toBeLessThan(0.3)
    expect(took(0.4)).toBeGreaterThan(0.58)
    expect(crossChance(deliciosa, adansonii, 5)).toBe(0.92)
  })

  it('gives a failed cross only a plain plant, even from variegated parents', () => {
    const children = seeds.map((seed) => crossGenomes(variegated('marbled'), variegated('albo', adansonii), seed))
    const failed = children.filter((child) => !child.crossed)
    expect(failed.length).toBeGreaterThan(1000)
    expect(failed.every((child) => child.variegation === 'none')).toBe(true)
    expect(children.some((child) => child.variegation !== 'none')).toBe(true)
  })

  it('gives splits only to varieties that have them', () => {
    for (const seed of seeds.slice(0, 300)) {
      const child = crossGenomes(deliciosa, peru, seed)
      if (child.variety === 'karstenii') expect(child.fenestration).toBe(0)
      else expect(child.fenestration).toBeGreaterThan(0)
    }
  })

  it('needs soil for a mutation out of plain parents', () => {
    const share = (mutation: number) => seeds.filter((seed) => crossGenomes(deliciosa, adansonii, seed, { mutation, crossing: 0.5 }).variegation !== 'none').length / seeds.length
    expect(share(0)).toBeLessThan(0.005)
    expect(share(0.05)).toBeGreaterThan(share(0))
  })

  it('clones with a plain cutting; a sport needs soil', () => {
    expect(cuttingGenome(variegated('albo'), 5).variegation).toBe('albo')
    const clones = seeds.map((seed) => cuttingGenome(deliciosa, seed))
    expect(clones.every((clone) => clone.species === 'monstera' && clone.hue === deliciosa.hue)).toBe(true)
    expect(clones.filter((clone) => clone.variegation !== 'none').length / clones.length).toBeLessThan(0.005)
    const helped = seeds.map((seed) => cuttingGenome(deliciosa, seed, { mutation: 0.05 }))
    expect(helped.filter((clone) => clone.variegation !== 'none').length / helped.length).toBeGreaterThan(0.03)
  })

  it('passes more variegated leaves on through a variegated leaf, in more colours', () => {
    const child = cuttingGenome(deliciosa, 7, { leaf: 'albo' })
    expect(child.variegation).toBe('albo')
    expect(child.leafSpread).toBeGreaterThan(0.1)
    const grandchild = cuttingGenome(child, 8, { leaf: 'albo' })
    expect(grandchild.leafSpread).toBeGreaterThan(child.leafSpread!)
    const palettes = seeds.slice(0, 200).map((seed) => cuttingGenome(child, seed, { leaf: 'albo' }).palette!.length)
    expect(Math.max(...palettes)).toBeGreaterThan(1)
    expect(cuttingGenome(child, 9, { leaf: 'none' }).leafSpread).toBeLessThan(child.leafSpread!)
  })
})

describe('leaves', () => {
  const plant = { ...makeGenome('monstera', 101, 'common', 'deliciosa'), variegation: 'none' as const }
  const rng = () => createRng(5)

  it('cuts only open leaves, a few at a time, and leaves the plant some', () => {
    expect(cutProblem(plant, NO_LEAF_STATE, 299, 0)).toContain('growth')
    expect(cutProblem(plant, NO_LEAF_STATE, 300, 0)).toBeNull()
    expect(cutProblem(plant, NO_LEAF_STATE, 300, 15)).toContain('not open')
    const cut = cutLeaf(plant, NO_LEAF_STATE, 300, 0)
    expect(cutProblem(plant, cut, 300, 0)).toContain('regrowing')
    const full = [1, 2].reduce((state, index) => cutLeaf(plant, state, 300, index), cut)
    expect(cutProblem(plant, full, 300, 3)).toContain('already regrowing')
  })

  it('finishes the started leaf first, then regrows, and only then the plant grows on', () => {
    const cut = cutLeaf(plant, NO_LEAF_STATE, 300, 0)
    const waiting = regrowLeaves(plant, cut, 10, 300, true, 0, rng())
    expect(waiting.left).toBe(10)
    expect(waiting.state.regrown).toBe(0)
    const later = growthPastGate(plant, cut.queue[0].gate)
    const partly = regrowLeaves(plant, cut, 10, later, true, 0, rng())
    expect(partly.left).toBe(0)
    expect(regrowthOf(partly.state, 0)).toBeCloseTo(10 / REWARDS.leafRegrowSun)
    const done = regrowLeaves(plant, partly.state, 50, later, true, 0, rng())
    expect(done.state.queue).toHaveLength(0)
    expect(done.left).toBeCloseTo(30)
    expect(regrowthOf(done.state, 0)).toBe(1)
  })

  it('regrows in the greenhouse from studying alone', () => {
    const cut = cutLeaf(plant, NO_LEAF_STATE, 300, 0)
    expect(regrowLeaves(plant, cut, REWARDS.leafRegrowSun, 300, false, 0, rng()).state.queue).toHaveLength(0)
  })

  it('does not promise a variegated leaf back', () => {
    const full = { ...plant, variegation: 'albo' as const }
    const cut = cutLeaf(full, NO_LEAF_STATE, 300, 0)
    const back = Array.from({ length: 300 }, (_, i) => regrowLeaves(full, cut, REWARDS.leafRegrowSun, 300, false, 0, createRng(i)).state.marks[0])
    expect(back).toContain('none')
    expect(back).toContain('albo')
  })

  it('gives each new leaf its colour once, by the spread of its plant', () => {
    const spotty = { ...plant, variegation: 'albo' as const, leafSpread: 0.5, palette: ['albo' as const] }
    const state = rollNewLeaves(spotty, NO_LEAF_STATE, 0, 700, 0, rng())
    const kinds = Object.values(state.marks)
    expect(kinds).toContain('none')
    expect(kinds.some((kind) => kind !== 'none')).toBe(true)
    expect(rollNewLeaves(spotty, state, 700, 700, 0, rng())).toBe(state)
    const plainLeaves = Array.from({ length: 200 }, (_, i) => Object.values(rollNewLeaves(plant, NO_LEAF_STATE, 0, 700, 0, createRng(i)).marks)).flat()
    expect(plainLeaves.filter((kind) => kind !== 'none').length).toBeLessThan(15)
  })
})

describe('garden beds', () => {
  it('touch in the four directions only', () => {
    const middle = { x: 0, y: 0 }
    for (const next of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) expect(bedsTouch(middle, next)).toBe(true)
    expect(bedsTouch(middle, { x: 1, y: 1 })).toBe(false)
    expect(bedsTouch(middle, middle)).toBe(false)
    expect(bedsTouch(middle, { x: 2, y: 0 })).toBe(false)
  })

  it('cost a little more each time', () => {
    expect([1, 2, 3, 4].map(bedCost)).toEqual([300, 400, 500, 600])
  })
})

describe('soil', () => {
  it('fixes the kinds of effect by ingredient and wobbles only a little', () => {
    const recipe = { humus: 5, perlite: 5 }
    const target = recipeStats(recipe)
    expect(target.speed).toBeCloseTo(0.1)
    expect(target.cuttings).toBeCloseTo(0.25)
    expect(target.mutation).toBe(0)
    for (let seed = 0; seed < 100; seed += 1) {
      const mix = mixStats(recipe, createRng(seed))
      expect(mix.mutation).toBe(0)
      expect(Math.abs(mix.speed / target.speed - 1)).toBeLessThanOrEqual(SOIL_WOBBLE)
    }
    expect(mixStats(recipe, createRng(1)).speed).not.toBe(mixStats(recipe, createRng(2)).speed)
  })

  it('sells only bags, the big one cheaper by the litre', () => {
    const bark = ingredientById('bark')!
    expect(bagPrice(bark, 3)).toBe(Infinity)
    expect(bagPrice(bark, 20) / 20).toBeLessThan(bagPrice(bark, 5) / 5)
  })

  it('keeps the old pots where they were', () => {
    expect(POT_DESIGNS[0].color).toBe('#2e6e7e')
    expect(POT_DESIGNS[GOLD_POT].name).toBe('Gold glaze')
    expect(POT_DESIGNS.length).toBeGreaterThan(30)
    expect(new Set(POT_DESIGNS.map((pot) => pot.name)).size).toBe(POT_DESIGNS.length)
  })
})

describe('weekly goals', () => {
  const task = (doneCount: number, timesPerWeek = 1) => ({ id: doneCount + timesPerWeek, title: 't', timesPerWeek, doneCount, reward: { kind: 'sun' as const, rarity: 'common' as const } })

  it('starts weeks on Monday', () => {
    expect(weekKey(new Date(2026, 10, 8))).toBe('2026-11-02')
    expect(weekKey(new Date(2026, 10, 9))).toBe('2026-11-09')
    expect(weekKey(new Date(2026, 10, 8, 23, 59, 59))).toBe('2026-11-02')
    expect(weekKey(new Date(2026, 10, 9, 0, 0, 0))).toBe('2026-11-09')
    expect(weekKey(new Date(2026, 10, 2))).toBe('2026-11-02')
  })

  it('reaches goals by hours, and asks for tasks as well to complete the week', () => {
    const studied = buildWeek('w', { focusMinutes: 600, studyDays: 2, answers: 0 }, [task(1), task(1, 2)])
    expect(studied.goals.find((goal) => goal.id === 'study-10h')!.reached).toBe(true)
    expect(studied.goals.find((goal) => goal.id === 'study-20h')!.reached).toBe(false)
    expect(studied.complete.reached).toBe(false)
    expect(buildWeek('w', { focusMinutes: 600, studyDays: 2, answers: 0 }, [task(1), task(2, 2)]).complete.reached).toBe(true)
    expect(buildWeek('w', { focusMinutes: 300, studyDays: 2, answers: 0 }, [task(1)]).complete.reached).toBe(false)
  })

  it('keeps the top rewards rare seeds that grow bromeliads', () => {
    const seed = bromeliadSeed(createRng(4))
    expect(speciesFromSeed(seed, 'rare').rare).toBe(true)
    const weeks = Array.from({ length: 200 }, (_, i) => weekKey(new Date(2026, 10, 9 + i * 7)))
    const rewards = weeks.map(weekCompleteReward)
    expect(new Set(rewards.map((reward) => `${reward.kind}${reward.bromeliad ?? ''}`)).size).toBe(WEEK_COMPLETE_REWARDS.length)
    expect(rewards.every((reward) => reward.rarity === 'rare')).toBe(true)
    expect(weekCompleteReward('2026-11-09')).toEqual(weekCompleteReward('2026-11-09'))
    expect(WEEK_COMPLETE.title).toContain('all tasks')
    expect(WEEK_GOALS.find((goal) => goal.id === 'study-30h')!.reward.bromeliad).toBe(true)
  })
})

describe('calendar', () => {
  const exam = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: 1, title: 'Biotech', date: '2026-11-26', kind: 'exam', courseId: null, grade: null, time: null, topic: null, effort: null, ...over })
  const state = (over: Partial<CalendarState> = {}): CalendarState => ({ events: [], todos: [], topics: [], settings: DEFAULT_CALENDAR_SETTINGS, ...over })

  it('builds a month of six Monday-first weeks', () => {
    const days = monthDays(2026, 10)
    expect(days).toHaveLength(42)
    expect(days[0]).toBe('2026-10-26')
    expect(new Date(days[0]).getUTCDay()).toBe(1)
    expect(days).toContain('2026-11-30')
  })

  it('counts days across month ends and the clock change', () => {
    expect(daysBetween('2026-11-08', '2026-11-26')).toBe(18)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetween('2026-11-08', '2026-11-08')).toBe(0)
  })

  it('rewards better grades more, and a 5 gives nothing', () => {
    expect(GRADE_REWARDS[5]).toEqual([])
    for (const grade of [1, 2, 3, 4]) expect(GRADE_REWARDS[grade].length).toBeGreaterThan(0)
    expect(GRADE_REWARDS[1].length).toBeGreaterThan(GRADE_REWARDS[2].length)
    expect(GRADE_REWARDS[1].some((reward) => reward.bromeliad)).toBe(true)
  })

  it('takes a grade only from the exam day on, and only once', () => {
    expect(canEnterGrade(exam(), '2026-11-25')).toBe(false)
    expect(canEnterGrade(exam(), '2026-11-26')).toBe(true)
    expect(canEnterGrade(exam({ grade: 2 }), '2026-12-01')).toBe(false)
    expect(canEnterGrade(exam({ kind: 'event' }), '2026-12-01')).toBe(false)
  })

  it('briefs at most three things, without any overdue wording', () => {
    const items = buildBriefing(
      state({
        events: [exam(), exam({ id: 2, title: 'Mykologie', date: '2026-11-29' })],
        todos: [{ id: 1, title: 'Altes To-do', due: '2026-11-01', doneAt: null, topic: null, effort: null, effortLevel: null }, { id: 2, title: 'Wäsche', due: '2026-11-08', doneAt: null, topic: null, effort: null, effortLevel: null }],
      }),
      [{ id: 1, name: 'Bio', fresh: 10, ready: 5 }],
      '2026-11-08',
    )
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.text).join(' ').toLowerCase()).not.toMatch(/overdue|late|behind|missed/)
    expect(items[0].text).toContain('Biotech')
    expect(items[2].todoId).toBe(1)
  })

  describe('exam time', () => {
    const timed = exam({ time: '09:00', courseId: 1 })

    it('is over after its time, or after its day when it has none', () => {
      expect(examOver(timed, '2026-11-25', '23:00')).toBe(false)
      expect(examOver(timed, '2026-11-26', '08:59')).toBe(false)
      expect(examOver(timed, '2026-11-26', '09:00')).toBe(true)
      expect(examOver(timed, '2026-11-27', '00:00')).toBe(true)
      expect(examOver(exam(), '2026-11-26', '23:59')).toBe(false)
      expect(examOver(exam(), '2026-11-27', '00:00')).toBe(true)
      expect(examOver(exam({ kind: 'deadline', time: '09:00' }), '2026-12-01', '10:00')).toBe(false)
    })

    it('takes the grade only after the time', () => {
      expect(canEnterGrade(timed, '2026-11-26', '08:59')).toBe(false)
      expect(canEnterGrade(timed, '2026-11-26', '09:00')).toBe(true)
      expect(canEnterGrade(exam(), '2026-11-26', '08:00')).toBe(true)
    })

    it('greys a course out when all its exams are written, and a retake brings it back', () => {
      expect(courseOver(1, [timed], '2026-11-26', '08:00')).toBe(false)
      expect(courseOver(1, [timed], '2026-11-26', '10:00')).toBe(true)
      expect(courseOver(1, [timed, exam({ id: 2, date: '2027-02-01', courseId: 1 })], '2026-11-26', '10:00')).toBe(false)
      expect(courseOver(1, [], '2026-11-26', '10:00')).toBe(false)
      expect(courseOver(2, [timed], '2026-11-26', '10:00')).toBe(false)
    })

    it('stops counting the exam down afterwards and asks for the grade instead', () => {
      const courses = [{ id: 1, name: 'Bio', fresh: 3, ready: 3 }]
      const before = buildBriefing(state({ events: [timed] }), courses, '2026-11-26', '08:00')
      expect(before[0].text).toContain('exam today at 09:00')
      const after = buildBriefing(state({ events: [timed] }), courses, '2026-11-26', '10:00').map((item) => item.text)
      expect(after.join(' ')).not.toContain('exam today')
      expect(after.join(' ')).toContain('Got your grade')
      expect(after.join(' ')).not.toContain('ready in Bio')
    })

    it('congratulates once when it is over', () => {
      const notes = dueNotifications(state({ events: [timed] }), '2026-11-26', '10:00', new Set(['briefing:2026-11-26']))
      expect(notes.map((note) => note.key)).toEqual(['exam-over:1'])
      expect(dueNotifications(state({ events: [timed] }), '2026-11-26', '10:00', new Set(['briefing:2026-11-26', 'exam-over:1']))).toEqual([])
    })

    it('holds an exam topic open until the grade decides', () => {
      const topic = { id: 1, name: 'Thesis', finishesWith: 'exam' as const, effort: null, effortLevel: null, completedAt: null }
      expect(buildTopicView(topic, [exam({ topic: 'Thesis', time: '09:00' })], [], '2026-11-26', '10:00').ready).toBe(false)
      expect(buildTopicView(topic, [exam({ topic: 'Thesis', time: '09:00' })], [], '2026-11-26', '08:00').state).toContain('Exam on')
    })
  })

  describe('topics', () => {
    const todo = (id: number, done: boolean, effort: number | null = null) => ({ id, title: 't', due: null, doneAt: done ? 1 : null, topic: 'Thesis', effort, effortLevel: null })
    const view = (finishesWith: FinishesWith, events: CalendarEvent[], todos: ReturnType<typeof todo>[], completedAt: number | null = null) =>
      buildTopicView({ id: 1, name: 'thesis', finishesWith, effort: 30, effortLevel: null, completedAt }, events, todos)
    const ownExam = (over: Partial<CalendarEvent>) => exam({ topic: 'Thesis', ...over })

    it('can be completed when all todos are done', () => {
      expect(view('subtasks', [], []).ready).toBe(false)
      expect(view('subtasks', [], [todo(1, true), todo(2, false)]).missing).toEqual(['1 todo still open'])
      expect(view('subtasks', [], [todo(1, true), todo(2, true)]).ready).toBe(true)
    })

    it('needs the exam passed and the todos done, not just one of them', () => {
      expect(view('exam', [], []).ready).toBe(false)
      expect(view('exam', [ownExam({ grade: 2 })], [todo(1, false)]).ready).toBe(false)
      expect(view('exam', [ownExam({})], [todo(1, true)]).ready).toBe(false)
      expect(view('exam', [ownExam({ grade: 4 })], [todo(1, true)]).ready).toBe(true)
      expect(view('exam', [ownExam({ grade: 2 })], []).ready).toBe(true)
    })

    it('stays open after a 5, until a retake is passed', () => {
      const failed = view('exam', [ownExam({ grade: 5 })], [])
      expect(failed.ready).toBe(false)
      expect(failed.state).toContain('Retake')
      expect(view('exam', [ownExam({ grade: 5 }), ownExam({ id: 2, grade: 2, date: '2027-02-01' })], []).ready).toBe(true)
      expect(view('exam', [exam({ kind: 'deadline', topic: 'Thesis', grade: 1 })], []).ready).toBe(false)
    })

    it('waits for the grade after the exam is written', () => {
      const written = buildTopicView({ id: 1, name: 'Thesis', finishesWith: 'exam', effort: null, effortLevel: null, completedAt: null }, [exam({ topic: 'Thesis', time: '09:00' })], [], '2026-11-26', '10:00')
      expect(written.ready).toBe(false)
      expect(written.state).toContain('waiting for your grade')
      expect(written.missing).toEqual(['Grade not entered yet'])
    })

    it('can never be completed when set to never, and not twice', () => {
      expect(view('never', [], [todo(1, true)]).ready).toBe(false)
      expect(view('subtasks', [], [todo(1, true)], 123).ready).toBe(false)
    })

    it('adds up the open effort, leaving out what is done', () => {
      expect(view('subtasks', [ownExam({ effort: 10 })], [todo(1, false, 2.5), todo(2, true, 4)]).effortOpen).toBe(12.5)
    })

    it('pays far more for finishing a topic than for its todos, scaling with effort', () => {
      expect(todoSun(null)).toBe(2)
      expect(todoSun(2)).toBe(6)
      expect(todoSun(5)).toBe(12)
      expect(todoSun(10)).toBe(22)
      expect(todoSun(100)).toBe(REWARDS.todoMaxSun)
      expect(topicReward(150).sun).toBe(1500)
      expect(topicReward(null).sun).toBe(REWARDS.topicMinSun)
      expect(topicReward(30).sun).toBe(300)
      expect(topicReward(1000).sun).toBe(REWARDS.topicMaxSun)
      expect(topicReward(3).items).toHaveLength(1)
      expect(topicReward(10).items[0].rarity).toBe('uncommon')
      expect(topicReward(30).items[0].rarity).toBe('rare')
      expect(topicReward(100).items.some((item) => item.bromeliad)).toBe(true)
      expect(topicReward(100).items.some((item) => item.gold)).toBe(true)
    })
  })

  it('lets a size stand in for hours and pay what those hours would', () => {
    expect(resolveEffort(TODO_LEVELS, null, 'big')).toEqual({ effort: 5, level: 'big' })
    expect(resolveEffort(TOPIC_LEVELS, 99, 'medium')).toEqual({ effort: 10, level: 'medium' })
    expect(resolveEffort(TODO_LEVELS, 2.5, null)).toEqual({ effort: 2.5, level: null })
    expect(resolveEffort(TODO_LEVELS, 2, 'unknown')).toEqual({ effort: 2, level: null })
    expect(TODO_LEVELS.map((level) => todoSun(level.hours))).toEqual([4, 8, 12, 22])
    const rewards = TOPIC_LEVELS.map((level) => topicReward(level.hours))
    expect(rewards.map((reward) => reward.sun)).toEqual([30, 100, 300, 600, 1500])
    expect(rewards[3].items.some((item) => item.gold)).toBe(true)
  })

  it('pays the same for a main topic, whatever completes it', () => {
    const base = { id: 1, name: 'A', effort: 30, effortLevel: null, completedAt: null }
    const reward = (extra: Partial<TopicRow>) => buildTopicView({ ...base, finishesWith: 'subtasks', ...extra }, [], []).reward
    expect(reward({ pinned: true })).toEqual(reward({ pinned: false }))
    expect(reward({ finishesWith: 'exam' })).toEqual(reward({ finishesWith: 'subtasks' }))
  })

  it('reads effort as typed, with a comma or a point, and ignores anything else', () => {
    expect(parseEffort('2,5')).toBe(2.5)
    expect(parseEffort('2.5')).toBe(2.5)
    expect(parseEffort(' 3 ')).toBe(3)
    for (const nothing of ['', 'viel', '0', '-1']) expect(parseEffort(nothing)).toBeNull()
    expect(effortText(2.5)).toBe('2,5 h')
  })

  it('links a typed topic to a course of the same name only', () => {
    const courses = [{ id: 1, name: 'Biochemische Übungen' }]
    expect(courseForTopic(' biochemische übungen ', courses)?.id).toBe(1)
    expect(courseForTopic('Thesis', courses)).toBeUndefined()
    expect(courseForTopic(null, courses)).toBeUndefined()
    expect(courseForTopic('  ', courses)).toBeUndefined()
  })

  it('treats a deadline like an exam for reminders and the briefing, but never asks for a grade', () => {
    const deadline = exam({ kind: 'deadline', title: 'Protokoll', date: '2026-11-11' })
    expect(canEnterGrade(deadline, '2026-12-01')).toBe(false)
    const notes = dueNotifications(state({ events: [deadline] }), '2026-11-08', '09:00', new Set())
    expect(notes[1].body).toBe('Deadline in 3 days.')
    expect(buildBriefing(state({ events: [deadline] }), [], '2026-11-08')[0].text).toContain('Protokoll: deadline in 3 days')
  })

  it('keeps the pinned topic in the briefing every day, behind only an exam within days', () => {
    const thesis = buildTopicView({ id: 9, name: 'Bachelorarbeit', finishesWith: 'subtasks', effort: 200, effortLevel: null, completedAt: null, pinned: true, workedMinutes: 750 }, [], [
      { id: 1, title: 'Methoden', due: null, doneAt: 1, topic: 'Bachelorarbeit', effort: null, effortLevel: null },
      { id: 2, title: 'Diskussion', due: null, doneAt: null, topic: 'Bachelorarbeit', effort: null, effortLevel: null },
    ])
    expect(buildBriefing(state({ topics: [thesis] }), [], '2026-11-08')[0].text).toBe('Bachelorarbeit: 1 of 2 todos open, 12 h 30 worked.')
    const soon = exam({ date: '2026-11-09' })
    const far = exam({ id: 2, date: '2026-11-25', title: 'Später' })
    const briefing = buildBriefing(state({ topics: [thesis], events: [soon, far] }), [], '2026-11-08').map((item) => item.text)
    expect(briefing[0]).toContain('Biotech')
    expect(briefing[1]).toContain('Bachelorarbeit')
    expect(briefing[2]).toContain('Später')
    const done = { ...thesis, completedAt: 5 }
    expect(buildBriefing(state({ topics: [done] }), [], '2026-11-08').map((item) => item.text).join()).not.toContain('Bachelorarbeit')
    const empty = buildTopicView({ id: 9, name: 'Bachelorarbeit', finishesWith: 'subtasks', effort: 200, effortLevel: null, completedAt: null, pinned: true }, [], [])
    expect(buildBriefing(state({ topics: [empty] }), [], '2026-11-08')[0].text).toContain('next step')
  })

  it('works out a pace from what is left, and hides it when nothing is', () => {
    expect(paceText(30, 10)).toContain('about 3 a day')
    expect(paceText(31, 10)).toContain('about 4 a day')
    expect(paceText(5, 0)).toContain('about 5 a day')
    expect(paceText(0, 10)).toBeNull()
  })

  it('notifies from the briefing time on, once per thing, and can be turned off', () => {
    const withExam = state({ events: [exam({ date: '2026-11-11' })] })
    expect(dueNotifications(withExam, '2026-11-08', '07:59', new Set())).toEqual([])
    const notes = dueNotifications(withExam, '2026-11-08', '08:00', new Set())
    expect(notes.map((note) => note.key)).toEqual(['briefing:2026-11-08', 'exam:1:3'])
    expect(dueNotifications(withExam, '2026-11-08', '09:00', new Set(notes.map((note) => note.key)))).toEqual([])
    expect(dueNotifications({ ...withExam, settings: { ...DEFAULT_CALENDAR_SETTINGS, notifications: false } }, '2026-11-08', '09:00', new Set())).toEqual([])
    expect(dueNotifications(state({ events: [exam({ date: '2026-11-13' })] }), '2026-11-08', '09:00', new Set()).map((note) => note.key)).toEqual(['briefing:2026-11-08'])
  })
})

describe('time spent', () => {
  it('reads the ways time gets typed', () => {
    expect(parseDuration('1,5')).toBe(90)
    expect(parseDuration('1.25')).toBe(75)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('90 min')).toBe(90)
    expect(parseDuration('45m')).toBe(45)
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('1 h 30')).toBe(90)
    expect(parseDuration('1h 30m')).toBe(90)
    expect(parseDuration('')).toBe(null)
    expect(parseDuration('0')).toBe(null)
    expect(parseDuration('abc')).toBe(null)
    expect(durationInput(80)).toBe('1:20')
  })

  const topic = (id: number, name: string, completedAt: number | null = null, pinned = false) =>
    buildTopicView({ id, name, finishesWith: 'subtasks', effort: 10, effortLevel: null, completedAt, pinned }, [], [])
  const todo = (id: number, topicName: string | null, effort: number | null, done: boolean, spentMinutes: number | null, trackedMinutes: number) => ({
    id, title: `t${id}`, due: null, doneAt: done ? 1 : null, topic: topicName, effort, effortLevel: null, spentMinutes, trackedMinutes,
  })

  it('sums planned against real time per topic, open topics first and done todos last', () => {
    const groups = buildTimeTable({
      topics: [topic(1, 'Alt', 5), topic(2, 'Thesis', null, true), topic(3, 'Labor')],
      todos: [
        todo(1, 'Thesis', 2, true, 150, 40),
        todo(2, 'thesis', 3, false, null, 61.7),
        todo(3, 'Alt', 1, true, null, 30),
        todo(4, null, null, false, null, 0),
        todo(5, 'Gelöscht', 1, false, null, 10),
      ],
      looseMinutes: [{ task: 'Thesis', minutes: 20 }, { task: 'Study time', minutes: 15 }, { task: '', minutes: 5 }],
    })
    expect(groups.map((group) => group.name)).toEqual(['Thesis', 'Labor', 'No topic', 'Alt'])
    const thesis = groups[0]
    expect(thesis.todos.map((row) => row.id)).toEqual([2, 1])
    expect(thesis.plannedMinutes).toBe(300)
    // Entered time replaces the timer for a done todo; open ones go by the timer.
    expect(thesis.spentMinutes).toBe(150 + 61 + 20)
    expect(thesis.todos[1].entered).toBe(true)
    expect(groups[2].todos.map((row) => row.id)).toEqual([4, 5])
    expect(groups[2].looseMinutes).toBe(20)
    expect(groups[3]).toMatchObject({ completed: true, spentMinutes: 30, plannedMinutes: 60 })
  })
})
