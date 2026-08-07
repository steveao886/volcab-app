/**
 * "Is this page running the version that's actually installed?"
 *
 * vite.config.ts registers the service worker with `registerType: 'autoUpdate'`,
 * so a new worker installs itself, calls skipWaiting + clientsClaim, and takes
 * over — while the open page keeps running the JavaScript it loaded with.
 * UpdatePrompt turns that moment into a dismissible banner instead of a silent
 * reload, because refreshing mid-review would throw away the current card.
 *
 * Dismissing it, though, was a dead end: the banner is plain component state,
 * and the event behind it (workbox's `activated`) fires once per worker, so it
 * never came back. The only way onto the new version was a manual reload —
 * awkward from a home-screen PWA, where switching back to the app *resumes* it
 * rather than reloading. Hence the check in Settings, and hence the flag below.
 */

/**
 * Set when this session has been told a new version is live, whether or not
 * the banner was dismissed. Module scope on purpose: it must survive
 * navigating between pages, and it must **not** survive a reload — after a
 * reload the page is on the new version and the answer is genuinely "no".
 */
let updateReady = false

export function markUpdateReady(): void {
  updateReady = true
}

export function isUpdateReady(): boolean {
  return updateReady
}

export type UpdateStatus = 'ready' | 'current' | 'unsupported'

/** The bits of ServiceWorkerRegistration this needs, so the decision can be tested without one. */
export interface UpdatableRegistration {
  update(): Promise<unknown>
  installing: unknown
  waiting: unknown
}

/**
 * Whether there is a version to move onto.
 *
 * `alreadyReady` short-circuits the probe, and that ordering is the whole
 * point: once a new worker has activated, the sw.js on the server matches the
 * one installed, so `update()` finds nothing and the honest-looking answer
 * would be "you are up to date" — told to someone staring at the old build.
 *
 * A failed probe reports `unsupported`, not an exception: this is read-side
 * code, and being offline is not an error worth breaking a settings page over.
 */
export async function checkForUpdate(
  reg: UpdatableRegistration | null | undefined,
  alreadyReady: boolean,
): Promise<UpdateStatus> {
  if (alreadyReady) return 'ready'
  if (!reg) return 'unsupported'
  try {
    await reg.update()
  } catch {
    return 'unsupported'
  }
  return reg.installing != null || reg.waiting != null ? 'ready' : 'current'
}
