import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/**
 * Page shell. The sticky header is the dictionary's running head: a
 * vermilion eyebrow (English) + a Chinese title, with a short vermilion tick
 * at the left end of the bottom hairline — the same motif as the tab bar's tick.
 */
interface PageProps {
  /** Page title. The word detail page can pass <span className="word" lang="en">…</span> */
  title: ReactNode
  /** English eyebrow (uppercased via CSS), already carries lang="en" */
  eyebrow: string
  /** When a path is passed, a back button appears on the left of the header */
  back?: string
  /** Action area on the right of the header */
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
          <p className="page__eyebrow" lang="en">
            {eyebrow}
          </p>
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
