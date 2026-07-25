import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/**
 * 页面骨架。粘顶页头 = 辞书的书眉:朱砂眉标(英文)+ 中文标题,
 * 下缘发丝线左端一段朱砂刻度,与底部页签的刻度是同一个母题。
 */
interface PageProps {
  /** 中文页标题 */
  title: string
  /** 英文眉标,全大写 */
  eyebrow: string
  /** 传入路径则页头左侧出现返回按钮 */
  back?: string
  /** 页头右侧操作区 */
  actions?: ReactNode
  children: ReactNode
}

export function Page({ title, eyebrow, back, actions, children }: PageProps) {
  return (
    <div className="page">
      <header className="page__head">
        {back === undefined ? null : (
          <Link className="page__back" to={back} aria-label="返回">
            <Icon name="back" size={20} />
          </Link>
        )}
        <div className="page__heading">
          <p className="page__eyebrow">{eyebrow}</p>
          <h1 className="page__title">{title}</h1>
        </div>
        {actions === undefined ? null : (
          <div className="page__actions">{actions}</div>
        )}
      </header>
      <div className="page__body">{children}</div>
    </div>
  )
}
