// scripts/jev.ts
/**
 * What every Jev script shares: the pinned model, the key, one call with
 * retry, and a bounded pool to run many calls.
 *
 * Jev is TypeSafe AI's typed-judgment model: it answers choice, yes/no and
 * score questions with probabilities and writes no prose. It reads English
 * best. Every threshold a script here uses was measured against hand
 * labels on this pinned version — bump MODEL and re-measure them first.
 */
import { existsSync, readFileSync } from 'node:fs'

export const MODEL = 'jev-1.13.0'

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

/** The environment wins over .env.local (gitignored); empty is absent. */
export function readKey(envFile: string | undefined, fromEnv: string | undefined): string | undefined {
  if (fromEnv?.trim()) return fromEnv.trim()
  const line = envFile?.split(/\r?\n/).find((l) => l.startsWith('TYPESAFE_API_KEY='))
  const value = line?.slice('TYPESAFE_API_KEY='.length).trim().replace(/^(['"])(.*)\1$/, '$2')
  return value || undefined
}

export const loadKey = (): string | undefined =>
  readKey(existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : undefined, process.env.TYPESAFE_API_KEY)

/** One request; 429 and 5xx back off and retry five times, anything else throws. */
export async function askJev(key: string, body: unknown, attempt = 0): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return askJev(key, body, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** Runs `fn` over `items` at most `limit` at a time; results keep input order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Input tokens priced at the published $0.042 per million (output is free). */
export const costOf = (tokens: number): string => `~$${((tokens * 0.042) / 1e6).toFixed(4)}`
