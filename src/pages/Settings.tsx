import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { Page } from '../components/Page'
import { TextInput } from '../components/TextInput'
import { isSoundEnabled } from '../lib/sound'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { pendingOps } from '../state/session'
import { useApp } from '../state/store'
import './Settings.css'

/**
 * package.json 的 version 冻结在占位值 "0.0.0"(其他并行任务共用,不能改),
 * vite.config.ts 同样冻结所以拿不到 `define` 注入构建期版本号。这里就手写一个
 * 明确不暗示正式发布的常量,而不是去读 package.json 或编一个假号码。
 */
const APP_VERSION = '开发预览版'

const NEW_PER_DAY_MIN = 1
const NEW_PER_DAY_MAX = 50

/** 把任意输入钳到 [1, 50] 的整数;解析不出数字(空/纯字母/粘贴的垃圾)就退回上一个合法值。 */
function clampNewPerDay(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(NEW_PER_DAY_MAX, Math.max(NEW_PER_DAY_MIN, n))
}

/**
 * 本机是否欠着没推上远端的东西 —— 直接读缓存标记,不依赖 syncStatus(它在离线时
 * 会把这件事盖住)。词库那半用 pendingOps() 而不是自己读 'wordOps':它会过滤掉不合
 * 形状的脏数据(session.ts:39-43),跟 store.tsx 的 logout() 数「丢了多少」用的是
 * 同一个函数 —— 这里的「提醒」和退出后的「告知」必须算出同一个数字,否则就是在撒谎。
 */
function hasUnsyncedChanges(): boolean {
  return storage.get<boolean>('dirty') === true || pendingOps().length > 0
}

/** Task 21 实现:每日新词数、账号信息与退出登录、导出备份、App 版本号。 */
export function Settings() {
  const { owner, progress, updateSettings, logout, exportAll } = useApp()

  const [newPerDayInput, setNewPerDayInput] = useState(String(progress.settings.newPerDay))
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const newPerDayRef = useRef<HTMLInputElement>(null)
  // 目前 newPerDay 只可能因为本组件自己的 commitNewPerDay 而变 —— mergeProgress
  // (lib/merge.ts:23)原样保留 local.settings,冲突合并不会带来外部新值。但那是一份
  // 冻结文件里的不变量,不归这页管;真正兜底的是这条焦点判断:输入框拿着焦点时
  // 跳过同步,以后即便那条不变量变了,也不会在用户打字时把内容冲掉。
  useEffect(() => {
    if (document.activeElement === newPerDayRef.current) return
    setNewPerDayInput(String(progress.settings.newPerDay))
  }, [progress.settings.newPerDay])

  const commitNewPerDay = useCallback(() => {
    const clamped = clampNewPerDay(newPerDayInput, progress.settings.newPerDay)
    setNewPerDayInput(String(clamped))
    if (clamped !== progress.settings.newPerDay) {
      updateSettings({ ...progress.settings, newPerDay: clamped })
    }
  }, [newPerDayInput, progress.settings, updateSettings])

  // 导出是同步的一整段(无 await 断点),真正的风险是双击/双击触发两次保存对话框,
  // 用一个 ref 锁而不是 state 防抖 —— 不依赖重渲染的时机。
  const exportLockRef = useRef(false)
  const exportTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (exportTimeoutRef.current !== null) window.clearTimeout(exportTimeoutRef.current)
    },
    [],
  )
  const handleExport = useCallback(() => {
    if (exportLockRef.current) return
    exportLockRef.current = true
    try {
      const json = exportAll()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `volcab-backup-${todayStr(new Date())}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      exportTimeoutRef.current = window.setTimeout(() => {
        exportLockRef.current = false
        exportTimeoutRef.current = null
      }, 500)
    }
  }, [exportAll])

  // token 是凭证:只取末 4 位展示,不落日志、不进 URL、不进文件名。
  const tokenTail = storage.get<string>('token')?.slice(-4) ?? null
  const unsynced = confirmingLogout && hasUnsyncedChanges()

  // 退出登录会直接从 DOM 里换掉那颗按钮:警示面板出现时,焦点得跟过去
  // (落在「取消」这个安全默认项上),role="alert" 负责让屏幕阅读器把这段话念出来
  // —— 面板一挂载就当整块内容播报,不用等用户自己去找。
  const cancelLogoutRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirmingLogout) cancelLogoutRef.current?.focus()
  }, [confirmingLogout])

  return (
    <Page eyebrow="Settings" title="设置">
      <Card>
        <Field
          label="每日新词数"
          htmlFor="settings-new-per-day"
          hint={`每天最多学习的新词数量,${NEW_PER_DAY_MIN}–${NEW_PER_DAY_MAX} 之间`}
        >
          <TextInput
            id="settings-new-per-day"
            ref={newPerDayRef}
            className="num"
            type="number"
            inputMode="numeric"
            min={NEW_PER_DAY_MIN}
            max={NEW_PER_DAY_MAX}
            step={1}
            value={newPerDayInput}
            onChange={(e) => setNewPerDayInput(e.target.value)}
            onBlur={commitNewPerDay}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        </Field>
      </Card>

      <Card>
        {/* 整行都是 <label>,点哪里都能切换——与 Library.tsx 的 LibraryRow 同一个模式。
            默认开启(spec §3.3):progress.settings.soundEnabled 缺省视为 true,
            isSoundEnabled 是 src/lib/sound.ts 里同一份判定,这里不重复写一遍 ?? true。 */}
        <label className="settings-toggle">
          <span className="settings-toggle__text">
            <span className="settings-toggle__label">音效</span>
            <span className="settings-toggle__hint">打分、判题、复习完成时的提示音</span>
          </span>
          <span className="check">
            <input
              type="checkbox"
              className="check__box"
              checked={isSoundEnabled(progress.settings)}
              onChange={(e) => updateSettings({ ...progress.settings, soundEnabled: e.target.checked })}
            />
          </span>
        </label>
      </Card>

      <Card>
        <p className="section-title">账号</p>
        <div className="settings-rows">
          <div className="settings-row">
            <p className="settings-row__label">GitHub 用户</p>
            <p className="settings-row__value">{owner}</p>
          </div>
          {tokenTail && (
            <div className="settings-row">
              <p className="settings-row__label">Token</p>
              <p className="settings-row__value num" aria-label={`Token 末四位 ${tokenTail}`}>
                •••• {tokenTail}
              </p>
            </div>
          )}
        </div>

        {confirmingLogout ? (
          <div className="settings-confirm" role="alert">
            <p className={unsynced ? 'settings-confirm__text settings-confirm__text--warn' : 'settings-confirm__text'}>
              退出会清除本机保存的 token、词库缓存与学习进度缓存。
              {unsynced
                ? '其中包含尚未同步到 GitHub 的改动,退出后无法找回 —— 建议先导出备份。'
                : '当前没有未同步的改动,重新登录后可以取回全部内容。'}
            </p>
            <div className="settings-confirm__actions">
              <Button ref={cancelLogoutRef} variant="secondary" block onClick={() => setConfirmingLogout(false)}>
                取消
              </Button>
              <Button variant="danger" block onClick={logout}>
                确认退出
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" block onClick={() => setConfirmingLogout(true)}>
            退出登录
          </Button>
        )}
      </Card>

      <Card>
        <p className="section-title">备份</p>
        <p className="settings-hint">导出词库与学习进度为一份 JSON 文件,保存到本机。</p>
        <Button variant="secondary" block onClick={handleExport}>
          导出备份
        </Button>
      </Card>

      <p className="settings-version">Volcab · {APP_VERSION}</p>
    </Page>
  )
}
