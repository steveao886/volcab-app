import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'

const TABS = [
  { to: '/', label: '今日', icon: 'today', end: true },
  { to: '/library', label: '词库', icon: 'library', end: false },
  { to: '/quiz', label: '测试', icon: 'quiz', end: false },
  { to: '/guess', label: '猜词', icon: 'guess', end: false },
  { to: '/stats', label: '数据', icon: 'stats', end: false },
  { to: '/settings', label: '设置', icon: 'settings', end: false },
] as const

/**
 * Primary nav. Fixed to the bottom on mobile, becomes a left sidebar at ≥900px (styles in layout.css).
 *
 * Five items. The stats page used to be reachable only through the Today
 * page's "recent" card, on the reasoning that the four slots were spoken
 * for — but that made the one screen you consult rather than act on the
 * hardest to reach, and it is the screen the interval and new-word settings
 * are now argued from.
 *
 * Six, since 猜词. It earns a slot rather than a place inside /quiz because
 * it is the only mode that asks you to produce the word instead of
 * recognising it, and something buried two taps deep in a mode switcher
 * does not get played. Six is the ceiling: the bar is a grid of equal
 * columns, and at 375px a seventh would put the labels below the size the
 * type scale goes down to.
 */
export function TabBar() {
  return (
    <nav className="tabbar" aria-label="主导航">
      <div className="brand tabbar__brand">
        <span className="brand__seal" aria-hidden="true">
          词
        </span>
        <span className="brand__wordmark" lang="en">
          Volcab
        </span>
      </div>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className="tabbar__item"
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
