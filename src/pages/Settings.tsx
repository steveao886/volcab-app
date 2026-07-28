import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { Page } from '../components/Page'
import { TextInput } from '../components/TextInput'
import { isSoundEnabled } from '../lib/sound'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { pendingOps, pendingStaging } from '../state/session'
import { useApp } from '../state/store'
import './Settings.css'

/**
 * package.json's version is frozen at the placeholder "0.0.0" (shared with
 * other parallel tasks, can't be changed), and vite.config.ts is likewise
 * frozen so there's no way to get a build-time version number injected via
 * `define`. So this hand-writes a constant that clearly doesn't imply an
 * official release, rather than reading package.json or making up a fake
 * number.
 */
const APP_VERSION = '开发预览版'

const NEW_PER_DAY_MIN = 1
const NEW_PER_DAY_MAX = 50

/** Clamps arbitrary input to an integer in [1, 50]; falls back to the previous valid value when it doesn't parse as a number (empty/letters only/pasted garbage). */
function clampNewPerDay(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(NEW_PER_DAY_MAX, Math.max(NEW_PER_DAY_MIN, n))
}

/**
 * Whether the local machine has anything owed to the remote that hasn't
 * been pushed yet — reads the cached flag directly rather than relying on
 * syncStatus (which masks this while offline). For the library half, this
 * uses pendingOps() instead of reading 'wordOps' directly: it filters out
 * malformed dirty data (session.ts:39-43), and it's the exact same
 * function store.tsx's logout() uses to count "how much would be lost" —
 * the "warning" here and the "notice" after signing out must compute the
 * same number, otherwise one of them is lying.
 */
function hasUnsyncedChanges(): boolean {
  return storage.get<boolean>('dirty') === true
    || pendingOps().length > 0
    || pendingStaging().length > 0   // Same reasoning for staged words awaiting completion: logout() counts these too, and the two must stay consistent
}

/** Task 21 implementation: daily new-word count, account info & sign out, export backup, app version. */
export function Settings() {
  const { owner, progress, updateSettings, logout, exportAll } = useApp()

  const [newPerDayInput, setNewPerDayInput] = useState(String(progress.settings.newPerDay))
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const newPerDayRef = useRef<HTMLInputElement>(null)
  // Right now, newPerDay can only ever change because of this component's
  // own commitNewPerDay — mergeProgress (lib/merge.ts:23) preserves
  // local.settings as-is, so conflict merging never introduces a new
  // external value. But that's an invariant living in a frozen file, not
  // this page's to own; the real fallback is this focus check: while the
  // input has focus, syncing is skipped, so even if that invariant ever
  // changes, it will never clobber what the user is typing.
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

  // Export runs as one synchronous block (no await breakpoints); the real
  // risk is a double-click triggering two save dialogs, so a ref lock is
  // used instead of state-based debouncing — it doesn't depend on
  // re-render timing.
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

  // The token is a credential: only the last 4 characters are ever shown, never logged, never put in a URL, never put in a filename.
  const tokenTail = storage.get<string>('token')?.slice(-4) ?? null
  const unsynced = confirmingLogout && hasUnsyncedChanges()

  // Signing out swaps that button out of the DOM directly: when the
  // warning panel appears, focus must follow it (landing on "Cancel", the
  // safe default), and role="alert" makes the screen reader read this
  // text out — the moment the panel mounts, the whole block is announced,
  // with no need for the user to go hunting for it.
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
        {/* The whole row is a <label>, so clicking anywhere toggles it —
            the same pattern as Library.tsx's LibraryRow. Defaults to on
            (spec §3.3): progress.settings.soundEnabled is treated as true
            when absent, and isSoundEnabled is the single source of that
            check in src/lib/sound.ts, so ?? true isn't duplicated here. */}
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
