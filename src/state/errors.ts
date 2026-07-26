/**
 * 同步与登录的错误分类和用户可见文案,集中一处。
 *
 * github.ts 只会抛带 `(HTTP xxx)` 的 Error,是我们唯一能拿到的机器可读信号,
 * 因此分类靠解析文案。放在这里而不是散在 store 里,是为了让「什么错该退登、
 * 什么错只提示」这条策略可以单测,也免得同一句话在两处各写一遍。
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
  // 暂存区的收词同样是用户敲进去的东西,退出时一并清掉就必须一并说出来
  if (staging > 0) parts.push(`${staging} 个待补全的生词`)
  return `退出前还有${parts.join('、')},已随本机数据一并清除。`
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 从报错文案里取回 HTTP 状态码;也吃 sync.ts 回传的 error 字符串 */
export function httpStatus(e: unknown): number | null {
  const m = /HTTP (\d{3})/.exec(errText(e))
  return m ? Number(m[1]) : null
}

/** github.ts 在限流时会在文案里带上这个标记(403 既可能是限流也可能是权限不足) */
export const isRateLimited = (e: unknown) => errText(e).includes('rate-limited')

/** 登录路径上的报错:直接给用户看的一句话 */
export function friendlyError(e: unknown): string {
  if (!navigator.onLine) return OFFLINE
  switch (httpStatus(e)) {
    case 401: return TOKEN_REVOKED
    case 403: return isRateLimited(e) ? RATE_LIMITED : FORBIDDEN
    default: return e instanceof TypeError ? NETWORK : errText(e)
  }
}

/**
 * 后台推送失败的处置。
 *
 * 只有 401(token 被撤销)才清 token 退回登录页;403 一律**不**退登 ——
 * 限流是暂时的,为此清掉一个有效 token 是净损失。
 */
export type SyncFailure =
  | { kind: 'auth'; message: string }      // 必须退回登录页
  | { kind: 'notice'; message: string }    // 只提示,数据留在本地等下次重试

export function classifySyncFailure(error: string): SyncFailure {
  if (!navigator.onLine) return { kind: 'notice', message: OFFLINE }
  switch (httpStatus(error)) {
    case 401: return { kind: 'auth', message: TOKEN_REVOKED }
    case 403: return { kind: 'notice', message: isRateLimited(error) ? RATE_LIMITED : FORBIDDEN }
    default: return { kind: 'notice', message: error }
  }
}
