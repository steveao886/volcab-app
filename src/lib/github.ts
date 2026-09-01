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

/**
 * The `message` field of a GitHub error body, or null when the body is not JSON or carries no
 * message. Consumes the response, so it may only be called on a path that is already failing.
 */
async function errorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: unknown }
    return typeof body.message === 'string' ? body.message : null
  } catch {
    return null
  }
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
   * `application/vnd.github+json` returns the base64 body only for files under 1 MB and
   * leaves `content` blank above that, and words.json passes 1 MiB during 2026-08
   * (2026-08-22: 619 words, 1,012,363 bytes live, ~1,635 bytes each). Had this stayed on the
   * JSON media type the failure would have been nasty: old devices keep working off their
   * local cache, **new devices can never log in**, and no error anywhere says "file too
   * large". raw's documented cap is 100 MB, so crossing 1 MiB is a non-event here.
   *
   * The cost is that the response body no longer carries a sha (needed for putFile's
   * optimistic concurrency). Measured: GitHub returns exactly the blob sha in the raw
   * response's ETag, and ETag is listed in Access-Control-Expose-Headers, so the browser can
   * read it — meaning the normal path still costs only one request. But that's not a
   * documented guarantee, so if the ETag doesn't have the expected shape, this falls back to
   * a separate JSON request just for the sha. **Better to send one extra request than to
   * write with a guessed sha** — that would make every single push collide with a conflict.
   *
   * **The fallback survives above 1 MiB, which was the real question.** The worry was that
   * the JSON media type would *error* over the cap and take getSha down with it, stranding
   * exactly the new-device login this comment exists to protect. Measured 2026-08-22 at 1.1,
   * 2, 10 and 25 MB: it returns **200 with the correct sha** and simply blanks `content`.
   * Both paths hold. See docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md.
   */
  async getFile(path: string): Promise<RemoteFile | null> {
    const f = await this.readRaw(path)
    // No validator was sent, so a 304 here is a server fault. Failing closed
    // beats pretending this device holds a copy it may not have.
    if (f === 'unchanged') throw new Error(`读取 ${path} 失败 (HTTP 304)`)
    return f
  }

  /**
   * Same read as getFile, but tells GitHub which blob this device already
   * holds. Measured 2026-09-01 against the live repo: the raw media type
   * honours `If-None-Match: "<blob sha>"` with a 304 and an empty body, the
   * CORS preflight lists If-None-Match in access-control-allow-headers, and
   * GitHub documents that a 304 does not count against the rate limit.
   *
   * A separate method rather than an optional parameter on getFile, so the
   * three conflict paths in sync.ts that re-pull without a sha never see a
   * value they cannot receive.
   */
  async getFileIfChanged(path: string, sha: string): Promise<RemoteFile | null | 'unchanged'> {
    return this.readRaw(path, { 'If-None-Match': `"${sha}"` })
  }

  /** The one raw-media-type read behind both getters; `extra` is the conditional header or nothing. */
  private async readRaw(path: string, extra: Record<string, string> = {}): Promise<RemoteFile | null | 'unchanged'> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: { ...this.headers(), Accept: 'application/vnd.github.raw', ...extra },
      cache: 'no-store',
    })
    if (res.status === 304) return 'unchanged'
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

  /**
   * Returns 'conflict' when someone else already pushed; the caller is responsible for merging
   * and retrying.
   *
   * **Two different statuses mean that, and one of them also means something else entirely.**
   * Measured 2026-08-22 against a throwaway repo
   * (`docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md`):
   *
   * - **409** `"<path> does not match <sha>"` — a stale sha. A conflict.
   * - **422** `Invalid request. "sha" wasn't supplied.` — we thought the file was new and it
   *   exists. Also a conflict, and the reason 422 is mapped here at all.
   * - **422** `Sorry, the file is too large to be processed.` — GitHub refuses to write the
   *   file. **Not** a conflict, and the distinction is load-bearing: `pushWords` answers a
   *   conflict by re-pulling the whole remote file, replaying, and pushing again, which walks
   *   straight into the same refusal and then reports 云端刚被其他设备改写…稍后会自动重试 —
   *   false in every clause, and promising a retry that can never succeed. Throwing instead
   *   costs one request and says what happened.
   *
   * The size that triggers it is undocumented — GitHub publishes read tiers for this endpoint
   * and no write limit. Measured through this very function against the live API: 40 MB writes
   * fine, 46 MB is refused. That ceiling is about 24,000 words at the current 1,635 bytes each,
   * against a library of 619.
   *
   * An unparseable 422 falls back to 'conflict', i.e. to the older behaviour — a garbled body
   * is not evidence of a size problem, and a conflict is the recoverable reading.
   */
  async putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string } | 'conflict'> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: toBase64(content), ...(sha ? { sha } : {}) }),
    })
    if (res.status === 409) return 'conflict'
    if (res.status === 422) {
      // Matched against the `message` field alone, never the whole body: a path or a commit
      // message could contain these words, and the response echoes both back.
      if (/too large/i.test((await errorMessage(res)) ?? '')) {
        throw new Error(`写入 ${path} 失败:文件已超过 GitHub 接口的体积上限,本次改动没有保存,重试也不会成功 (${statusTag(res)})`)
      }
      return 'conflict'
    }
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
