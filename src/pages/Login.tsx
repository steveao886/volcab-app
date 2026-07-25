import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { TextInput } from '../components/TextInput'
import { useApp } from '../state/store'
import { LoginGuide } from './LoginGuide'
import './Login.css'

/** Task 15 实现:PAT 输入 + 折叠的 6 步取 token 指引。 */
export function Login() {
  const { loginError, login, enterDemoMode } = useApp()
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)

  // 去空白后判断:纯空格也当作没填,不发起请求
  const trimmed = token.trim()
  const canSubmit = trimmed !== '' && !pending

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    // login() 内部吃掉所有失败并落到 loginError,这里只需要收好 pending 状态
    void login(trimmed).finally(() => setPending(false))
  }

  return (
    <div className="auth">
      <div className="auth__inner">
        <div className="brand brand--lg">
          <span className="brand__seal" aria-hidden="true">
            词
          </span>
          <h1 className="brand__wordmark" lang="en">
            Volcab
          </h1>
        </div>
        <p className="auth__tagline">个人词汇记忆本</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <Field
            label="GitHub Token"
            htmlFor="login-token"
            hint="fine-grained personal access token,只需 volcab-data 仓库的 Contents 读写权限"
            error={loginError ?? undefined}
          >
            <TextInput
              id="login-token"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={pending}
            />
          </Field>
          <Button type="submit" variant="primary" block loading={pending} disabled={!canSubmit}>
            登录
          </Button>
        </form>

        <LoginGuide />

        {/* 数据仓库还没建起来之前,页面开发靠这个入口拿到真实词库,保留至 Phase 4。
            视觉上刻意弱化(ghost + 独立留白),不是产品功能。 */}
        {import.meta.env.DEV && enterDemoMode && (
          <div className="login-demo">
            <Button variant="ghost" block onClick={() => void enterDemoMode()}>
              演示模式(仅开发)
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
