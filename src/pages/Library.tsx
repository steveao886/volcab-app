import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { StateDot } from '../components/StateDot'
import { SyncStatus } from '../components/SyncStatus'
import { TextInput } from '../components/TextInput'
import { useApp } from '../state/store'
import type { Word, WordState } from '../types'
import { distinctSourceNotes, filterWords, wordState } from './libraryFilter'
import type { StatusFilter } from './libraryFilter'
import './Library.css'

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '未学' },
  { key: 'learning', label: '学习中' },
  { key: 'review', label: '已掌握' },
]

/** List row: a navigation link outside manage mode; in manage mode, the whole row is a checkbox's <label>. */
function LibraryRow({
  word,
  state,
  manageMode,
  selected,
  onToggle,
}: {
  word: Word
  state: WordState
  manageMode: boolean
  selected: boolean
  onToggle: () => void
}) {
  const meaning = word.meanings[0]
  const body = (
    <>
      <div className="library-row__text">
        <p className="library-row__headword" lang="en">
          {word.headword}
        </p>
        {meaning === undefined ? null : <p className="library-row__meaning">{meaning.zh}</p>}
      </div>
      <StateDot state={state} className="library-row__dot" />
    </>
  )

  if (manageMode) {
    return (
      <label className="library-row" role="listitem">
        <span className="check">
          <input
            type="checkbox"
            className="check__box"
            checked={selected}
            onChange={onToggle}
            aria-label={`选中 ${word.headword}`}
          />
        </span>
        {body}
      </label>
    )
  }

  return (
    <Link className="library-row" role="listitem" to={`/word/${word.id}`}>
      {body}
    </Link>
  )
}

function emptyStateCopy(
  hasAnyWords: boolean,
  query: string,
): { title: string; hint: string } {
  if (!hasAnyWords) return { title: '词库还是空的', hint: '去添加第一个词条吧。' }
  if (query.trim() !== '') return { title: `没有匹配"${query.trim()}"的词条`, hint: '换个关键词,或清除筛选条件再试试。' }
  return { title: '当前筛选条件下没有词条', hint: '试试清除筛选条件。' }
}

/** Task 19 implementation: search, filter chips, entry list, multi-select bulk delete. */
export function Library() {
  const { words, progress, deleteWords, syncStatus, syncError, syncNow } = useApp()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sourceNote, setSourceNote] = useState<string | null>(null)

  const [manageMode, setManageMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selectAllRef = useRef<HTMLInputElement>(null)
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null)

  // #overlay-root is rendered by AppLayout; it's only guaranteed to already be in the real DOM once mounted for the first time.
  useEffect(() => {
    setOverlayRoot(document.getElementById('overlay-root'))
  }, [])

  // Any field change on useApp()'s context value produces a new object
  // (background sync ticks count too) — filtering/sorting 476 words can't
  // afford to spin idly along with that. Only recompute when words/progress/
  // the search query/filter conditions actually change, following the same
  // useMemo precedent as Today.tsx.
  const filtered = useMemo<Word[]>(
    () => filterWords(words, progress, { query, status, sourceNote }),
    [words, progress, query, status, sourceNote],
  )
  const sourceNotes = useMemo(() => distinctSourceNotes(words), [words])
  const filteredIds = useMemo(() => new Set(filtered.map(w => w.id)), [filtered])

  // When filter conditions change, entries that are selected but no longer
  // visible must be dropped from the selection set, otherwise "select all"
  // and "N items selected" would no longer match the list the user sees.
  useEffect(() => {
    setSelected(prev => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (filteredIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [filteredIds])

  const allFilteredSelected = filtered.length > 0 && filtered.every(w => selected.has(w.id))
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && !allFilteredSelected
    }
  }, [selected, allFilteredSelected])

  function toggleManage() {
    setManageMode(v => !v)
    setSelected(new Set())
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map(w => w.id)))
  }

  // Double-click / repeat-trigger protection lives inside ConfirmDialog (it synchronously blocks the second click)
  async function handleConfirmDelete() {
    setDeleting(true)
    try {
      await deleteWords([...selected])
    } finally {
      setDeleting(false)
    }
    setConfirmOpen(false)
    setSelected(new Set())
    setManageMode(false)
  }

  const selectedWords = words.filter(w => selected.has(w.id))
  const empty = filtered.length === 0 ? emptyStateCopy(words.length > 0, query) : null

  return (
    <Page
      eyebrow="Lexicon"
      title="词库"
      actions={
        // "Add" must live here permanently: the bottom nav only has four
        // slots (Today/Library/Quiz/Settings), and once the library isn't
        // empty the /add link in that empty-state block below stops
        // rendering — without this entry point, the add-word page becomes
        // unreachable once installed (a standalone window doesn't even have
        // an address bar).
        <div className="library-actions">
          {manageMode ? null : (
            <Link className="btn btn--ghost btn--sm" to="/add">
              添加
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={toggleManage} disabled={words.length === 0}>
            {manageMode ? '完成' : '管理'}
          </Button>
        </div>
      }
    >
      {/* Edits and deletes happen right on this page, so the retry entry
          point must live here too, not just tucked into the badge on the
          Today page. Only shown on failure: this page's body is 476 words
          long and shouldn't lose a line to a permanently docked status
          bar. */}
      {syncStatus === 'error' && syncError !== null && (
        <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
      )}

      <div className="library-search">
        <Icon name="search" size={18} className="library-search__icon" />
        <TextInput
          type="search"
          className="library-search__input"
          placeholder="搜索词头或释义…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="搜索词库:按词头或释义匹配"
        />
      </div>

      <div className="library-filters">
        <div className="library-chiprow" role="group" aria-label="按学习状态筛选">
          {STATUS_CHIPS.map(c => (
            <Chip key={c.key} label={c.label} selected={status === c.key} onClick={() => setStatus(c.key)} />
          ))}
        </div>
        {sourceNotes.length === 0 ? null : (
          <div className="library-chiprow library-chiprow--scroll" role="group" aria-label="按来源笔记筛选">
            {sourceNotes.map(note => (
              <Chip
                key={note}
                label={note}
                selected={sourceNote === note}
                onClick={() => setSourceNote(prev => (prev === note ? null : note))}
              />
            ))}
          </div>
        )}
      </div>

      {manageMode && filtered.length > 0 && (
        <div className="library-selectall">
          <span className="check">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="check__box"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              aria-label="全选当前列表"
            />
          </span>
          <span className="library-selectall__label">全选(当前 {filtered.length} 条)</span>
        </div>
      )}

      {empty === null ? (
        // A long list of 476 entries: explicit list semantics, so screen readers can announce the item count and support list-mode navigation
        <Card pad="none" className="library-list" role="list">
          {filtered.map(w => (
            <LibraryRow
              key={w.id}
              word={w}
              state={wordState(w, progress)}
              manageMode={manageMode}
              selected={selected.has(w.id)}
              onToggle={() => toggleSelect(w.id)}
            />
          ))}
        </Card>
      ) : (
        <div className="empty-state">
          <p className="empty-state__title">{empty.title}</p>
          <p className="empty-state__hint">{empty.hint}</p>
          {words.length === 0 ? (
            <Link className="btn btn--primary" to="/add">
              添加新词
            </Link>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('')
                setStatus('all')
                setSourceNote(null)
              }}
            >
              清除筛选条件
            </Button>
          )}
        </div>
      )}

      {manageMode &&
        overlayRoot &&
        createPortal(
          <div className="library-bulkbar">
            <p className="library-bulkbar__count num">
              {selected.size > 0 ? `已选择 ${selected.size} 项` : '未选择任何词条'}
            </p>
            <Button variant="danger" disabled={selected.size === 0} onClick={() => setConfirmOpen(true)}>
              删除所选 ({selected.size})
            </Button>
          </div>,
          overlayRoot,
        )}

      <ConfirmDialog
        open={confirmOpen}
        titleId="library-confirm-title"
        title={`删除选中的 ${selected.size} 个词条?`}
        body="它们的学习进度(状态、复习次数、失误次数等)会一并清除,且无法恢复。"
        // With 8 or fewer, list the headwords for the user to double-check; more than that becomes a wall of text that obscures what's actually being deleted
        detail={
          selectedWords.length > 0 && selectedWords.length <= 8
            ? selectedWords.map(w => w.headword).join('、')
            : undefined
        }
        confirmLabel="确认删除"
        busy={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </Page>
  )
}
