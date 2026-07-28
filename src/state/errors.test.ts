import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifySyncFailure, FORBIDDEN, friendlyError, httpStatus, isRateLimited,
  logoutDiscarded, OFFLINE, RATE_LIMITED, TOKEN_REVOKED,
} from './errors'

const goOffline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
afterEach(() => vi.restoreAllMocks())

describe('httpStatus / isRateLimited', () => {
  it('digs the status code out of github.ts copy', () => {
    expect(httpStatus(new Error('读取 words.json 失败 (HTTP 404)'))).toBe(404)
    expect(httpStatus('写入 progress.json 失败 (HTTP 403, rate-limited)')).toBe(403)
    expect(httpStatus(new TypeError('Failed to fetch'))).toBeNull()
  })
  it('the rate-limited marker only recognizes the one github.ts stamps on', () => {
    expect(isRateLimited('写入失败 (HTTP 403, rate-limited)')).toBe(true)
    expect(isRateLimited('写入失败 (HTTP 403)')).toBe(false)
  })
})

describe('classifySyncFailure: how a background push failure is handled', () => {
  it('401 -- token revoked, the only case allowed to fall back to the login page', () => {
    const out = classifySyncFailure('写入 progress.json 失败 (HTTP 401)')
    expect(out).toEqual({ kind: 'auth', message: TOKEN_REVOKED })
  })

  // Rate limiting is temporary, and clearing a valid token over it is a net loss -- this must not be simplified away by something like "handle all 4xx the same"
  it('403 rate-limited: never logs out, just tells the user to try again later', () => {
    const out = classifySyncFailure('写入 progress.json 失败 (HTTP 403, rate-limited)')
    expect(out).toEqual({ kind: 'notice', message: RATE_LIMITED })
  })

  it('403 insufficient permissions: also does not log out, but tells the user to re-authorize on the settings page', () => {
    const out = classifySyncFailure('写入 progress.json 失败 (HTTP 403)')
    expect(out).toEqual({ kind: 'notice', message: FORBIDDEN })
  })

  it('offline: shows an offline notice, does not touch the token', () => {
    goOffline()
    expect(classifySyncFailure('写入失败 (HTTP 401)')).toEqual({ kind: 'notice', message: OFFLINE })
  })

  it('other errors pass through as-is -- the "export a backup first" sentence for a corrupted remote file must reach the screen', () => {
    const out = classifySyncFailure('云端文件解析失败,已中止同步以免覆盖数据。请先到设置页导出备份,再检查数据仓库。')
    expect(out.kind).toBe('notice')
    expect(out.message).toContain('导出备份')
  })
})

describe('friendlyError: login path', () => {
  it('offline takes priority', () => {
    goOffline()
    expect(friendlyError(new Error('boom'))).toBe(OFFLINE)
  })
  it('401 / 403 each get their own sentence', () => {
    expect(friendlyError(new Error('Token 无效或已过期 (HTTP 401)'))).toBe(TOKEN_REVOKED)
    expect(friendlyError(new Error('无法访问数据仓库 (HTTP 403, rate-limited)'))).toBe(RATE_LIMITED)
    expect(friendlyError(new Error('无法访问数据仓库 (HTTP 403)'))).toBe(FORBIDDEN)
  })
  it('validate\'s 404 copy is already clear enough, passed through as-is', () => {
    expect(friendlyError(new Error('找不到 me/volcab-data——请确认 token 已勾选该仓库的访问权限')))
      .toContain('已勾选该仓库')
  })
})

describe('logoutDiscarded', () => {
  it.each([
    [2, true, '未同步的学习进度、2 条未同步的词库改动'],
    [0, true, '未同步的学习进度,'],
    [3, false, '3 条未同步的词库改动,'],
  ])('(%i, %s) only mentions the parts that actually exist', (ops, hadProgress, fragment) => {
    expect(logoutDiscarded(ops, hadProgress)).toContain(fragment)
  })

  // Staged words are also something the user typed in -- clearing them out silently on logout would be a silent data loss
  it('staged words awaiting completion are included in the notice too', () => {
    expect(logoutDiscarded(0, false, 3)).toContain('3 个待补全的生词')
    expect(logoutDiscarded(2, true, 3)).toContain('未同步的学习进度、2 条未同步的词库改动、3 个待补全的生词')
  })

  it('mentions nothing about staged words when there are none', () => {
    expect(logoutDiscarded(2, false)).not.toContain('待补全')
    expect(logoutDiscarded(2, false, 0)).not.toContain('待补全')
  })
})
