import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, isUpdateReady, markUpdateReady } from './appUpdate'

const reg = (over: Partial<{ installing: unknown; waiting: unknown; fail: boolean }> = {}) => ({
  installing: over.installing ?? null,
  waiting: over.waiting ?? null,
  update: () => (over.fail ? Promise.reject(new Error('offline')) : Promise.resolve()),
})

describe('the session update flag', () => {
  it('starts clear', async () => {
    vi.resetModules()
    const fresh = await import('./appUpdate')
    expect(fresh.isUpdateReady()).toBe(false)
  })

  it('stays set once a new version has announced itself', () => {
    markUpdateReady()
    expect(isUpdateReady()).toBe(true)
  })
})

describe('checkForUpdate', () => {
  it('reports ready without probing when this session already saw the banner', async () => {
    // The case the button exists for: you pressed 稍后, so the new worker is
    // already installed and active. Probing the server would find nothing new
    // and wrongly report "you are up to date" while the page runs old code.
    let probed = false
    const r = { installing: null, waiting: null, update: () => { probed = true; return Promise.resolve() } }
    expect(await checkForUpdate(r, true)).toBe('ready')
    expect(probed).toBe(false)
  })

  it('reports ready when the probe turns up a worker installing', async () => {
    expect(await checkForUpdate(reg({ installing: {} }), false)).toBe('ready')
  })

  it('reports ready when one is already waiting', async () => {
    expect(await checkForUpdate(reg({ waiting: {} }), false)).toBe('ready')
  })

  it('reports current when the probe finds nothing', async () => {
    expect(await checkForUpdate(reg(), false)).toBe('current')
  })

  it('reports unsupported rather than throwing when there is no registration', async () => {
    expect(await checkForUpdate(null, false)).toBe('unsupported')
    expect(await checkForUpdate(undefined, false)).toBe('unsupported')
  })

  it('reports unsupported when the probe itself fails, e.g. offline', async () => {
    // Read side lenient, as everywhere: a failed check is "cannot tell",
    // never an exception escaping into a settings page.
    expect(await checkForUpdate(reg({ fail: true }), false)).toBe('unsupported')
  })
})
