import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'

const TABS = [
  { to: '/', label: '今日', icon: 'today', end: true },
  { to: '/library', label: '词库', icon: 'library', end: false },
  { to: '/quiz', label: '测试', icon: 'quiz', end: false },
  { to: '/settings', label: '设置', icon: 'settings', end: false },
] as const

/** Primary nav. Fixed to the bottom on mobile, becomes a left sidebar at ≥900px (styles in layout.css). */
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
