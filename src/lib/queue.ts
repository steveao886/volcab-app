import { todayStr } from './srs'
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
 * The interval at which a word counts as known and stops being "stubborn".
 *
 * 21 days is the conventional young/mature boundary in spaced repetition
 * (it is Anki's default), not a number picked here. The point is that it
 * has to be *some* threshold: `lapses` is a lifetime counter that is only
 * ever incremented (srs.ts is the only writer, and it has no decrement),
 * so without an exit rule a single slip in July puts a word on the
 * stubborn list forever, however well it is known by September.
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
 * Every word that has ever been forgotten, hardest first.
 *
 * Ranking, in order: lapse count, then **ease ascending**, then encounter
 * likelihood, then id for determinism.
 *
 * Ease is the tiebreaker that earns its place. Lapse counts bunch up hard
 * at the low end — over the live library, all 7 lapsed words sat at
 * exactly 1 lapse, so the raw count separated nothing and the order was
 * decided entirely by usageScore. Ease is the scheduler's own running
 * estimate of how much trouble a word gives you (it drops 0.2 on a lapse,
 * 0.15 on "hard", and only recovers on "easy"), so among words that have
 * each been forgotten once, the one with the lower ease is the one still
 * costing you.
 */
export function rankLapsedWords(words: Word[], progress: Progress): Word[] {
  return words
    .filter(w => (progress.words[w.id]?.lapses ?? 0) > 0)
    .sort((a, b) => {
      const ea = progress.words[a.id], eb = progress.words[b.id]
      if (ea.lapses !== eb.lapses) return eb.lapses - ea.lapses
      if (ea.ease !== eb.ease) return ea.ease - eb.ease
      const d = score(b) - score(a)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })
}

/**
 * The drill session for stubborn words: the ranking above, minus the two
 * categories that made the old queue feel frozen.
 *
 * 1. **Words that have since matured are dropped.** See
 *    MATURE_INTERVAL_DAYS — a list with no exit condition can only grow.
 * 2. **Words already reviewed today are dropped.** The session ignores due
 *    dates by design, so without this the same handful of words came back
 *    every single time the page was opened, in an order that was fully
 *    deterministic down to the tiebreakers. Now a pass through the list
 *    empties it for the day and the entry point on the Today page
 *    disappears, which is the feedback the mode never gave.
 *
 * Both filters read fields that already exist; neither needs a new synced
 * field, and neither can be wrong in a way that loses data — the worst
 * case is that a word waits until tomorrow.
 */
export function buildLapseQueue(
  words: Word[],
  progress: Progress,
  today: string,
  limit = LAPSE_SESSION_SIZE,
): string[] {
  return rankLapsedWords(words, progress)
    .filter(w => {
      const e = progress.words[w.id]
      if (e.intervalDays >= MATURE_INTERVAL_DAYS) return false
      // lastReviewedAt is an ISO instant; the day it belongs to is the
      // user's local day, which is what `today` is. Comparing the raw UTC
      // prefix would drop a word a few hours early or late depending on
      // the offset.
      return todayStr(new Date(e.lastReviewedAt)) !== today
    })
    .slice(0, limit)
    .map(w => w.id)
}
