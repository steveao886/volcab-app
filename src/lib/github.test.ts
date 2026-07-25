import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromBase64, GitHubClient, toBase64 } from './github'

afterEach(() => vi.unstubAllGlobals())

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

describe('base64 中文安全', () => {
  it('roundtrip', () => {
    const s = '废除;废止 /ˈæbrəɡeɪt/ — "quotes"'
    expect(fromBase64(toBase64(s))).toBe(s)
  })
  it('容忍 GitHub 返回的换行分段', () => {
    const b64 = toBase64('hello world')
    const chunked = b64.slice(0, 4) + '\n' + b64.slice(4)
    expect(fromBase64(chunked)).toBe('hello world')
  })
})

describe('GitHubClient', () => {
  const client = new GitHubClient('tok', 'me', 'volcab-data')

  it('getFile: 404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(404, {})))
    expect(await client.getFile('progress.json')).toBeNull()
  })
  it('getFile: 解码 content 并返回 sha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { content: toBase64('{"a":1}'), sha: 'abc' })))
    expect(await client.getFile('progress.json')).toEqual({ content: '{"a":1}', sha: 'abc' })
  })
  it('putFile: 409/422 → conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(409, {})))
    expect(await client.putFile('p.json', '{}', 'msg', 'oldsha')).toBe('conflict')
  })
  it('putFile: 成功返回新 sha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { content: { sha: 'new' } })))
    expect(await client.putFile('p.json', '{}', 'msg')).toEqual({ sha: 'new' })
  })
  it('whoAmI: 401 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, {})))
    await expect(GitHubClient.whoAmI('bad')).rejects.toThrow()
  })
})
