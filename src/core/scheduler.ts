import { DefaultScheduler } from 'ts-fsrs'

/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type ReviewRating = 1 | 2 | 3 | 4

export interface ScheduledCard {
  /** Stored as is and handed back on the next review. */
  state: string
  dueAt: number
  stability: number
}

export type Scheduler = Awaited<ReturnType<typeof createScheduler>>

export async function createScheduler() {
  const scheduler = await DefaultScheduler({ desiredRetention: 0.9, enableFuzz: true })

  return {
    review(stored: string | null, rating: ReviewRating, now: Date): ScheduledCard {
      const card = stored ? rehydrate(stored) : scheduler.newCard({ now })
      const result = scheduler.review({ card, grade: rating, now })
      return {
        state: JSON.stringify(result.card),
        dueAt: new Date(result.card.dueAt).getTime(),
        stability: result.card.stability,
      }
    },
  }

  function rehydrate(stored: string) {
    const card = JSON.parse(stored)
    return {
      ...card,
      dueAt: new Date(card.dueAt),
      lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null,
    }
  }
}
