import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { Page } from '../components/Page'
import { TextInput } from '../components/TextInput'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
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

/** 本机是否欠着没推上远端的东西 —— 直接读缓存标记,不依赖 syncStatus(它在离线时会把这件事盖住)。 */
function hasUnsyncedChanges(): boolean {
  if (storage.get<boolean>('dirty') === true) return true
  const ops = storage.get<unknown>('wordOps')
  return Array.isArray(ops) && ops.length > 0
}

/** Task 21 实现:每日新词数、账号信息与退出登录、导出备份、App 版本号。 */
export function Settings() {
  const { owner, progress, updateSettings, logout, exportAll } = useApp()

  const [newPerDayInput, setNewPerDayInput] = useState(String(progress.settings.newPerDay))
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  // 同步的重放/冲突合并可能在别处改动 settings.newPerDay;没在编辑时跟它对齐。
  useEffect(() => {
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
      window.setTimeout(() => {
        exportLockRef.current = false
      }, 500)
    }
  }, [exportAll])

  // token 是凭证:只取末 4 位展示,不落日志、不进 URL、不进文件名。
  const tokenTail = storage.get<string>('token')?.slice(-4) ?? null
  const unsynced = confirmingLogout && hasUnsyncedChanges()

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
        <p className="pos">账号</p>
        <div className="settings-rows">
          <div className="settings-row">
            <p className="settings-row__label">GitHub 用户</p>
            <p className="settings-row__value">{owner}</p>
          </div>
          {tokenTail && (
            <div className="settings-row">
              <p className="settings-row__label">Token</p>
              <p className="settings-row__value num">•••• {tokenTail}</p>
            </div>
          )}
        </div>

        {confirmingLogout ? (
          <div className="settings-confirm">
            <p className={unsynced ? 'settings-confirm__text settings-confirm__text--warn' : 'settings-confirm__text'}>
              退出会清除本机保存的 token、词库缓存与学习进度缓存。
              {unsynced
                ? '其中包含尚未同步到 GitHub 的改动,退出后无法找回 —— 建议先导出备份。'
                : '当前没有未同步的改动,重新登录后可以取回全部内容。'}
            </p>
            <div className="settings-confirm__actions">
              <Button variant="secondary" block onClick={() => setConfirmingLogout(false)}>
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
        <p className="pos">备份</p>
        <p className="settings-hint">导出词库与学习进度为一份 JSON 文件,保存到本机。</p>
        <Button variant="secondary" block onClick={handleExport}>
          导出备份
        </Button>
      </Card>

      <p className="settings-version">Volcab · {APP_VERSION}</p>
    </Page>
  )
}
