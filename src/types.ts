export interface Meaning {
  pos: string
  en: string
  zh: string
  /**
   * This meaning's approximate share of contemporary usage, rounded to the
   * nearest ten (10–90). All meanings of a word either all have this field
   * or none do; the total across meanings always sums to 100. A word with a
   * single meaning leaves it unset (writing 100 would be noise, and it would
   * also break the "having `share` means it's polysemous" check).
   *
   * Rounding to the nearest ten is deliberate: this is a rough magnitude the
   * AI estimates during the session from general knowledge of contemporary
   * usage, and there is **no** corpus statistic behind it. Writing 87%/13%
   * would imply a source like COCA, which would be false precision.
   *
   * Optional rather than required — strict on the write path (the form +
   * validate-words.ts), lenient on the read path: when another device's
   * older app version pushes up a word missing this field, the correct
   * outcome is "don't show a share," not having the entire words.json
   * judged bad data and rejected from the merge. See isMeaning in sync.ts.
   */
  share?: number
}

/** Related forms sharing the same root: not entered as separate words, but shown on the word detail page to aid remembering them as a family. */
export interface RelatedForm { form: string; pos: string; zh: string }

export interface Word {
  id: string          // lowercase lemma, unique
  headword: string
  phonetic: string    // American pronunciation, e.g. /ˈæbrəɡeɪt/
  meanings: Meaning[]
  examples: string[]  // 2-3 example sentences in modern everyday/work contexts
  synonyms: string[]
  antonyms: string[]
  collocations: string[]
  relatedForms: RelatedForm[]  // same-root variants, empty array if none
  sourceNote: string  // source note title, manually added entries use "manual"
  addedAt: string     // YYYY-MM-DD
  /** Contemporary encounter likelihood 1–10: how likely you are to run into this word in real contexts. Unset means not yet scored. */
  usageScore?: number
  /**
   * Etymology breakdown, one line, in the form
   * `ab-(away) + rogare(propose) → abrogate`.
   *
   * **Always optional**, unlike usageScore's "strict on write, lenient on
   * read" path — here both ends are lenient, deliberately: not every word
   * has a decomposable etymology; for common words of Germanic origin or
   * words of unclear origin, **making one up is far worse than leaving it
   * blank**. A wrong etymology isn't just a missing piece of information,
   * it's driving a false memory anchor into your head. If there isn't one,
   * this block simply doesn't show.
   */
  etymology?: string
}

export interface WordsFile { version: 1; words: Word[] }

export type WordState = 'new' | 'learning' | 'review'
export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface ProgressEntry {
  state: WordState
  ease: number
  intervalDays: number
  due: string            // YYYY-MM-DD
  stepIndex: number      // index into the learning step sequence; set to 0 once in the review phase
  reps: number
  lapses: number
  lastReviewedAt: string // ISO timestamp, the basis for conflict-merge resolution
}

export interface DailyStat {
  reviewed: number
  newLearned: number
  correct: number
  quizTaken: number
  /**
   * Grades given to words that were **already in the review state**, and
   * how many of those were remembered.
   *
   * `reviewed`/`correct` count every card that crossed the screen, which
   * makes them useless for judging the schedule: getting a new word right
   * thirty seconds after first meeting it is counted the same as
   * remembering one from nine days ago, and each new word costs two
   * learning-step grades before it graduates. Measured over the real
   * library, 226 of 543 lifetime grades were learning steps — so the
   * headline "accuracy" sat at 90.8% while true retention on scheduled
   * reviews was 97.8%. Tuning intervals off the first number would move
   * them the wrong way.
   *
   * Written only by grade(). The practice drills are deliberately excluded:
   * they re-test the words you already struggle with, so folding them in
   * would drag the measurement down for reasons that have nothing to do
   * with how well the schedule is working.
   *
   * Optional, like every other added field — an older build on another
   * device pushes days without them, and mergeProgress keeps them absent
   * rather than inventing a zero.
   */
  reviewPhase?: number
  reviewPhaseCorrect?: number
}

/** Personal best score in the 60-second sprint. date is the day it was set (YYYY-MM-DD). */
export interface SprintRecord { score: number; date: string }

export interface Progress {
  version: 1
  /**
   * soundEnabled is optional; undefined is treated as true (sound on by
   * default, see isSoundEnabled in src/lib/sound.ts). This isn't casual
   * laziness — for a real user's progress.json going through sync, adding a
   * required field would either fail validation or force a migration;
   * with an optional field, both devices default to "on" independently,
   * naturally compatible, with no need to touch sync.ts's isWord/validation logic.
   */
  /**
   * updatedAt is the settings' "last modified at" timestamp (ISO), used to
   * decide precedence when merging — without it, settings could never
   * actually sync between two devices: whichever pulls down would just
   * overwrite with its own local copy every time.
   * Optional: legacy data, and devices that have never touched settings,
   * lack this field and are treated as "oldest," automatically yielding to
   * whichever side has changed it. The entire settings object is carried as
   * one unit, not picked apart field by field.
   */
  /**
   * intervalModifier multiplies every review-phase interval; see gradeWord.
   * Optional for the same reason as soundEnabled — undefined means 1, i.e.
   * exactly the behaviour from before the setting existed, so a device on
   * an older build pushing settings without it changes nothing.
   */
  settings: { newPerDay: number; soundEnabled?: boolean; intervalModifier?: number; updatedAt?: string }
  words: Record<string, ProgressEntry>
  dailyStats: Record<string, DailyStat>
  /**
   * Sprint personal-best score. **Optional**, for the same reason as
   * soundEnabled / settings.updatedAt: when another device's older app
   * version pushes up a progress record missing this field, the correct
   * outcome is "no record yet," not having the entire payload judged bad
   * data by isProgress and rejected from the merge.
   * Merge rule is in lib/merge.ts — the higher score wins, ties go to the earlier date.
   */
  bestSprint?: SprintRecord
}

export const emptyProgress = (): Progress => ({
  version: 1,
  settings: { newPerDay: 10 },
  words: {},
  dailyStats: {},
})

export const emptyStat = (): DailyStat => ({ reviewed: 0, newLearned: 0, correct: 0, quizTaken: 0 })

/**
 * A pending-completion record in the new-word staging area.
 *
 * **Exactly two fields**, deliberately: capturing a word must stay a
 * "single text box" cost — no notes, no source, no dictionary pre-lookup;
 * every other field gets filled in later by the AI during a session (see
 * design doc §6.2).
 */
export interface StagingItem {
  headword: string   // the user's input verbatim (leading/trailing whitespace trimmed, internal whitespace collapsed to a single space)
  addedAt: string    // YYYY-MM-DD
}

/** The third file in volcab-data: staging.json */
export interface StagingFile { version: 1; items: StagingItem[] }
