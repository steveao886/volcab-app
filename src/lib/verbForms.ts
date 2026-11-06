/**
 * A verb's four forms for the entry page: past, past participle, present
 * participle, third person singular — and which letters in them are worth a
 * learner's second look. See docs/superpowers/specs/2026-11-06-verb-forms-design.md.
 *
 * **Rules spell; src/data/verbForms.json decides.** Everything spelling alone
 * settles is computed here. What it cannot settle is judgment, and judgment
 * is authored: the forms of an irregular verb, and whether a word of two or
 * more syllables doubles its final consonant (concurred, but pondered). That
 * second call turns on stress, and the IPA was measured as a stand-in and
 * rejected: reading final stress from `phonetic` got 5 of the library's 37
 * single-word verbs ending consonant–vowel–consonant wrong — syllabic /n/ in
 * hearten and dishearten, /aʊɚ/ read as one vowel in empower and overpower,
 * and deadpan, a compound that doubles against its stress.
 *
 * **A word that needs judgment and has no usable entry gets no forms at all.**
 * A wrong spelling printed as a fact is a false anchor, the same reason a
 * blank etymology beats a guessed one. requiredFields is the one place that
 * says what needs judgment; the runtime and scripts/validate-verb-forms.ts
 * both ask it, so they cannot disagree about which words fail closed.
 */

/** One word's authored judgment, keyed by word id in src/data/verbForms.json. */
export interface VerbFormsEntry {
  past?: string
  pastParticiple?: string
  presentParticiple?: string
  thirdPerson?: string
  /** Whether a word ending consonant–vowel–consonant doubles that consonant before -ed and -ing. */
  double?: boolean
  /**
   * Only beside `double: false`: the single consonant is one a learner would
   * expect doubled (fidgeted, coveted), so it is marked. Unset on the many
   * that tempt nobody (pondered, hastened).
   */
  looksDoubled?: boolean
}

export interface VerbFormsFile {
  version: 1
  verbs: Record<string, VerbFormsEntry>
}

export type Field = 'past' | 'pastParticiple' | 'presentParticiple' | 'thirdPerson' | 'double'

/**
 * - `irregular`: some form is not what the rules spell (oversaw, held, cast);
 * - `double`: the final consonant doubles (concurred, snagged);
 * - `single`: it stays single where a learner would double it (fidgeted);
 * - `regular`: nothing to look twice at (overhauled).
 */
export type VerbFormKind = 'regular' | 'irregular' | 'double' | 'single'

/** A run of a form's text; `mark` runs carry the 着重号. */
export interface Piece {
  text: string
  mark: boolean
}

export interface VerbForms {
  kind: VerbFormKind
  /** The consonant a `double` or `single` kind is about. */
  consonant?: string
  past: Piece[]
  pastParticiple: Piece[]
  presentParticiple: Piece[]
  thirdPerson: Piece[]
}

/**
 * Base verbs with an irregular form in common use, for *detection only* — the
 * forms themselves are authored per word, because a list cannot know that
 * `relay` is not re+lay, that `bear` has both borne and born, or that
 * `shine` is shone in one sense and shined in another. Variants that are
 * regular in American spelling (burn, learn, dream, leap) are here too: they
 * cost one entry each and the entry is where that call gets made.
 */
const IRREGULAR_BASES = new Set([
  'abide', 'arise', 'awake', 'bear', 'beat', 'begin', 'bend', 'bet', 'bid', 'bind', 'bite',
  'bleed', 'blow', 'break', 'breed', 'bring', 'broadcast', 'build', 'burn', 'burst', 'buy',
  'cast', 'catch', 'choose', 'cling', 'come', 'cost', 'creep', 'cut', 'deal', 'dig', 'dive',
  'do', 'draw', 'dream', 'drink', 'drive', 'dwell', 'eat', 'fall', 'feed', 'feel', 'fight',
  'find', 'fit', 'flee', 'fling', 'fly', 'forbid', 'forsake', 'freeze', 'get', 'give', 'go',
  'grind', 'grow', 'hang', 'have', 'hear', 'hew', 'hide', 'hit', 'hold', 'hurt', 'keep',
  'kneel', 'knit', 'know', 'lay', 'lead', 'lean', 'leap', 'learn', 'leave', 'lend', 'let',
  'lie', 'light', 'lose', 'make', 'mean', 'meet', 'mow', 'pay', 'plead', 'prove', 'put',
  'quit', 'read', 'rid', 'ride', 'ring', 'rise', 'run', 'saw', 'say', 'see', 'seek', 'sell',
  'send', 'set', 'sew', 'shake', 'shave', 'shear', 'shed', 'shine', 'shoot', 'show', 'shrink',
  'shut', 'sing', 'sink', 'sit', 'slay', 'sleep', 'slide', 'sling', 'slink', 'slit', 'smell',
  'smite', 'sneak', 'sow', 'speak', 'speed', 'spell', 'spend', 'spill', 'spin', 'spit',
  'split', 'spoil', 'spread', 'spring', 'stand', 'steal', 'stick', 'sting', 'stink', 'strew',
  'stride', 'strike', 'string', 'strive', 'swear', 'sweep', 'swell', 'swim', 'swing', 'take',
  'teach', 'tear', 'tell', 'think', 'thrive', 'throw', 'thrust', 'tread', 'wake', 'wear',
  'weave', 'wed', 'weep', 'wet', 'win', 'wind', 'wring', 'write',
])

/**
 * Prefixes an irregular verb keeps its forms behind: oversee, uphold,
 * withstand, misunderstand (mis + under + stand). Stripped recursively.
 * Deliberately generous — `belie` and `relay` match too, and their entries
 * simply write the regular forms out. Over-flagging costs one entry;
 * under-flagging prints `overseed`.
 */
const PREFIXES = ['back', 'be', 'by', 'down', 'fore', 'for', 'in', 'mis', 'off', 'out', 'over', 're', 'un', 'under', 'up', 'with']

function isIrregular(w: string): boolean {
  if (IRREGULAR_BASES.has(w)) return true
  return PREFIXES.some(p => w.startsWith(p) && w.length - p.length >= 2 && isIrregular(w.slice(p.length)))
}

/** `qu` spells one consonant: quit is consonant–vowel–consonant, equip ends like ship. */
const normal = (w: string) => w.replace(/qu/g, 'q')

/** Ends consonant–vowel–consonant, the vowel single and the consonant not w, x or y. Same condition as headword.ts. */
export const endsCvc = (w: string) => /[^aeiou][aeiou][^aeiouwxy]$/.test(normal(w))

const syllables = (w: string) => (normal(w).match(/[aeiouy]+/g) ?? []).length

/**
 * The fields a word's entry must supply before any form is shown, in a fixed
 * order. Empty means the rules spell every form.
 *
 * - an irregular verb (or one behind a prefix): `past`, `pastParticiple`;
 * - ending vowel + c (panicked) or consonant–vowel–s/z (quizzes): every form
 *   the c or the doubled s/z reaches;
 * - two or more syllables ending consonant–vowel–consonant: `double` — the
 *   stress call. One syllable needs none: it always doubles (snagged).
 */
export function requiredFields(word: string): Field[] {
  const w = word.toLowerCase()
  const need = new Set<Field>()
  if (isIrregular(w)) {
    need.add('past')
    need.add('pastParticiple')
  }
  const cvc = endsCvc(w)
  if (/[aeiou]c$/.test(w) || (cvc && /[sz]$/.test(w))) {
    need.add('past')
    need.add('pastParticiple')
    need.add('presentParticiple')
    if (/[sz]$/.test(w)) need.add('thirdPerson')
  } else if (cvc && syllables(w) > 1) {
    need.add('double')
  }
  const order: Field[] = ['past', 'pastParticiple', 'presentParticiple', 'thirdPerson', 'double']
  return order.filter(f => need.has(f))
}

/** The rules' spelling of each form, given whether the final consonant doubles. */
export function ruleForms(w: string, double: boolean) {
  const last = w.slice(-1)
  const thirdPerson = /(s|x|z|ch|sh)$/.test(w) ? `${w}es`
    : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies`
    : /[^aeiou]o$/.test(w) ? `${w}es`
    : `${w}s`
  const past = /e$/.test(w) ? `${w}d`
    : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ied`
    : double ? `${w}${last}ed`
    : `${w}ed`
  const presentParticiple = /ie$/.test(w) ? `${w.slice(0, -2)}ying`
    : /e$/.test(w) && !/(ee|ye|oe)$/.test(w) ? `${w.slice(0, -1)}ing`
    : double ? `${w}${last}ing`
    : `${w}ing`
  return { past, pastParticiple: past, presentParticiple, thirdPerson }
}

/**
 * Splits a headword into the one word that inflects and what stays fixed
 * around it: the first word of a phrase (fell through, stemmed from — the
 * rule headword.ts's phrase matcher already relies on), the last segment of
 * a hyphenated compound (rubber-stamped). Null for anything else.
 */
export function inflectingWord(headword: string): { before: string; word: string; after: string } | null {
  const h = headword.trim().toLowerCase()
  const parts = h.split(/\s+/)
  if (parts.length > 1) {
    return /^[a-z]+$/.test(parts[0]) ? { before: '', word: parts[0], after: ` ${parts.slice(1).join(' ')}` } : null
  }
  const m = /^((?:[a-z]+-)*)([a-z]+)$/.exec(h)
  return m === null ? null : { before: m[1], word: m[2], after: '' }
}

const isForm = (v: unknown): v is string => typeof v === 'string' && /^[a-z]+$/.test(v)

export const piecesText = (pieces: Piece[]) => pieces.map(p => p.text).join('')

/**
 * The word's forms, or null when it has no verb sense, its headword has no
 * single inflecting word, or it needs judgment its entry does not supply.
 * Lenient like every read of bundled content: a malformed field is treated
 * as absent, which for a required field means failing closed, never throwing.
 */
export function verbForms(
  word: { id: string; headword: string; meanings: readonly { pos: string }[] },
  file: VerbFormsFile,
): VerbForms | null {
  if (!word.meanings.some(m => /^v\./.test(m.pos.trim()))) return null
  const split = inflectingWord(word.headword)
  if (split === null) return null
  const { before, word: w, after } = split

  const raw: unknown = file.verbs[word.id]
  const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const supplied = (f: Field) => (f === 'double' ? typeof entry.double === 'boolean' : isForm(entry[f]))
  if (!requiredFields(w).every(supplied)) return null

  const cvc = endsCvc(w)
  // A longer word cannot get here without a boolean `double`, so the default
  // only ever applies to one syllable, which always doubles.
  const double = cvc && entry.double !== false
  const single = cvc && entry.double === false && entry.looksDoubled === true
  const rule = ruleForms(w, double)

  let irregular = false
  let doubled = false
  const build = (f: 'past' | 'pastParticiple' | 'presentParticiple' | 'thirdPerson'): Piece[] => {
    const own = entry[f]
    const text = isForm(own) ? own : rule[f]
    const pieces: Piece[] = []
    const push = (t: string, mark: boolean) => {
      if (t !== '') pieces.push({ text: t, mark })
    }
    push(before, false)
    if (text !== rule[f]) {
      irregular = true
      push(text, true)
    } else if (f !== 'thirdPerson' && (double || single) && text.startsWith(w) && text.length > w.length) {
      // The doubled pair, or the single consonant a learner would have doubled.
      const end = double ? w.length + 1 : w.length
      if (double) doubled = true
      push(text.slice(0, w.length - 1), false)
      push(text.slice(w.length - 1, end), true)
      push(text.slice(end), false)
    } else {
      push(text, false)
    }
    push(after, false)
    return pieces
  }

  const past = build('past')
  const pastParticiple = build('pastParticiple')
  const presentParticiple = build('presentParticiple')
  const thirdPerson = build('thirdPerson')
  const kind: VerbFormKind = irregular ? 'irregular' : doubled ? 'double' : single ? 'single' : 'regular'
  const consonant = kind === 'double' || kind === 'single' ? w.slice(-1) : undefined
  return { kind, ...(consonant !== undefined && { consonant }), past, pastParticiple, presentParticiple, thirdPerson }
}
