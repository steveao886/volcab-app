import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifySyncFailure, FORBIDDEN, friendlyError, httpStatus, isRateLimited,
  logoutDiscarded, OFFLINE, RATE_LIMITED, TOKEN_REVOKED,
} from './errors'

const goOffline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
afterEach(() => vi.restoreAllMocks())

describe('httpStatus / isRateLimited', () => {
  it('从 github.ts 的文案里挖出状态码', () => {
    expect(httpStatus(new Error('读取 words.json 失败 (HTTP 404)'))).toBe(404)
    expect(httpStatus('写入 progress.json 失败 (HTTP 403, rate-limited)')).toBe(403)
    expect(httpStatus(new TypeError('Failed to fetch'))).toBeNull()
  })
  it('限流标记只认 github.ts 打上的那个', () => {
    expect(isRateLimited('写入失败 (HTTP 403, rate-limited)')).toBe(true)
    expect(isRateLimited('写入失败 (HTTP 403)')).toBe(false)
  })
})

describe('classifySyncFailure:后台推送失败的处置', () => {
  it('401 —— token 被撤销,只有这一种情况允许退回登录页', () => {
    const out = classifySyncFailure('写入 progress.json 失败 (HTTP 401)')
    expect(out).toEqual({ kind: 'auth', message: TOKEN_REVOKED })
  })

  // 限流是暂时的,为它清掉一个有效 token 是净损失 —— 这条不能被「统一处理 4xx」之类的简化改掉
  it('403 限流:绝不退登,只提示稍后重试', () => {
    const out = classifySyncFailure('写入 progress.json 失败 (HTTP 403, rate-limited)')
    expect(out).toEqual({ kind: 'notice', message: RATE_LIMITED })
  })

  it('403 权限不足:同样不退登,但提示去设置页重新授权', () => {
    const out = classifySyncFailure('写入 progress.json 失败 (HTTP 403)')
    expect(out).toEqual({ kind: 'notice', message: FORBIDDEN })
  })

  it('离线:提示离线,不动 token', () => {
    goOffline()
    expect(classifySyncFailure('写入失败 (HTTP 401)')).toEqual({ kind: 'notice', message: OFFLINE })
  })

  it('其它错误原样透传 —— 远端文件损坏时那句「先导出备份」必须能传到界面上', () => {
    const out = classifySyncFailure('云端文件解析失败,已中止同步以免覆盖数据。请先到设置页导出备份,再检查数据仓库。')
    expect(out.kind).toBe('notice')
    expect(out.message).toContain('导出备份')
  })
})

describe('friendlyError:登录路径', () => {
  it('离线优先', () => {
    goOffline()
    expect(friendlyError(new Error('boom'))).toBe(OFFLINE)
  })
  it('401 / 403 各自成句', () => {
    expect(friendlyError(new Error('Token 无效或已过期 (HTTP 401)'))).toBe(TOKEN_REVOKED)
    expect(friendlyError(new Error('无法访问数据仓库 (HTTP 403, rate-limited)'))).toBe(RATE_LIMITED)
    expect(friendlyError(new Error('无法访问数据仓库 (HTTP 403)'))).toBe(FORBIDDEN)
  })
  it('validate 的 404 文案本身就够清楚,原样带出去', () => {
    expect(friendlyError(new Error('找不到 me/volcab-data——请确认 token 已勾选该仓库的访问权限')))
      .toContain('已勾选该仓库')
  })
})

describe('logoutDiscarded', () => {
  it.each([
    [2, true, '未同步的学习进度、2 条未同步的词库改动'],
    [0, true, '未同步的学习进度,'],
    [3, false, '3 条未同步的词库改动,'],
  ])('(%i, %s) 只提到真的有的那部分', (ops, hadProgress, fragment) => {
    expect(logoutDiscarded(ops, hadProgress)).toContain(fragment)
  })

  // 暂存区的收词也是用户敲进去的,退出时清掉却不吭声就是静默丢数据
  it('待补全的生词一并计入告知', () => {
    expect(logoutDiscarded(0, false, 3)).toContain('3 个待补全的生词')
    expect(logoutDiscarded(2, true, 3)).toContain('未同步的学习进度、2 条未同步的词库改动、3 个待补全的生词')
  })

  it('没有待补全的词就不提它', () => {
    expect(logoutDiscarded(2, false)).not.toContain('待补全')
    expect(logoutDiscarded(2, false, 0)).not.toContain('待补全')
  })
})
