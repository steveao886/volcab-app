const TOKEN_SETTINGS_URL = 'https://github.com/settings/personal-access-tokens'

/**
 * Collapsible guide for getting a token (collapsed by default). There's no
 * image asset, so "illustrated steps" are replaced by numbering + <code>
 * with exact copy — the button the user needs to click, the name they need
 * to fill in, laid out verbatim.
 * Uses native <details>/<summary>: the browser provides expand/collapse
 * accessibility semantics for free, so there's no need to hand-roll
 * aria-expanded / keyboard handling.
 */
export function LoginGuide() {
  return (
    <details className="disclosure login-guide">
      <summary className="disclosure__summary">如何获取 GitHub Token?</summary>
      <ol className="login-guide__steps">
        <li>
          打开{' '}
          <a href={TOKEN_SETTINGS_URL} target="_blank" rel="noreferrer">
            github.com/settings/personal-access-tokens
            <span className="login-guide__visually-hidden">(在新标签页打开)</span>
          </a>
          。
        </li>
        <li>
          点击 <code>Generate new token</code>。
        </li>
        <li>
          Token name 填 <code>volcab</code>(名称随意,方便自己识别即可)。
        </li>
        <li>
          Expiration 选 <code>No expiration</code>(如果组织策略不允许,选列表里最长的一档);选短了,到期后会突然要求重新走一遍这些步骤。
        </li>
        <li>
          Repository access 选择 Only select repositories,只勾选 <code>volcab-data</code> 这一个仓库。
        </li>
        <li>
          展开 <code>Repository permissions</code>,把 <code>Contents</code> 权限改成 <code>Read and write</code>。
        </li>
        <li>
          点击 <code>Generate token</code> 生成,复制显示出来的 token(只显示这一次),粘贴到下方输入框。
        </li>
      </ol>
    </details>
  )
}
