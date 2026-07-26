import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobShaFromETag, GitHubClient, toBase64 } from './github'

afterEach(() => vi.unstubAllGlobals())

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

/** raw 媒体类型的响应:正文就是文件本身,blob sha 在 ETag 里 */
const rawRes = (status: number, body: string, etag?: string) =>
  new Response(body, { status, headers: etag === undefined ? {} : { ETag: etag } })

const SHA = '9447e501bb400d936002a75a2a2851fd5708a20e'

describe('toBase64', () => {
  // 钉死具体输出而不是和 fromBase64 做 roundtrip:自洽的一对函数可以同时错、
  // 互相掩盖。这两个期望值是 `node -e "Buffer.from(s).toString('base64')"` 算的。
  it('ASCII', () => {
    expect(toBase64('hello world')).toBe('aGVsbG8gd29ybGQ=')
  })
  it('中文与音标按 UTF-8 编码,不是按码点截断', () => {
    expect(toBase64('废除;废止 /ˈæbrəɡeɪt/')).toBe('5bqf6ZmkO+W6n+atoiAvy4jDpmJyyZnJoWXJqnQv')
  })
})

describe('GitHubClient', () => {
  const client = new GitHubClient('tok', 'me', 'volcab-data')

  it('getFile: 404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawRes(404, '')))
    expect(await client.getFile('progress.json')).toBeNull()
  })
  it('getFile: 正文直接取自响应体,sha 取自 ETag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawRes(200, '{"a":1}', `"${SHA}"`)))
    expect(await client.getFile('progress.json')).toEqual({ content: '{"a":1}', sha: SHA })
  })
  it('getFile: 用 raw 媒体类型请求 —— JSON 那条路有 1 MB 上限,词库迟早会撞上', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rawRes(200, 'x', `"${SHA}"`))
    vi.stubGlobal('fetch', fetchMock)
    await client.getFile('words.json')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw')
  })
  it('getFile: 超过 1 MB 的正文照常返回 —— 不再经过 base64', async () => {
    const big = 'a'.repeat(1_200_000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rawRes(200, big, `"${SHA}"`)))
    const f = await client.getFile('words.json')
    expect(f?.content).toHaveLength(1_200_000)
    expect(f?.sha).toBe(SHA)
  })
  it('getFile: ETag 不可用时回退到 JSON 请求拿 sha,正文仍用 raw 那次的', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rawRes(200, '{"a":1}'))          // 没有 ETag
      .mockResolvedValueOnce(jsonRes(200, { sha: 'fallback' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await client.getFile('words.json')).toEqual({ content: '{"a":1}', sha: 'fallback' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('getFile: ETag 可用时只发一次请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rawRes(200, '{}', `"${SHA}"`))
    vi.stubGlobal('fetch', fetchMock)
    await client.getFile('words.json')
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

describe('blobShaFromETag', () => {
  it('强 ETag(实测 GitHub raw 就返回这个形状)', () => {
    expect(blobShaFromETag(`"${SHA}"`)).toBe(SHA)
  })
  it('弱 ETag', () => {
    expect(blobShaFromETag(`W/"${SHA}"`)).toBe(SHA)
  })
  it('大写十六进制归一成小写 —— git sha 一律小写,不然会和 putFile 的 sha 对不上', () => {
    expect(blobShaFromETag(`"${SHA.toUpperCase()}"`)).toBe(SHA)
  })
  it('缺失 → null', () => {
    expect(blobShaFromETag(null)).toBeNull()
    expect(blobShaFromETag('')).toBeNull()
  })
  it('不是 40 位十六进制 → null(宁可回退多发一次请求,也不拿一个假 sha 去写)', () => {
    expect(blobShaFromETag('"abc"')).toBeNull()
    expect(blobShaFromETag(`"${SHA}extra"`)).toBeNull()
    expect(blobShaFromETag(`"${'z'.repeat(40)}"`)).toBeNull()
    expect(blobShaFromETag(SHA)).toBe(SHA) // 没引号也认
  })
})
