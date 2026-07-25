import { Button } from '../components/Button'
import { useApp } from '../state/store'

/** Task 15 实现:PAT 输入 + 折叠的 6 步取 token 图文指引。 */
export function Login() {
  const { enterDemoMode } = useApp()
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
        <p className="placeholder">
          <strong>登录</strong>
          待实现:GitHub Token 登录与获取指引
        </p>
        {/* 数据仓库还没建起来之前,页面开发靠这个入口拿到真实词库。Task 15 重写本页时请保留。 */}
        {import.meta.env.DEV && enterDemoMode && (
          <Button variant="secondary" block onClick={() => void enterDemoMode()}>
            演示模式(仅开发)
          </Button>
        )}
      </div>
    </div>
  )
}
