const API = 'https://api.github.com'

export interface RemoteFile { content: string; sha: string }

/**
 * A 403 can mean either "the token lacks permission" or "rate-limited" — the two call for
 * completely different handling (the former needs re-authorization, the latter just needs
 * waiting), so this surfaces the rate-limit-exhausted bit in the error message.
 */
function statusTag(res: Response): string {
  const limited = res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
  return `HTTP ${res.status}${limited ? ', rate-limited' : ''}`
}

export class GitHubClient {
  private token: string
  private owner: string
  private repo: string

  constructor(token: string, owner: string, repo: string) {
    this.token = token
    this.owner = owner
    this.repo = repo
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }

  /** Returns the GitHub username for the token; throws if invalid */
  static async whoAmI(token: string): Promise<string> {
    const res = await fetch(`${API}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`Token 无效或已过期 (${statusTag(res)})`)
    return (await res.json()).login as string
  }

  /** Confirms the token can access the data repository */
  async validate(): Promise<void> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}`, { headers: this.headers() })
    if (res.status === 404) throw new Error(`找不到 ${this.owner}/${this.repo}——请确认 token 已勾选该仓库的访问权限`)
    if (!res.ok) throw new Error(`无法访问数据仓库 (${statusTag(res)})`)
  }

  /**
   * Reads a file. **Must use the raw media type**: the default
   * `application/vnd.github+json` only returns the base64 body for files under 1 MB, and
   * leaves content blank above that — and words.json now sits at 96.5% of that cap
   * (2026-08-22: 619 words, 1,012,363 bytes live, ~1,635 bytes/word, 22 words of room). When
   * that limit gets hit, the failure mode is nasty: old devices keep working off their local
   * cache, **new devices can never log in**, and the error message never mentions "file too
   * large" anywhere. raw's cap is 100 MB.
   *
   * The cost is that the response body no longer carries a sha (needed for putFile's
   * optimistic concurrency). Measured: GitHub returns exactly the blob sha in the raw
   * response's ETag, and ETag is listed in Access-Control-Expose-Headers, so the browser can
   * read it — meaning the normal path still costs only one request. But that's not a
   * documented guarantee, so if the ETag doesn't have the expected shape, this falls back to
   * a separate JSON request just for the sha. **Better to send one extra request than to
   * write with a guessed sha** — that would make every single push collide with a conflict.
   */
  async getFile(path: string): Promise<RemoteFile | null> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: { ...this.headers(), Accept: 'application/vnd.github.raw' },
      cache: 'no-store',
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取 ${path} 失败 (${statusTag(res)})`)
    const content = await res.text()
    const sha = blobShaFromETag(res.headers.get('ETag'))
    return { content, sha: sha ?? (await this.getSha(path)) }
  }

  /** The fallback request that fetches only the sha; see getFile's explanation. */
  private async getSha(path: string): Promise<string> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: this.headers(),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`读取 ${path} 的版本号失败 (${statusTag(res)})`)
    return (await res.json()).sha as string
  }

  /** Returns 'conflict' when the sha doesn't match (another client already pushed); the caller is responsible for merging and retrying */
  async putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string } | 'conflict'> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: toBase64(content), ...(sha ? { sha } : {}) }),
    })
    if (res.status === 409 || res.status === 422) return 'conflict'
    if (!res.ok) throw new Error(`写入 ${path} 失败 (${statusTag(res)})`)
    return { sha: (await res.json()).content.sha as string }
  }
}

/**
 * Extracts the blob sha from an ETag. Accepts both the strong and weak forms
 * (`"<sha>"` / `W/"<sha>"`), only accepting 40 hex digits — any other shape returns null
 * so the caller falls back, see getFile. Always lowercased: git shas are always lowercase,
 * and a case mismatch would break putFile's sha comparison.
 */
export function blobShaFromETag(etag: string | null): string | null {
  if (!etag) return null
  const m = /^(?:W\/)?"?([0-9a-f]{40})"?$/i.exec(etag.trim())
  return m === null ? null : m[1].toLowerCase()
}

/**
 * For writing. **There's no matching fromBase64** — once getFile switched to raw it stopped
 * decoding anything, and leaving an unused decoder around would just make the next person
 * assume the read path still goes through base64.
 */
export function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
