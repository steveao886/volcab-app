import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CaptureChips } from '../components/CaptureChips'
import { Chip } from '../components/Chip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ExampleSentence } from '../components/ExampleSentence'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { SenseSpeakButton } from '../components/SenseSpeakButton'
import { StateDot } from '../components/StateDot'
import { SyncStatus } from '../components/SyncStatus'
import wordNotesFile from '../data/wordNotes.json'
import { preparePronunciation, pronounce } from '../lib/pronounce'
import { senseVoices } from '../lib/sensePronounce'
import { wordNote } from '../lib/wordNotes'
import type { WordNotesFile } from '../lib/wordNotes'
import { useApp } from '../state/store'
import type { RecallRating, Word, WordState } from '../types'
import { wordState } from './libraryFilter'
import { WordEditForm } from './WordEditForm'
import './WordDetail.css'

const STATE_LABEL: Record<WordState, string> = { new: '未学', learning: '学习中', review: '已掌握' }

/**
 * The 回想 rating's three states, in the order they read as a scale.
 *
 * `'none'` and an absent rating are the same thing here, exactly as they
 * are to the weighting — the tombstone exists for mergeRating, not for the
 * user. See RecallRating.
 */
const RECALL_RATINGS: [level: RecallRating['level'], label: string][] = [
  ['easy', '太简单'],
  ['none', '默认'],
  ['hard', '要多考'],
]

/** Task 19 implementation: full entry + pronunciation + learning stats + edit form + delete. */
export function WordDetail() {
  const { id } = useParams()
  const { words, progress, saveWord, deleteWords, rateRecall, syncStatus, syncError, syncNow } = useApp()
  const navigate = useNavigate()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Hooks must be called unconditionally; the "word doesn't exist" branch is returned only after all hooks.
  const liveWord = useMemo(() => words.find(w => w.id === id), [words, id])

  // There's a brief window during delete where "the word is already gone,
  // but the route hasn't switched away yet": deleteWords's local removal
  // is a normal update, while navigate() in react-router runs through
  // startTransition, which has lower priority, so React commits the
  // former first. Measured in practice, this gap can last ~70ms — long
  // enough to flash a "this entry doesn't exist" screen, which is the
  // worst possible false alarm on a page whose whole purpose is deleting
  // data. A pre-delete snapshot is used to paper over this gap; it only
  // takes effect while deleting is true, so genuinely-not-found scenarios
  // (a stale link, deleted from another device) are unaffected and still
  // fall through to the not-found branch below.
  const lastWordRef = useRef<Word | undefined>(undefined)
  if (liveWord !== undefined) lastWordRef.current = liveWord
  const word = liveWord ?? (deleting ? lastWordRef.current : undefined)
  // Warm the recording while the page is read, so the speak tap plays it
  // synchronously — see lib/pronounce.ts for the iOS gesture rule.
  useEffect(() => {
    if (word !== undefined) preparePronunciation(word.headword)
  }, [word])

  async function handleSave(updated: Word) {
    setSaving(true)
    try {
      await saveWord(updated)
    } finally {
      setSaving(false)
    }
    // saveWord commits locally first and only then makes the network
    // request; regardless of whether that push succeeds, the local edit
    // has already taken effect — so exiting edit mode is accurate. If sync
    // does fail, the persistent syncStatus notice below explains it; this
    // never pretends nothing happened.
    setEditing(false)
  }

  function handleDelete() {
    if (!word) return // Double-click/repeat-trigger protection lives inside ConfirmDialog
    setDeleting(true)
    // Can't wait for the await to finish before navigating: deleteWords
    // synchronously removes the word from words before its own await, and
    // React 19 batches that setState together with setDeleting into the
    // same render, so word immediately becomes undefined — the page would
    // flash "this entry doesn't exist" before the network request even
    // comes back. The local delete is already the authoritative result
    // (same logic as handleSave), so navigation happens immediately; the
    // push's success or failure is explained by the persistent syncStatus
    // notice on the library page.
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
  const note = wordNote(wordNotesFile as WordNotesFile, word.id)
  const state = wordState(word, progress)
  // All null on every word but a heteronym, and all null on a heteronym whose
  // divergent sense has no respelling yet — see lib/sensePronounce.ts.
  const voices = senseVoices(word)
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
        <Button variant="ghost" size="sm" onClick={() => pronounce(word.headword)} aria-label={`朗读 ${word.headword}`}>
          <Icon name="speak" size={18} />
          发音
        </Button>
      </div>

      {/* Edits/deletes happen right on this page, same as the library page: only shown on failure, but the retry entry point needs to be within reach */}
      {syncStatus === 'error' && syncError !== null && (
        <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
      )}

      {editing ? (
        <WordEditForm word={word} saving={saving} onCancel={() => setEditing(false)} onSave={handleSave} />
      ) : (
        <>
          <Card>
            <ol className="worddetail-meaning-list">
              {word.meanings.map((m, i) => {
                const voice = voices[i]
                return (
                <li className="worddetail-meaning" key={`${m.pos}-${i}`}>
                  {/* Part of speech and meaning share share a row, presented consistently with the back of the review card */}
                  <p className="worddetail-meaning__head">
                    <span className="pos">{m.pos}</span>
                  {/* Only present on a heteronym, where the word-level
                      phonetic cannot be true of both senses — presage is
                      /prɪˈseɪdʒ/ as a verb and /ˈprɛsɪdʒ/ as a noun.
                      Reads as a redundancy on the sense that matches the
                      word-level phonetic, and is not one: once the buttons
                      below exist, this is the label saying which button
                      makes which sound. */}
                  {m.phonetic !== undefined && (
                    <span className="ipa" lang="en">
                      {m.phonetic}
                    </span>
                  )}
                  {voice !== null && (
                    <SenseSpeakButton voice={voice} headword={word.headword} pos={m.pos} />
                  )}
                    {m.share !== undefined && (
                      <span className="num faint worddetail-meaning__share">{m.share}%</span>
                    )}
                  </p>
                  <p className="worddetail-meaning__en" lang="en">
                    {m.en}
                  </p>
                  <p className="worddetail-meaning__zh">{m.zh}</p>
                </li>
                )
              })}
            </ol>
            {/* Inside the meanings card rather than a card of its own: the
                note qualifies the definitions directly above it (which
                senses are live, what can take the word as a verb, whether
                it praises or blames), and a separate card would present it
                as an unrelated section. Most words have none and this
                renders nothing at all. */}
            {note !== undefined && (
              <div className="worddetail-note">
                <p className="section-title worddetail-note__label">要点</p>
                <p>{note}</p>
              </div>
            )}
          </Card>

          {word.examples.length > 0 && (
            <Card>
              <p className="section-title worddetail-section-title">例句</p>
              <ul className="worddetail-examples">
                {word.examples.map((ex, i) => (
                  <li key={i} lang="en">
                    <ExampleSentence sentence={ex} headword={word.headword} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {hasTags && (
            <Card className="worddetail-tags">
              {word.synonyms.length > 0 && (
                <div className="worddetail-tag-group">
                  <p className="section-title worddetail-section-title">近义词</p>
                  <CaptureChips className="worddetail-chiprow" items={word.synonyms.map(s => ({ word: s }))} />
                </div>
              )}
              {word.antonyms.length > 0 && (
                <div className="worddetail-tag-group">
                  <p className="section-title worddetail-section-title">反义词</p>
                  <CaptureChips className="worddetail-chiprow" items={word.antonyms.map(s => ({ word: s }))} />
                </div>
              )}
              {word.collocations.length > 0 && (
                <div className="worddetail-tag-group">
                  <p className="section-title worddetail-section-title">常见搭配</p>
                  <CaptureChips className="worddetail-chiprow" items={word.collocations.map(s => ({ word: s }))} />
                </div>
              )}
            </Card>
          )}

          {word.etymology !== undefined && (
            <Card>
              <p className="section-title worddetail-section-title">词源</p>
              <p className="worddetail-etymology">{word.etymology}</p>
            </Card>
          )}

          {word.relatedForms.length > 0 && (
            <Card>
              <p className="section-title worddetail-section-title">同根词</p>
              {/* A chip row rather than the vertical list this used to be, so
                  a related form is staged the same way and reads the same way
                  as a synonym — on this page and on the review card. */}
              <CaptureChips
                className="worddetail-chiprow"
                items={word.relatedForms.map(rf => ({
                  word: rf.form,
                  label: (
                    <>
                      <span lang="en">{rf.form}</span>
                      <span className="chip__pos">{rf.pos}</span>
                      {rf.zh}
                    </>
                  ),
                }))}
              />
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
            {/* The usage score is an **optional** field: words added
                manually within the app won't have one. This whole tile
                doesn't render when it's absent — showing 0 or — would
                read as "you basically never encounter this word", which
                is a false conclusion. The value is written as "8 / 10"
                rather than a bare 8, so it's still interpretable away
                from its label. */}
            {word.usageScore !== undefined && (
              <div className="stat worddetail-stat--wide">
                <p className="num stat__value">{word.usageScore} / 10</p>
                <p className="stat__label">当代遇见概率</p>
              </div>
            )}
            {/* Production, kept beside the schedule rather than folded into
                it, because the whole reason the record exists is that the
                two come apart: a word can be scheduled 20 days out on a
                healthy ease and still be unproducible from Chinese. Absent
                until 回想 has actually asked it — a 0/0 tile would read as a
                failure rather than as "not measured yet", the same call the
                usage-score tile above makes. */}
            {entry?.recall !== undefined && entry.recall.reps > 0 && (
              <div className="stat worddetail-stat--wide">
                <p className="num stat__value">
                  {entry.recall.correct} / {entry.recall.reps}
                </p>
                <p className="stat__label">
                  回想说出{entry.recall.streak >= 3 ? ` · 连对 ${entry.recall.streak}` : ''}
                </p>
              </div>
            )}
            {/* The user's own verdict, and the only place all three states
                are one tap apart. It is also the only way back to a word
                marked 太简单: at 0.05 it is drawn once per ~540 rounds and
                will not come back on its own to offer the chance.

                Shown whenever the word has a progress entry, unlike the
                回想说出 tile above, which needs reps > 0 — that one reports
                a measurement and has nothing to say before the first
                answer, while a rating is an opinion the user can hold about
                a word 回想 has not asked yet. A word with no entry at all
                has never been studied, so 回想 cannot reach it and
                rateRecall would no-op; no control beats a dead one. */}
            {entry !== undefined && (
              <div className="stat worddetail-stat--wide">
                <div className="worddetail-chiprow worddetail-rating" role="group" aria-label="回想出题难度">
                  {RECALL_RATINGS.map(([level, label]) => (
                    <Chip
                      key={level}
                      label={label}
                      selected={(entry.recallRating?.level ?? 'none') === level}
                      onClick={() => rateRecall(word.id, level)}
                    />
                  ))}
                </div>
                <p className="stat__label">回想出题</p>
              </div>
            )}
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
