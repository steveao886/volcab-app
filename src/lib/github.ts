const API = 'https://api.github.com'

export interface RemoteFile { content: string; sha: string }

/**
 * 403 既可能是「token 权限不够」也可能是「被限流」,两者的处置完全不同
 * (前者要重新授权,后者只需等一会儿),所以把配额用尽这一位带进报错文案里。
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

  /** 返回 token 对应的 GitHub 用户名;无效抛错 */
  static async whoAmI(token: string): Promise<string> {
    const res = await fetch(`${API}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`Token 无效或已过期 (${statusTag(res)})`)
    return (await res.json()).login as string
  }

  /** 确认 token 能访问数据仓库 */
  async validate(): Promise<void> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}`, { headers: this.headers() })
    if (res.status === 404) throw new Error(`找不到 ${this.owner}/${this.repo}——请确认 token 已勾选该仓库的访问权限`)
    if (!res.ok) throw new Error(`无法访问数据仓库 (${statusTag(res)})`)
  }

  /**
   * 读文件。**必须走 raw 媒体类型**:默认的 `application/vnd.github+json` 只回
   * 1 MB 以内的 base64 正文,再大就把 content 留空 —— 而 words.json 已经占到
   * 上限的 55%。撞上那天的表现极其阴险:老设备靠本地缓存照常用,**新设备永远
   * 登录不上**,而且报错里一个字都不会提"文件太大"。raw 的上限是 100 MB。
   *
   * 代价是响应体里没有 sha 了(putFile 的乐观并发要用)。实测 GitHub 在 raw
   * 响应的 ETag 里返回的就是 blob sha,且 ETag 在 Access-Control-Expose-Headers
   * 里,浏览器读得到 —— 所以正常路径仍然只有一次请求。但这条不是文档承诺的
   * 行为,所以 ETag 形状不对就回退去要一次 JSON,只取 sha。**宁可多发一次请求,
   * 也不能拿一个猜出来的 sha 去写**:那会让每一次推送都撞 conflict。
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

  /** 只取 sha 的兜底请求,见 getFile 的说明。 */
  private async getSha(path: string): Promise<string> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: this.headers(),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`读取 ${path} 的版本号失败 (${statusTag(res)})`)
    return (await res.json()).sha as string
  }

  /** sha 不匹配(他端已推送)返回 'conflict',调用方负责合并重试 */
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
 * 从 ETag 里取 blob sha。强弱两种形状都认(`"<sha>"` / `W/"<sha>"`),
 * 只接受 40 位十六进制 —— 别的形状一律返回 null 让调用方回退,见 getFile。
 * 统一转小写:git sha 一律小写,大小写不一致会让 putFile 的 sha 比对失败。
 */
export function blobShaFromETag(etag: string | null): string | null {
  if (!etag) return null
  const m = /^(?:W\/)?"?([0-9a-f]{40})"?$/i.exec(etag.trim())
  return m === null ? null : m[1].toLowerCase()
}

/**
 * 写入用。**没有配套的 fromBase64** —— getFile 改走 raw 之后不再解码任何东西,
 * 留一个没人调用的解码器只会让下一个人以为读取路径还在过 base64。
 */
export function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
