/**
 * Word lookup against api.dictionaryapi.dev and response mapping.
 *
 * The only place in the whole app that talks to a third-party,
 * unauthenticated public API — no credentials are ever sent, and the
 * response shape is entirely outside our control. The mapping function is
 * pure and never throws regardless of input: any unexpected shape (a 404
 * error body, missing fields, wrong types) degrades to an empty result,
 * with the page's manual form as the fallback. The only part covered by
 * unit tests, see dictionaryApi.test.ts.
 */

const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en'

export interface DictMeaning {
  pos: string
  en: string
}

export interface DictLookup {
  phonetic: string
  meanings: DictMeaning[]
}

/** This app's convention for part-of-speech abbreviations, kept consistent with existing entries in data/words.json */
const POS_ABBREVIATIONS: Record<string, string> = {
  noun: 'n.',
  pronoun: 'pron.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  preposition: 'prep.',
  conjunction: 'conj.',
  interjection: 'interj.',
  exclamation: 'interj.',
  determiner: 'det.',
  article: 'art.',
  numeral: 'num.',
  particle: 'part.',
}

function abbreviatePos(raw: string): string {
  const pos = raw.trim()
  if (!pos) return ''
  const known = POS_ABBREVIATIONS[pos.toLowerCase()]
  if (known) return known
  // Unknown part of speech (the API occasionally returns non-standard
  // values like "phrase"): falls back to a generic "word." abbreviation
  // rather than stuffing in the whole English word as-is.
  return `${pos.toLowerCase()}.`
}

/** Normalizes phonetics into /.../ form; the API sometimes already includes slashes, sometimes doesn't, and occasionally returns an empty string */
function normalizePhonetic(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const bare = trimmed.replace(/^\/+/, '').replace(/\/+$/, '').trim()
  return bare ? `/${bare}/` : ''
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Maps api.dictionaryapi.dev's raw response body into the minimal fields
 * this app needs: phonetic + the first 3 meanings that "actually have an
 * English definition" (part of speech + English meaning; Chinese is left
 * for the user to fill in). Only the first entry in the array is used —
 * multiple entries on the same page would share a single phonetics
 * section.
 *
 * A pure function that never makes a request and never throws: any shape
 * that doesn't match expectations safely degrades to an empty result.
 */
export function mapDictionaryResponse(data: unknown): DictLookup {
  const entries = Array.isArray(data) ? data : []
  const entry = entries.find(isRecord)
  if (!entry) return { phonetic: '', meanings: [] }

  let phonetic = typeof entry.phonetic === 'string' ? normalizePhonetic(entry.phonetic) : ''
  if (!phonetic && Array.isArray(entry.phonetics)) {
    for (const p of entry.phonetics) {
      if (isRecord(p) && typeof p.text === 'string') {
        const normalized = normalizePhonetic(p.text)
        if (normalized) {
          phonetic = normalized
          break
        }
      }
    }
  }

  const meanings: DictMeaning[] = []
  if (Array.isArray(entry.meanings)) {
    for (const m of entry.meanings) {
      if (meanings.length >= 3) break
      if (!isRecord(m)) continue
      const defs = Array.isArray(m.definitions) ? m.definitions : []
      const firstDef = defs.find(
        (d): d is Record<string, unknown> & { definition: string } =>
          isRecord(d) && typeof d.definition === 'string' && d.definition.trim() !== '',
      )
      if (!firstDef) continue // This meaning has no usable English definition, so it doesn't count toward the first-3 quota
      const en = firstDef.definition.trim()
      const pos = typeof m.partOfSpeech === 'string' ? abbreviatePos(m.partOfSpeech) : ''
      meanings.push({ pos, en })
    }
  }

  return { phonetic, meanings }
}

export type LookupOutcome =
  | { status: 'ok'; phonetic: string; meanings: DictMeaning[] }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

/**
 * The part that actually makes the request; not covered by unit tests
 * (network behavior, and the test environment has no network access, per
 * the task notes). An unauthenticated API, no credentials sent. 404,
 * non-2xx, timeout, and network failure each land in a different outcome,
 * which the page uses to decide whether to offer a retry or fall straight
 * through to the fully manual form.
 */
export async function lookupWord(word: string, timeoutMs = 8000): Promise<LookupOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(word)}`, { signal: controller.signal })
    if (res.status === 404) return { status: 'not-found' }
    if (!res.ok) return { status: 'error', message: `词典查询失败(HTTP ${res.status})` }
    const json = await res.json().catch(() => null)
    if (json === null) return { status: 'error', message: '词典返回的内容无法解析' }
    const mapped = mapDictionaryResponse(json)
    return { status: 'ok', phonetic: mapped.phonetic, meanings: mapped.meanings }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'error', message: '查询超时,请检查网络后重试' }
    }
    return { status: 'error', message: '网络请求失败,请检查网络后重试' }
  } finally {
    clearTimeout(timer)
  }
}
