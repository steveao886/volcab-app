import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { TextInput } from '../components/TextInput'
import { useApp } from '../state/store'
import { LoginGuide } from './LoginGuide'
import './Login.css'

/** Task 15 implementation: PAT input + a collapsible 6-step guide to getting a token. */
export function Login() {
  const { loginError, syncError, login, enterDemoMode } = useApp()
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)

  // Check after trimming: whitespace-only counts as not filled in, so no request is made
  const trimmed = token.trim()
  const canSubmit = trimmed !== '' && !pending

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    // login() internally swallows all failures and surfaces them via loginError; here we just need to clean up the pending state
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

        {/* Page-level notice, on a separate channel from the red field-level
            error below: what's said here is an already-happened fact like
            "unsynced data was discarded on the last sign-out" — the token
            input itself isn't at fault, so it isn't colored red, and the
            input shouldn't be marked aria-invalid either. role="status" is
            a polite announcement — the user doesn't need to be interrupted
            for it. */}
        {syncError !== null && (
          <p className="login-notice" role="status">
            {syncError}
          </p>
        )}

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

        {/* Before the data repo existed, page development relied on this
            entry point to get a real word library; kept around through
            Phase 4. Deliberately de-emphasized visually (ghost + its own
            margin) — it isn't a product feature. */}
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
