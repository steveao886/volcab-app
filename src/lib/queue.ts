import { addDays, INITIAL_EASE, todayStr } from './srs'
import type { Progress, Word } from '../types'

export interface DailyQueue { due: string[]; fresh: string[] }

/**
 * Likelihood of encountering the word, defaulting to 0.
 *
 * **Unscored doesn't mean high-frequency**, so the default has to sort last, not somewhere
 * in the middle: every word that went through the completion pipeline has a score, and
 * unscored words are either legacy data or pushed in from elsewhere — something we're
 * unsure about shouldn't jump the queue.
 */
const score = (w: Word): number => w.usageScore ?? 0

export function buildQueue(words: Word[], progress: Progress, today: string): DailyQueue {
  const byId = new Map(words.map(w => [w.id, w]))
  const due = words
    .filter(w => {
      const e = progress.words[w.id]
      return e && e.state !== 'new' && e.due <= today
    })
    .map(w => w.id)
    .sort((a, b) => {
      const ea = progress.words[a], eb = progress.words[b]
      if (ea.state !== eb.state) return ea.state === 'learning' ? -1 : 1
      if (ea.due !== eb.due) return ea.due < eb.due ? -1 : 1
      // The final tiebreaker changed from alphabetical to likelihood of encountering the
      // word: by this point the two words have identical learning state and due date, so
      // either order is equally valid under SRS — which means the more commonly used one
      // should go first. When a session isn't finished, this ordering decides what you
      // actually end up reviewing today. Alphabetical order carries zero information here.
      const d = score(byId.get(b)!) - score(byId.get(a)!)
      return d !== 0 ? d : a.localeCompare(b)  // Only fall back to alphabetical when scores also tie, to guarantee determinism
    })

  const learnedToday = progress.dailyStats[today]?.newLearned ?? 0
  const budget = Math.max(0, progress.settings.newPerDay - learnedToday)
  // New words are taken in descending order of encounter likelihood, not word-list array
  // order. Only newPerDay words get learned each day, so which ones get picked directly
  // decides the return on that investment — whether formidable (8 points) or criticality
  // (2 points) gets learned first shouldn't be decided by which entered the word list
  // first. When scores tie, the word list's original order is preserved (via a stable sort
  // on index below), with no gratuitous shuffling.
  const fresh = words
    .filter(w => !progress.words[w.id] || progress.words[w.id].state === 'new')
    .map((w, i) => ({ w, i }))
    .sort((a, b) => score(b.w) - score(a.w) || a.i - b.i)
    .slice(0, budget)
    .map(x => x.w.id)

  return { due, fresh }
}

/** How many words a max a dedicated lapse-word session brings in at once. 20 is roughly what one sitting can clear. */
export const LAPSE_SESSION_SIZE = 20

/**
 * How long a practice miss keeps a word in the drill.
 *
 * Practice surfaces stamp `missedAt` and nothing else (see
 * ProgressEntry.missedAt for why they stopped writing `due`), so this queue
 * is the only thing that acts on a miss — without it a quiz error would
 * vanish into the statistics.
 *
 * A week rather than a day: quiz volume is uneven, one week measured on the
 * live library ran from 1 session to 17, and a one-day window would drop
 * every miss made on a day the drill wasn't opened. It is a ceiling, not a
 * sentence — answering the word correctly in the drill clears `missedAt`
 * immediately.
 */
export const MISS_RECENCY_DAYS = 7

/**
 * The interval at which a word counts as known and stops being "stubborn".
 *
 * 21 days is the conventional young/mature boundary in spaced repetition
 * (it is Anki's default), not a number picked here. The point is that it
 * has to be *some* threshold: ease only ever recovers on "easy" (srs.ts),
 * so a word carried out to long intervals on "good" grades alone keeps its
 * dented ease forever — without this second exit, a single slip in July
 * keeps a word on the struggling list in September, however well it is
 * held by then.
 */
export const MATURE_INTERVAL_DAYS = 21

/**
 * How long after learning a word the consolidation pass opens.
 *
 * The two learning steps (see LEARNING_STEPS in srs.ts) both land inside a
 * single sitting — they requeue by queue position, not by clock — so a new
 * word is retrieved two or three times within a few minutes and then not
 * again until tomorrow. Those closely-spaced retrievals are the cheap
 * ones; the durable gain comes from getting the word back after it has had
 * time to fade.
 *
 * Three hours is chosen to be unambiguously a *second* sitting rather than
 * a continuation of the first, while still leaving room for an evening
 * pass on words learned in the morning. It is a judgement call, not a
 * figure read off a study.
 */
export const CONSOLIDATE_DELAY_HOURS = 3

/** Consolidation is for words that are still fragile: anything scheduled further out than tomorrow has already been answered well enough not to need it. */
export const CONSOLIDATE_MAX_INTERVAL_DAYS = 1

/**
 * The words learned today that are ready for a second pass.
 *
 * Deliberately **not** a general "reopen review every few hours": mature
 * words gain almost nothing from being retested the same day, and drilling
 * them is what pushed a word out to a 273-day interval before
 * recordLapseDrill existed. This queue only ever contains words whose next
 * review is tomorrow or sooner — new words from today, plus any word that
 * lapsed back to square one today.
 *
 * Ordered oldest-first: the word learned at breakfast has had the longest
 * to fade, so it is the one whose retrieval is worth the most.
 *
 * No cap. The set is already bounded by how much was learned today, and
 * truncating it would silently drop words the user has every reason to
 * expect.
 */
export function buildConsolidateQueue(words: Word[], progress: Progress, now: Date, today: string): string[] {
  const readyBefore = now.getTime() - CONSOLIDATE_DELAY_HOURS * 3600_000
  return words
    .filter(w => {
      const e = progress.words[w.id]
      if (!e || e.state === 'new') return false
      if (e.intervalDays > CONSOLIDATE_MAX_INTERVAL_DAYS) return false
      const last = new Date(e.lastReviewedAt)
      if (todayStr(last) !== today) return false
      return last.getTime() <= readyBefore
    })
    .sort((a, b) => {
      const la = progress.words[a.id].lastReviewedAt, lb = progress.words[b.id].lastReviewedAt
      if (la !== lb) return la < lb ? -1 : 1
      const d = score(b) - score(a)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })
    .map(w => w.id)
}

/**
 * The words currently costing you, hardest first — not the ones that cost
 * you the most, ever. This ranking used to select on `lapses > 0` and sort
 * by lapse count, and the leaderboard built on it looked frozen: lapses is
 * a lifetime counter with a single writer (pressing "again" on a
 * review-phase card) and no decrement, and the counts bunch at the low end
 * anyway — over the live library, all 7 lapsed words sat at exactly 1
 * lapse, so the raw count separated nothing.
 *
 * A word is struggling while **ease sits below initial**. Ease is the
 * scheduler's own running difficulty estimate (−0.2 on a lapse, −0.15 on
 * "hard", recovers only on "easy"; see the comment on INITIAL_EASE for why
 * a word never in trouble sits exactly at initial), and it is already the
 * app's difficulty signal — difficultyWeight in quiz.ts weights quiz slots
 * by the same distance. That gives the list both entries the old one
 * lacked: a word graded "hard" counts without ever being outright
 * forgotten, and both exits are earned — ease climbing back to initial, or
 * the interval reaching maturity (a word can be carried to 21 days on
 * "good" grades alone, and holding it three weeks is proof enough; see
 * MATURE_INTERVAL_DAYS).
 *
 * Ranking: ease ascending, then lapse count, then encounter likelihood,
 * then id for determinism.
 */
export function rankStrugglingWords(words: Word[], progress: Progress): Word[] {
  return words
    .filter(w => {
      const e = progress.words[w.id]
      return e && e.state !== 'new' && e.ease < INITIAL_EASE && e.intervalDays < MATURE_INTERVAL_DAYS
    })
    .sort((a, b) => {
      const ea = progress.words[a.id], eb = progress.words[b.id]
      if (ea.ease !== eb.ease) return ea.ease - eb.ease
      if (ea.lapses !== eb.lapses) return eb.lapses - ea.lapses
      const d = score(b) - score(a)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })
}

/**
 * Every word currently worth extra practice, most urgent first: **what you
 * just got wrong, then what you keep getting wrong.**
 *
 * The two halves answer different questions and only the second one is the
 * ranking above. `missedAt` words are a fresh observation from a quiz, the
 * sprint or 猜词; the ease ranking is an estimate accumulated over months.
 * Recent misses lead because they are the more actionable of the two, and
 * because this pool is now the only place a practice miss goes at all —
 * the surfaces that record one deliberately no longer touch `due` (see
 * ProgressEntry.missedAt).
 *
 * **The miss half is added here and not to rankStrugglingWords**, which
 * feeds the stats leaderboard as well. That list is defined by the
 * scheduler's own signals, ease and interval, and consolidateWord already
 * refused to force entries into it for exactly this reason: a definition
 * the card and the queue share stops meaning anything once either can
 * inject rows.
 *
 * Uncapped and blind to what happened today: this is the whole stubborn
 * universe, in drill order. The daily drill below narrows it; the
 * unlimited walk (`/practice?pick=struggling`) consumes it as is — see
 * the 2026-08-15 struggling-free-practice spec.
 */
export function strugglingPracticePool(words: Word[], progress: Progress, today: string): Word[] {
  const cutoff = addDays(today, -MISS_RECENCY_DAYS)
  const missed = words
    .filter(w => {
      const e = progress.words[w.id]
      return e && e.state !== 'new' && e.missedAt !== undefined && e.missedAt >= cutoff
    })
    // Most recent miss first; dates are YYYY-MM-DD, so string order is
    // chronological. Ties break the same way the ranking above does.
    .sort((a, b) => {
      const ma = progress.words[a.id].missedAt ?? '', mb = progress.words[b.id].missedAt ?? ''
      if (ma !== mb) return mb < ma ? -1 : 1
      const d = score(b) - score(a)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })

  const seen = new Set(missed.map(w => w.id))
  return [...missed, ...rankStrugglingWords(words, progress).filter(w => !seen.has(w.id))]
}

/**
 * The daily drill session: the pool above, minus anything already dealt
 * with today, capped to one sitting.
 *
 * The session ignores due dates by design, so without the reviewed-today
 * filter the same handful of words came back every single time the page
 * was opened, in an order that was fully deterministic down to the
 * tiebreakers. A pass through the list empties it for the day and the
 * entry point on the Today page disappears, which is the feedback the
 * mode never gave.
 *
 * Deriving from strugglingPracticePool rather than duplicating it is
 * load-bearing: the drill and the unlimited walk must never disagree
 * about what "stubborn" means.
 */
export function buildLapseQueue(
  words: Word[],
  progress: Progress,
  today: string,
  limit = LAPSE_SESSION_SIZE,
): string[] {
  return strugglingPracticePool(words, progress, today)
    // lastReviewedAt is an ISO instant; the day it belongs to is the
    // user's local day, which is what `today` is. Comparing the raw UTC
    // prefix would drop a word a few hours early or late depending on
    // the offset.
    .filter(w => todayStr(new Date(progress.words[w.id].lastReviewedAt)) !== today)
    .slice(0, limit)
    .map(w => w.id)
}
