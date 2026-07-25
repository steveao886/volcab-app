const API = 'https://api.github.com'

export interface RemoteFile { content: string; sha: string }

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
    if (!res.ok) throw new Error(`Token 无效或已过期 (HTTP ${res.status})`)
    return (await res.json()).login as string
  }

  /** 确认 token 能访问数据仓库 */
  async validate(): Promise<void> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}`, { headers: this.headers() })
    if (res.status === 404) throw new Error(`找不到 ${this.owner}/${this.repo}——请确认 token 已勾选该仓库的访问权限`)
    if (!res.ok) throw new Error(`无法访问数据仓库 (HTTP ${res.status})`)
  }

  async getFile(path: string): Promise<RemoteFile | null> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: this.headers(),
      cache: 'no-store',
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取 ${path} 失败 (HTTP ${res.status})`)
    const data = await res.json()
    return { content: fromBase64(data.content), sha: data.sha }
  }

  /** sha 不匹配(他端已推送)返回 'conflict',调用方负责合并重试 */
  async putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string } | 'conflict'> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: toBase64(content), ...(sha ? { sha } : {}) }),
    })
    if (res.status === 409 || res.status === 422) return 'conflict'
    if (!res.ok) throw new Error(`写入 ${path} 失败 (HTTP ${res.status})`)
    return { sha: (await res.json()).content.sha as string }
  }
}

export function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}
