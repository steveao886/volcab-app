import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/**
 * Page shell. Three header variants, picked from the props rather than a
 * flag, so a page can't ask for a combination that has no design:
 *
 * - `back` given: a compact sticky header, back button + plain title. These
 *   are the pages you are inside of (复习, a quiz mode, a word).
 * - `lead` given: the title set vertically in a double-ruled 题签 slip, with
 *   the lead content beside it. Only 今日 uses it: the slip is ~100px tall,
 *   and it earns that height only when something stands beside it.
 * - neither: the same slip, horizontal. A vertical slip with nothing beside
 *   it would spend 130px of a phone screen on 学习数据.
 *
 * The English eyebrow over every title (TODAY / REVIEW / …) is gone: tracked
 * all-caps labels over headings were one of the template tells the 朱批
 * redesign removed (docs/superpowers/specs/2026-09-23-zhupi-redesign-design.md).
 */
interface PageProps {
  /** Page title. The word detail page can pass <span className="word" lang="en">…</span> */
  title: ReactNode
  /** When a path is passed, a back button appears on the left of the header */
  back?: string
  /** Action area on the right of the header */
  actions?: ReactNode
  /** Set beside a vertical title slip; see the variants above */
  lead?: ReactNode
  children: ReactNode
}

export function Page({ title, back, actions, lead, children }: PageProps) {
  const variant = back !== undefined ? 'sub' : lead !== undefined ? 'slip-v' : 'slip'
  return (
    <div className="page">
      <header className={`page__head page__head--${variant}`}>
        {back === undefined ? null : (
          <Link className="page__back" to={back} aria-label="返回">
            <Icon name="back" size={20} />
          </Link>
        )}
        <h1 className="page__title">{title}</h1>
        {lead === undefined ? null : <div className="page__lead">{lead}</div>}
        {actions === undefined ? null : (
          <div className="page__actions">{actions}</div>
        )}
      </header>
      <div className="page__body">{children}</div>
    </div>
  )
}
