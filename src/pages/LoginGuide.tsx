const TOKEN_SETTINGS_URL = 'https://github.com/settings/personal-access-tokens'

/**
 * 折叠的取 token 指引(默认收起)。没有图片素材,「图文」靠编号 + <code>
 * 精确文案代替 —— 用户要点的按钮、要填的名字,一字不差地摆出来。
 * 用原生 <details>/<summary>:浏览器自带展开/收起的无障碍语义,
 * 不必自己拼 aria-expanded / 键盘处理。
 */
export function LoginGuide() {
  return (
    <details className="login-guide">
      <summary className="login-guide__summary">如何获取 GitHub Token?</summary>
      <ol className="login-guide__steps">
        <li>
          打开{' '}
          <a href={TOKEN_SETTINGS_URL} target="_blank" rel="noreferrer">
            github.com/settings/personal-access-tokens
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
          Repository access 选择 Only select repositories,只勾选 <code>volcab-data</code> 这一个仓库。
        </li>
        <li>
          展开 Permissions,把 <code>Contents</code> 权限改成 <code>Read and write</code>。
        </li>
        <li>
          点击 <code>Generate token</code> 生成,复制显示出来的 token(只显示这一次),粘贴到下方输入框。
        </li>
      </ol>
    </details>
  )
}
