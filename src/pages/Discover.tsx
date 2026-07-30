import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { Page } from '../components/Page'
import { availableSuggestions, KIND_LABEL, rankSuggestions } from '../lib/suggestion'
import type { Suggestion, SuggestionKind } from '../lib/suggestion'
import { useApp } from '../state/store'
import pool from '../data/suggestions.json'
import './Discover.css'

/** How many cards are on screen at once. A wall of two hundred is a chore, not a choice; ten is a sitting. */
const BATCH = 10

const FILTERS: { key: SuggestionKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'phrasal', label: KIND_LABEL.phrasal },
  { key: 'idiom', label: KIND_LABEL.idiom },
  { key: 'expression', label: KIND_LABEL.expression },
]

/**
 * The suggestion page: vocabulary the app proposes, for the user to take or leave.
 *
 * Fills a gap the library has by construction — all 473 words in it are
 * single Latinate items, and none of the phrasal verbs, idioms and fixed
 * expressions that actually carry contemporary English.
 *
 * **Accepting drops the word into staging**, the same place the capture box
 * writes to, so an accepted suggestion travels the existing capture → enrich
 * → words.json path and needs no storage of its own. **Rejecting writes an id
 * into progress.dismissed**, which does sync, because "don't offer me this
 * again" has to hold on every device and in every future batch.
 *
 * The pool is bundled content and the app has no way to extend it — no
 * server, no model. It refreshes when a session writes a new batch. That is
 * stated on the page rather than hidden, because a recommendation surface
 * that silently stops producing recommendations reads as broken.
 */
export function Discover() {
  const { words, staging, progress, addStaging, dismissSuggestion } = useApp()
  const [kind, setKind] = useState<SuggestionKind | 'all'>('all')
  // Accepting is async (staging pushes immediately) and dismissing rewrites
  // synced progress; either way the card should leave the list the moment it
  // is acted on, not a round trip later. Tracked locally so the list doesn't
  // reshuffle under the finger while a push is in flight.
  const [settled, setSettled] = useState<Set<string>>(new Set())

  const remaining = useMemo(() => {
    const items = availableSuggestions(pool.items as Suggestion[], {
      words,
      staging,
      dismissed: progress.dismissed ?? [],
    })
    return rankSuggestions(items).filter(s => !settled.has(s.id))
  }, [words, staging, progress.dismissed, settled])

  const shown = (kind === 'all' ? remaining : remaining.filter(s => s.kind === kind)).slice(0, BATCH)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: remaining.length }
    for (const s of remaining) c[s.kind] = (c[s.kind] ?? 0) + 1
    return c
  }, [remaining])

  const settle = (id: string) => setSettled(prev => new Set(prev).add(id))

  const accept = (s: Suggestion) => {
    settle(s.id)
    void addStaging(s.headword)
  }

  const reject = (s: Suggestion) => {
    settle(s.id)
    // The id, not the headword: it is what a future batch is matched against.
    dismissSuggestion(s.id)
  }

  if (remaining.length === 0) {
    return (
      <Page eyebrow="Discover" title="推荐" back="/library">
        <div className="empty-state">
          <p className="empty-state__title">这一批都看完了</p>
          <p className="empty-state__hint">
            推荐是随 app 打包的,不会自己更新 —— 下次让我补一批新的就行。
          </p>
          <Link className="btn btn--primary" to="/library">
            回词库
          </Link>
        </div>
      </Page>
    )
  }

  return (
    <Page eyebrow="Discover" title="推荐" back="/library">
      <div className="discover-filters" role="group" aria-label="按类型筛选">
        {FILTERS.map(f => (
          <Chip
            key={f.key}
            label={f.label}
            count={counts[f.key] ?? 0}
            selected={kind === f.key}
            onClick={() => setKind(f.key)}
          />
        ))}
      </div>

      <p className="faint discover-note">
        加入的词会进暂存区,等下次整理时补全成完整词条;不要的会被记住,以后不再出现。
      </p>

      {shown.length === 0 ? (
        <p className="muted discover-empty">这个类型下没有了,换一个看看。</p>
      ) : (
        shown.map(s => (
          <Card key={s.id} className="discover-card">
            <div className="discover-card__head">
              <span className="word discover-card__word" lang="en">{s.headword}</span>
              <span className="num faint discover-card__score" title="遇见概率 1–10">{s.usageScore}</span>
            </div>
            <p className="discover-card__kind">
              <Chip label={KIND_LABEL[s.kind]} interactive={false} />
            </p>
            <p className="discover-card__zh">{s.zh}</p>
            <p className="muted discover-card__en" lang="en">{s.en}</p>
            <p className="discover-card__example" lang="en">{s.example}</p>
            {s.note !== undefined && <p className="faint discover-card__note">{s.note}</p>}
            <div className="discover-card__actions">
              <Button variant="primary" block onClick={() => accept(s)}>
                加入
              </Button>
              <Button variant="ghost" onClick={() => reject(s)} aria-label={`不要 ${s.headword}`}>
                不要
              </Button>
            </div>
          </Card>
        ))
      )}

      <p className="faint discover-note">
        还剩 <span className="num">{remaining.length}</span> 条待筛选。
      </p>
    </Page>
  )
}
