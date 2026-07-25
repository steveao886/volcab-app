import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { StateDot } from '../components/StateDot'
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

/** 列表行:非管理模式下是导航链接,管理模式下整行是复选框的 <label>。 */
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
      <label className="library-row">
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
    <Link className="library-row" to={`/word/${word.id}`}>
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

/** Task 19 实现:搜索、筛选 chips、词条列表、多选批量删除。 */
export function Library() {
  const { words, progress, deleteWords, syncStatus, syncError } = useApp()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sourceNote, setSourceNote] = useState<string | null>(null)

  const [manageMode, setManageMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null)

  // #overlay-root 由 AppLayout 渲染;首次挂载时才保证已经在真实 DOM 里。
  useEffect(() => {
    setOverlayRoot(document.getElementById('overlay-root'))
  }, [])

  // useApp() 的 context value 任何字段变化都会产生新对象(后台同步 tick 也算),
  // 476 条词的过滤/排序不能跟着一起空转 —— 只有 words/progress/查询词/筛选条件
  // 真正变化时才重新计算,Today.tsx 的 useMemo 先例照搬到这里。
  const filtered = useMemo<Word[]>(
    () => filterWords(words, progress, { query, status, sourceNote }),
    [words, progress, query, status, sourceNote],
  )
  const sourceNotes = useMemo(() => distinctSourceNotes(words), [words])
  const filteredIds = useMemo(() => new Set(filtered.map(w => w.id)), [filtered])

  // 筛选条件变化后,已选中但不再可见的词条要从选择集里剔除,
  // 否则「全选」和「已选择 N 项」会跟用户看到的列表对不上。
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

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (confirmOpen && !dialog.open) dialog.showModal()
    if (!confirmOpen && dialog.open) dialog.close()
  }, [confirmOpen])

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

  async function handleConfirmDelete() {
    if (deleting) return // 双击/重复触发保护:一次删除跑完之前不再接受第二次
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
        <Button variant="ghost" size="sm" onClick={toggleManage} disabled={words.length === 0}>
          {manageMode ? '完成' : '管理'}
        </Button>
      }
    >
      {syncStatus === 'error' && syncError !== null && (
        <p className="field__error" role="alert">
          {syncError}
        </p>
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
        <Card pad="none" className="library-list">
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
        <div className="library-empty">
          <p className="library-empty__title">{empty.title}</p>
          <p className="library-empty__hint">{empty.hint}</p>
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

      <dialog
        ref={dialogRef}
        className="library-confirm"
        aria-labelledby="library-confirm-title"
        onClose={() => setConfirmOpen(false)}
      >
        <p className="library-confirm__title" id="library-confirm-title">
          删除选中的 {selected.size} 个词条?
        </p>
        <p className="library-confirm__body">
          它们的学习进度(状态、复习次数、失误次数等)会一并清除,且无法恢复。
        </p>
        {selectedWords.length > 0 && selectedWords.length <= 8 && (
          <p className="library-confirm__list">{selectedWords.map(w => w.headword).join('、')}</p>
        )}
        <div className="library-confirm__actions">
          <Button variant="secondary" disabled={deleting} onClick={() => setConfirmOpen(false)}>
            取消
          </Button>
          <Button variant="danger" loading={deleting} onClick={() => void handleConfirmDelete()}>
            确认删除
          </Button>
        </div>
      </dialog>
    </Page>
  )
}
