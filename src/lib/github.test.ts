import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobShaFromETag, GitHubClient, toBase64 } from './github'

afterEach(() => vi.unstubAllGlobals())

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

/** A raw-media-type response: the body is the file itself, and the blob sha is in the ETag */
const rawRes = (status: number, body: string, etag?: string) =>
  new Response(body, { status, headers: etag === undefined ? {} : { ETag: etag } })

const SHA = '9447e501bb400d936002a75a2a2851fd5708a20e'

describe('toBase64', () => {
  // Pin down the exact output instead of round-tripping through fromBase64: a self-consistent
  // pair of functions can both be wrong and mask each other's bug. These two expected values
  // were computed with `node -e "Buffer.from(s).toString('base64')"`.
  it('ASCII', () => {
    expect(toBase64('hello world')).toBe('aGVsbG8gd29ybGQ=')
  })
  it('Chinese text and phonetics are encoded as UTF-8, not truncated by code point', () => {
    expect(toBase64('废除;废止 /ˈæbrəɡeɪt/')).toBe('5bqf6ZmkO+W6n+atoiAvy4jDpmJyyZnJoWXJqnQv')
  })
})

describe('GitHubClient', () => {
  const client = new GitHubClient('tok', 'me', 'volcab-data')

  it('getFile: 404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawRes(404, '')))
    expect(await client.getFile('progress.json')).toBeNull()
  })
  it('getFile: body comes straight from the response, sha comes from the ETag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawRes(200, '{"a":1}', `"${SHA}"`)))
    expect(await client.getFile('progress.json')).toEqual({ content: '{"a":1}', sha: SHA })
  })
  it('getFile: requests with the raw media type — the JSON path has a 1 MB cap, and the word list will hit it eventually', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rawRes(200, 'x', `"${SHA}"`))
    vi.stubGlobal('fetch', fetchMock)
    await client.getFile('words.json')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw')
  })
  it('getFile: bodies over 1 MB are still returned normally — no longer routed through base64', async () => {
    const big = 'a'.repeat(1_200_000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawRes(200, big, `"${SHA}"`)))
    const f = await client.getFile('words.json')
    expect(f?.content).toHaveLength(1_200_000)
    expect(f?.sha).toBe(SHA)
  })
  it('getFile: falls back to a JSON request for the sha when the ETag is unavailable, but the body still comes from the raw request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rawRes(200, '{"a":1}'))          // no ETag
      .mockResolvedValueOnce(jsonRes(200, { sha: 'fallback' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await client.getFile('words.json')).toEqual({ content: '{"a":1}', sha: 'fallback' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('getFile: only one request is sent when the ETag is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rawRes(200, '{}', `"${SHA}"`))
    vi.stubGlobal('fetch', fetchMock)
    await client.getFile('words.json')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('putFile: 409/422 → conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(409, {})))
    expect(await client.putFile('p.json', '{}', 'msg', 'oldsha')).toBe('conflict')
  })
  /**
   * The two 422s are not the same event, and the difference is only in the
   * message. Measured 2026-08-22 against a throwaway repo (see
   * docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md):
   * a stale sha is 409, an omitted sha on an existing file is 422, and a
   * file GitHub refuses to write is *also* 422 — at 50 MB, though not at 25.
   *
   * Calling the last one a conflict is what sync.ts then acts on: it
   * re-pulls the whole remote file, replays, pushes again into the same
   * refusal, and tells the user 云端刚被其他设备改写…稍后会自动重试, every
   * clause of which is false and the last of which can never come true.
   */
  it('putFile: 422 "too large" throws instead of reporting a conflict — a conflict is retried, and this can never succeed', async () => {
    const body = { message: 'Sorry, the file is too large to be processed. Consider creating/updating the file in a local clone and pushing it to GitHub.' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(422, body)))
    await expect(client.putFile('words.json', '{}', 'msg', 'sha')).rejects.toThrow(/words\.json.*体积上限.*HTTP 422/s)
  })
  it('putFile: 422 for an omitted sha is still a conflict — that one the retry does fix', async () => {
    const body = { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(422, body)))
    expect(await client.putFile('p.json', '{}', 'msg')).toBe('conflict')
  })
  it('putFile: an unparseable 422 stays a conflict — a garbled body is not evidence of a size problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 422 })))
    expect(await client.putFile('p.json', '{}', 'msg', 'sha')).toBe('conflict')
  })
  it('putFile: returns the new sha on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { content: { sha: 'new' } })))
    expect(await client.putFile('p.json', '{}', 'msg')).toEqual({ sha: 'new' })
  })
  it('whoAmI: 401 throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, {})))
    await expect(GitHubClient.whoAmI('bad')).rejects.toThrow()
  })
})

describe('blobShaFromETag', () => {
  it('strong ETag (this is the shape GitHub raw actually returns, per observed behavior)', () => {
    expect(blobShaFromETag(`"${SHA}"`)).toBe(SHA)
  })
  it('weak ETag', () => {
    expect(blobShaFromETag(`W/"${SHA}"`)).toBe(SHA)
  })
  it('uppercase hex is normalized to lowercase — git shas are always lowercase, otherwise it would not match the sha from putFile', () => {
    expect(blobShaFromETag(`"${SHA.toUpperCase()}"`)).toBe(SHA)
  })
  it('missing → null', () => {
    expect(blobShaFromETag(null)).toBeNull()
    expect(blobShaFromETag('')).toBeNull()
  })
  it('not 40 hex digits → null (better to fall back and send one extra request than to write with a fake sha)', () => {
    expect(blobShaFromETag('"abc"')).toBeNull()
    expect(blobShaFromETag(`"${SHA}extra"`)).toBeNull()
    expect(blobShaFromETag(`"${'z'.repeat(40)}"`)).toBeNull()
    expect(blobShaFromETag(SHA)).toBe(SHA) // unquoted is accepted too
  })
})
