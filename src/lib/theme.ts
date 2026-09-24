/**
 * Light / dark: follow the system, or a choice made in 设置.
 *
 * The palette's dark half is applied by `data-theme="dark"` on <html>
 * (tokens.css), not by a prefers-color-scheme media query, so there is one
 * dark block and one place that decides: here. index.html runs the same
 * decision inline before first paint — the module graph loads after the
 * page has painted once, and a dark-system user choosing 浅色 (or the
 * reverse) would otherwise see a flash of the wrong paper on every open.
 * The inline copy reads THEME_KEY and the media query exactly as this does;
 * change them together.
 *
 * Stored per device, in its own localStorage key rather than lib/storage's
 * KEYS or the synced settings: the system setting it overrides is per
 * device (a phone in dark, a desktop in light), and storage.clearAll()
 * empties KEYS on logout, which should not flip the login page's paper.
 */

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'volcab.theme'

/** The browser chrome (Android's status bar, a PWA's title bar) takes the paper color: --bg in each theme. */
export const THEME_COLOR: Record<Theme, string> = { light: '#ecf0ef', dark: '#15181b' }

const SYSTEM_DARK = '(prefers-color-scheme: dark)'

/** Anything but the two explicit values reads as 跟随系统 — read side lenient. */
export function parseThemePref(raw: string | null): ThemePref {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

export function readThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

/** 跟随系统 removes the key, so "never chose" and "chose to follow" are the same state. */
export function writeThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Losing it costs one tap; the page still switches for this session.
  }
}

const systemIsDark = (): boolean =>
  typeof matchMedia === 'function' && matchMedia(SYSTEM_DARK).matches

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  // Both theme-color metas carry a media attribute for the no-script first
  // paint; once a theme is chosen, both name its paper so the choice wins
  // whatever the system says.
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.content = THEME_COLOR[theme]
  }
}

/** Resolve the stored choice against the system now and apply it. */
export function syncTheme(): void {
  applyTheme(resolveTheme(readThemePref(), systemIsDark()))
}

/**
 * Keep 跟随系统 live: re-resolve when the system flips (a scheduled dark
 * mode at dusk). An explicit choice ignores the event by construction —
 * resolveTheme never reads the system for it. Returns the unsubscribe.
 */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const mq = matchMedia(SYSTEM_DARK)
  const onChange = () => syncTheme()
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
