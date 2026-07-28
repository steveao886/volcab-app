/**
 * Error classification and user-visible copy for sync and login, kept in one place.
 *
 * github.ts only ever throws an Error carrying `(HTTP xxx)`, the one
 * machine-readable signal we get, so classification relies on parsing that
 * text. This lives here instead of scattered through store so the policy of
 * "which errors log you out, which just notify" can be unit tested, and so
 * the same sentence isn't written out twice in two places.
 */

export const GIVE_UP =
  '云端刚被其他设备改写,已重试一次仍冲突;本次改动留在本地,稍后会自动重试。'

export const BACKUP_HINT =
  '云端文件解析失败,已中止同步以免覆盖数据。请先到设置页导出备份,再检查数据仓库。'

export const OFFLINE = '当前处于离线状态,连上网络后再试。'

export const RATE_LIMITED =
  'GitHub 接口调用过于频繁,已被限流。改动都在本地,过一会儿会自动重试。'

export const FORBIDDEN =
  'GitHub 拒绝了请求:token 对数据仓库的权限可能不足。若一直失败,请到设置页重新登录并勾选该仓库。'

export const TOKEN_REVOKED = '登录信息已失效或被撤销,请重新粘贴一个有效的 token。'

export const NETWORK = '网络请求失败,请检查网络后重试。'

export const ownerSwitched = (previousOwner: string) =>
  `本机上 ${previousOwner} 还有没同步完的改动,换账号登录后已被丢弃。`

export function logoutDiscarded(words: number, hadProgress: boolean, staging = 0): string {
  const parts: string[] = []
  if (hadProgress) parts.push('未同步的学习进度')
  if (words > 0) parts.push(`${words} 条未同步的词库改动`)
  // Staged words are just as much something the user typed in — clearing them out on logout has to be disclosed too
  if (staging > 0) parts.push(`${staging} 个待补全的生词`)
  return `退出前还有${parts.join('、')},已随本机数据一并清除。`
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Recovers the HTTP status code from error copy; also accepts the error string sync.ts hands back */
export function httpStatus(e: unknown): number | null {
  const m = /HTTP (\d{3})/.exec(errText(e))
  return m ? Number(m[1]) : null
}

/** github.ts stamps this marker into the copy when rate-limited (a 403 could mean either rate limiting or insufficient permissions) */
export const isRateLimited = (e: unknown) => errText(e).includes('rate-limited')

/** An error on the login path: a sentence shown directly to the user */
export function friendlyError(e: unknown): string {
  if (!navigator.onLine) return OFFLINE
  switch (httpStatus(e)) {
    case 401: return TOKEN_REVOKED
    case 403: return isRateLimited(e) ? RATE_LIMITED : FORBIDDEN
    default: return e instanceof TypeError ? NETWORK : errText(e)
  }
}

/**
 * How a background push failure is handled.
 *
 * Only a 401 (token revoked) clears the token and falls back to the login
 * page; a 403 **never** logs out — rate limiting is temporary, and clearing
 * a valid token over it is a net loss.
 */
export type SyncFailure =
  | { kind: 'auth'; message: string }      // must fall back to the login page
  | { kind: 'notice'; message: string }    // just a notice, data stays local awaiting the next retry

export function classifySyncFailure(error: string): SyncFailure {
  if (!navigator.onLine) return { kind: 'notice', message: OFFLINE }
  switch (httpStatus(error)) {
    case 401: return { kind: 'auth', message: TOKEN_REVOKED }
    case 403: return { kind: 'notice', message: isRateLimited(error) ? RATE_LIMITED : FORBIDDEN }
    default: return { kind: 'notice', message: error }
  }
}
