import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { Page } from '../components/Page'
import { TextInput } from '../components/TextInput'
import { isSoundEnabled } from '../lib/sound'
import { clampIntervalModifier, MAX_INTERVAL_MODIFIER, MIN_INTERVAL_MODIFIER, todayStr } from '../lib/srs'
import { loadInputs, recommendIntervalModifier, recommendNewPerDay, retentionWindowDays } from '../lib/tuning'
import { dailySeries, dueForecast, retentionStats } from './statsDerive'
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

/** Windows the advice is computed over. Retention needs a long one to gather
 *  enough scheduled reviews; daily load needs a short one, because the point
 *  is what the user is doing *now*, not what they managed a month ago. */
const RETENTION_WINDOW_DAYS = 30
const LOAD_WINDOW_DAYS = 14
const FORECAST_DAYS = 7

const NEW_PER_DAY_MIN = 1
const NEW_PER_DAY_MAX = 50

/** Clamps arbitrary input to an integer in [1, 50]; falls back to the previous valid value when it doesn't parse as a number (empty/letters only/pasted garbage). */
function clampNewPerDay(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(NEW_PER_DAY_MAX, Math.max(NEW_PER_DAY_MIN, n))
}

/**
 * Parses the interval-modifier box. Unparseable input falls back to the
 * previous value rather than to 1: silently resetting a scheduling knob to
 * its default because someone selected the text and typed a letter would
 * quietly reshape every future interval.
 */
function parseModifier(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  // One decimal place. The knob compounds — 1.3 means 3.7x after five
  // reviews — so there is no meaning to be had in the second digit.
  return clampIntervalModifier(Math.round(n * 10) / 10)
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

const pct = (r: number) => Math.round(r * 100)
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * The advice line under a setting.
 *
 * Always states the numbers it reasoned from, never just a verdict. The
 * recommendation is an estimate off a few weeks of history and the user is
 * the one who has to live with the schedule — "retention 97% over 317
 * reviews, try 1.3" can be argued with; "set it to 1.3" cannot.
 *
 * **No apply button.** There was one, and it only appeared when there
 * happened to be a value to take — so one field had it and the other
 * didn't, which reads as a bug rather than as a state. The input it would
 * have filled is directly above, and typing 1.3 is not the hard part of
 * this decision.
 */
function Advice({ children }: { children: ReactNode }) {
  return <p className="settings-advice">{children}</p>
}

/** Task 21 implementation: daily new-word count, account info & sign out, export backup, app version. */
export function Settings() {
  const { owner, words, progress, updateSettings, logout, exportAll } = useApp()

  const [newPerDayInput, setNewPerDayInput] = useState(String(progress.settings.newPerDay))
  const currentModifier = clampIntervalModifier(progress.settings.intervalModifier)
  const [modifierInput, setModifierInput] = useState(currentModifier.toFixed(1))
  const modifierRef = useRef<HTMLInputElement>(null)
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

  // Same focus guard as newPerDay above, for the same reason.
  useEffect(() => {
    if (document.activeElement === modifierRef.current) return
    setModifierInput(clampIntervalModifier(progress.settings.intervalModifier).toFixed(1))
  }, [progress.settings.intervalModifier])

  // Both settings are argued from data the app already keeps, so the page can
  // say what it thinks rather than leaving the user to guess. Recomputed only
  // when the underlying data moves — useApp()'s value is a new object on every
  // provider render.
  const { modifierAdvice, newPerDayAdvice } = useMemo(() => {
    const today = todayStr(new Date())
    // Only days since the modifier last moved count as evidence about it.
    const window = retentionWindowDays(storage.get<string>('intervalTunedOn'), today, RETENTION_WINDOW_DAYS)
    const retention = retentionStats(progress, today, window)
    const forecast = dueForecast(words, progress, today, FORECAST_DAYS)
    return {
      modifierAdvice: recommendIntervalModifier(retention.correct, retention.reviewed, progress.settings.intervalModifier),
      newPerDayAdvice: recommendNewPerDay(
        progress.settings.newPerDay,
        loadInputs(words, progress, dailySeries(progress, today, LOAD_WINDOW_DAYS), forecast.days.map(d => d.count)),
      ),
    }
  }, [words, progress])

  /** Every path that changes the modifier goes through here, so the evidence window is always reset with it. */
  const setModifier = useCallback((v: number) => {
    setModifierInput(v.toFixed(1))
    storage.set('intervalTunedOn', todayStr(new Date()))
    updateSettings({ ...progress.settings, intervalModifier: v })
  }, [progress.settings, updateSettings])

  const commitModifier = useCallback(() => {
    const clamped = parseModifier(modifierInput, currentModifier)
    setModifierInput(clamped.toFixed(1))
    if (clamped !== currentModifier) setModifier(clamped)
  }, [modifierInput, currentModifier, setModifier])

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

        {newPerDayAdvice.kind === 'insufficient' && (
          <Advice>
            学满 <span className="num">{newPerDayAdvice.needed}</span> 天后给出建议(目前{' '}
            <span className="num">{newPerDayAdvice.activeDays}</span> 天)。
          </Advice>
        )}
        {newPerDayAdvice.kind === 'exhausted' && <Advice>词库里已经没有没学过的词了。</Advice>}
        {newPerDayAdvice.kind === 'ok' && (
          <Advice>
            按这个设置每天约 <span className="num">{Math.round(newPerDayAdvice.projected)}</span> 张卡,和你近期实际每天{' '}
            <span className="num">{Math.round(newPerDayAdvice.sustained)}</span> 张接近,不用调。
          </Advice>
        )}
        {newPerDayAdvice.kind === 'adjust' && (
          <Advice>
            按这个设置每天约 <span className="num">{Math.round(newPerDayAdvice.projected)}</span> 张卡,而你近期实际每天{' '}
            <span className="num">{Math.round(newPerDayAdvice.sustained)}</span> 张 ——{' '}
            {newPerDayAdvice.to < newPerDayAdvice.from ? '有点吃不下' : '还有余力'},建议改成{' '}
            <span className="num">{newPerDayAdvice.to}</span>。
          </Advice>
        )}

        {/* Sits with the new-word count because both decide how much work
            tomorrow holds. The hint carries the target number, because
            "1.3" means nothing without knowing what you are aiming at —
            the stats page prints the retention this is meant to move. */}
        <Field
          label="间隔系数"
          htmlFor="settings-interval-modifier"
          hint={`复习间隔的整体倍率,${MIN_INTERVAL_MODIFIER}–${MAX_INTERVAL_MODIFIER}。留存率明显高于 90% 时调大它,间隔会变长、每天要复习的词会变少。它是复利的:1.3 在五次复习后就是约 3.7 倍。`}
        >
          <TextInput
            id="settings-interval-modifier"
            ref={modifierRef}
            className="num"
            type="number"
            inputMode="decimal"
            min={MIN_INTERVAL_MODIFIER}
            max={MAX_INTERVAL_MODIFIER}
            step={0.1}
            value={modifierInput}
            onChange={(e) => setModifierInput(e.target.value)}
            onBlur={commitModifier}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        </Field>

        {modifierAdvice.kind === 'insufficient' && (
          <Advice>
            到期复习满 <span className="num">{modifierAdvice.needed}</span> 次后给出建议(目前{' '}
            <span className="num">{modifierAdvice.reviewed}</span> 次)。只统计已毕业词的复习,新词的学习步骤不算。
          </Advice>
        )}
        {modifierAdvice.kind === 'ok' && (
          <Advice>
            近 {RETENTION_WINDOW_DAYS} 天留存率 <span className="num">{pct(modifierAdvice.retention)}%</span>(
            <span className="num">{modifierAdvice.reviewed}</span> 次到期复习),已经贴着 90% 的目标,不用调。
          </Advice>
        )}
        {modifierAdvice.kind === 'adjust' && (
          <Advice>
            近 {RETENTION_WINDOW_DAYS} 天留存率 <span className="num">{pct(modifierAdvice.retention)}%</span>(
            <span className="num">{modifierAdvice.reviewed}</span> 次到期复习),
            {modifierAdvice.retention > 0.9 ? '高于 90% 的目标,间隔可以再放长' : '低于 90% 的目标,间隔该收紧'} ——
            建议 <span className="num">{round1(modifierAdvice.to)}</span>。
          </Advice>
        )}
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
