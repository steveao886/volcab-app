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
 * Lapse words: the ones with the most failures, **ignoring due date**.
 *
 * progress has always tracked lapses, and the stats page charts it too, but there was no
 * way to directly work through this batch of words — SRS naturally brings frequently-missed
 * words back around more often, but there was no tool for a user who wants to tackle them
 * head-on.
 *
 * Words with 0 lapses don't count (that's not "stubborn"); when lapse counts tie, encounter
 * likelihood breaks the tie, with more common words coming first.
 */
export function buildLapseQueue(words: Word[], progress: Progress, limit = LAPSE_SESSION_SIZE): string[] {
  return words
    .filter(w => (progress.words[w.id]?.lapses ?? 0) > 0)
    .sort((a, b) => {
      const la = progress.words[a.id].lapses, lb = progress.words[b.id].lapses
      if (la !== lb) return lb - la
      const d = score(b) - score(a)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })
    .slice(0, limit)
    .map(w => w.id)
}
