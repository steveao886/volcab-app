import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { StateDot } from '../components/StateDot'
import { SyncStatus } from '../components/SyncStatus'
import { speak } from '../lib/tts'
import { useApp } from '../state/store'
import type { Word, WordState } from '../types'
import { wordState } from './libraryFilter'
import { WordEditForm } from './WordEditForm'
import './WordDetail.css'

const STATE_LABEL: Record<WordState, string> = { new: '未学', learning: '学习中', review: '已掌握' }

/** Task 19 实现:完整词条 + 发音 + 学习统计 + 编辑表单 + 删除。 */
export function WordDetail() {
  const { id } = useParams()
  const { words, progress, saveWord, deleteWords, syncStatus, syncError, syncNow } = useApp()
  const navigate = useNavigate()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Hooks 必须无条件调用,「词不存在」的分支放在所有 hook 之后再 return。
  const word = useMemo(() => words.find(w => w.id === id), [words, id])

  async function handleSave(updated: Word) {
    setSaving(true)
    try {
      await saveWord(updated)
    } finally {
      setSaving(false)
    }
    // saveWord 内部会先本地落盘再发网络请求,不管这次推送成不成功,
    // 本地这份编辑都已经生效 —— 退出编辑态是准确的;
    // 万一同步失败,下面常驻的 syncStatus 提示会说明情况,不会假装什么都没发生。
    setEditing(false)
  }

  function handleDelete() {
    if (!word) return // 双击/重复触发保护在 ConfirmDialog 里
    setDeleting(true)
    // 不能 await 完再跳转:deleteWords 会在它自己那个 await 之前同步地把词
    // 从 words 里摘掉,React 19 把这次 setState 和 setDeleting 批到同一次
    // 渲染,于是 word 立刻变成 undefined,页面在网络请求还没回来时就先闪出
    // 「这个词条不存在」。本地删除已经是权威结果(与 handleSave 同一套逻辑),
    // 所以立刻跳走;推送成败由词库页常驻的 syncStatus 提示负责说明。
    void deleteWords([word.id]).finally(() => setDeleting(false))
    navigate('/library')
  }

  if (word === undefined) {
    return (
      <Page eyebrow="Entry" title="未找到词条" back="/library">
        <div className="empty-state">
          <p className="empty-state__title">这个词条不存在</p>
          <p className="empty-state__hint">可能已经在别的设备上被删除,或者链接已经失效。</p>
          <Link className="btn btn--primary" to="/library">
            返回词库
          </Link>
        </div>
      </Page>
    )
  }

  const entry = progress.words[word.id]
  const state = wordState(word, progress)
  const hasTags = word.synonyms.length > 0 || word.antonyms.length > 0 || word.collocations.length > 0

  return (
    <Page
      eyebrow="Entry"
      title={
        <span className="word" lang="en">
          {word.headword}
        </span>
      }
      back="/library"
      actions={
        editing ? undefined : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            编辑
          </Button>
        )
      }
    >
      <div className="worddetail-pronounce">
        <p className="ipa" lang="en" aria-hidden="true">
          {word.phonetic}
        </p>
        <Button variant="ghost" size="sm" onClick={() => speak(word.headword)} aria-label={`朗读 ${word.headword}`}>
          <Icon name="speak" size={18} />
          发音
        </Button>
      </div>

      {/* 编辑/删除就发生在这一页,和词库页一样:只在失败时提示,但重试入口要在手边 */}
      {syncStatus === 'error' && syncError !== null && (
        <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
      )}

      {editing ? (
        <WordEditForm word={word} saving={saving} onCancel={() => setEditing(false)} onSave={handleSave} />
      ) : (
        <>
          <Card>
            <ol className="worddetail-meaning-list">
              {word.meanings.map((m, i) => (
                <li className="worddetail-meaning" key={`${m.pos}-${i}`}>
                  <p className="pos">{m.pos}</p>
                  <p className="worddetail-meaning__en" lang="en">
                    {m.en}
                  </p>
                  <p className="worddetail-meaning__zh">{m.zh}</p>
                </li>
              ))}
            </ol>
          </Card>

          {word.examples.length > 0 && (
            <Card>
              <p className="worddetail-section-title">例句</p>
              <ul className="worddetail-examples">
                {word.examples.map((ex, i) => (
                  <li key={i} lang="en">
                    {ex}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {hasTags && (
            <Card className="worddetail-tags">
              {word.synonyms.length > 0 && (
                <div className="worddetail-tag-group">
                  <p className="worddetail-section-title">近义词</p>
                  <div className="worddetail-chiprow">
                    {word.synonyms.map(s => (
                      <Chip key={s} label={s} interactive={false} />
                    ))}
                  </div>
                </div>
              )}
              {word.antonyms.length > 0 && (
                <div className="worddetail-tag-group">
                  <p className="worddetail-section-title">反义词</p>
                  <div className="worddetail-chiprow">
                    {word.antonyms.map(s => (
                      <Chip key={s} label={s} interactive={false} />
                    ))}
                  </div>
                </div>
              )}
              {word.collocations.length > 0 && (
                <div className="worddetail-tag-group">
                  <p className="worddetail-section-title">常见搭配</p>
                  <div className="worddetail-chiprow">
                    {word.collocations.map(s => (
                      <Chip key={s} label={s} interactive={false} />
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {word.relatedForms.length > 0 && (
            <Card>
              <p className="worddetail-section-title">同根变形</p>
              <ul className="worddetail-related">
                {word.relatedForms.map(rf => (
                  <li key={rf.form}>
                    <span className="worddetail-related__form" lang="en">
                      {rf.form}
                    </span>
                    <span className="pos">{rf.pos}</span>
                    <span className="worddetail-related__zh">{rf.zh}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="worddetail-stats">
            <div className="stat">
              <p className="stat__value stat__value--row">
                <StateDot state={state} />
                {STATE_LABEL[state]}
              </p>
              <p className="stat__label">学习状态</p>
            </div>
            <div className="stat">
              <p className="num stat__value">{entry?.due ?? '—'}</p>
              <p className="stat__label">到期日</p>
            </div>
            <div className="stat">
              <p className="num stat__value">{entry?.reps ?? 0}</p>
              <p className="stat__label">复习次数</p>
            </div>
            <div className="stat">
              <p className="num stat__value">{entry?.lapses ?? 0}</p>
              <p className="stat__label">失误次数</p>
            </div>
          </Card>

          <p className="worddetail-meta faint">
            来源笔记:{word.sourceNote} · 添加于 {word.addedAt}
          </p>

          <Button variant="danger" block onClick={() => setConfirmOpen(true)}>
            删除此词
          </Button>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        titleId="worddetail-confirm-title"
        title={`删除「${word.headword}」?`}
        body="这个词条以及它的学习进度(状态、复习次数、失误次数等)会一并删除,且无法恢复。"
        confirmLabel="确认删除"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </Page>
  )
}
