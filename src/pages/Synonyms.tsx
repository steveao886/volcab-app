import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Page } from '../components/Page'
import { ProgressMarks } from '../components/ProgressMarks'
import contrastNotesFile from '../data/contrastNotes.json'
import synonymNotesFile from '../data/synonymNotes.json'
import wordNotesFile from '../data/wordNotes.json'
import type { ContrastNotesFile } from '../lib/contrastNotes'
import { isEditableTarget } from '../lib/keys'
import { groupView } from '../lib/synonymContent'
import type { GroupView, SynonymNotesFile } from '../lib/synonymContent'
import { buildSynonymGroups } from '../lib/synonymGroups'
import type { SynonymGroup } from '../lib/synonymGroups'
import { oppositeGroups } from '../lib/synonymOpposites'
import { pickVisit, resolveVisit } from '../lib/synonymVisit'
import type { WordNotesFile } from '../lib/wordNotes'
import { useApp } from '../state/store'
import { enterIntent } from './synonymsEnter'
import './Review.css'
import './Synonyms.css'

/**
 * 近义词 — studied words that share a Chinese gloss, a few groups a visit
 * (docs/superpowers/specs/2026-10-23-synonym-groups-design.md). Reading only:
 * the one write is the last-seen stamp, as each group is left.
 *
 * **A visit is picked once and held as keys.** Every stamp re-renders with
 * new progress, and re-picking then would reshuffle the groups under the
 * reader; resolving the held keys against the current groups instead lets a
 * group that vanished mid-visit (a word deleted on another device) simply drop
 * out, with the counter following.
 */
export function Synonyms() {
  const { words, progress, markSynonymsSeen } = useApp()
  // On the word list alone (spec R1): a stamp, a review or a sync of progress
  // never rebuilds the groups.
  const groups = useMemo(() => buildSynonymGroups(words), [words])
  const [visit, setVisit] = useState(() => ({
    keys: pickVisit(groups, progress.synonymSeen, progress.words).map((g) => g.key),
    left: [] as string[],
  }))

  const wordsById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words])
  // Each group's opposite group, when it has a clear one (spec R3).
  const opposites = useMemo(() => {
    const byKey = new Map(groups.map((g) => [g.key, g]))
    return new Map([...oppositeGroups(groups, words)].flatMap(([k, o]) => {
      const g = byKey.get(o)
      return g === undefined ? [] : [[k, g] as const]
    }))
  }, [groups, words])
  const shown = useMemo(
    () => resolveVisit(visit.keys, groups).flatMap((group) => {
      const view = groupView(
        group, wordsById,
        synonymNotesFile as SynonymNotesFile,
        contrastNotesFile as ContrastNotesFile,
        wordNotesFile as WordNotesFile,
        opposites.get(group.key),
      )
      return view === null ? [] : [{ group, view }]
    }),
    [visit.keys, groups, wordsById, opposites],
  )
  const index = shown.findIndex((s) => !visit.left.includes(s.group.key))
  const current = index === -1 ? undefined : shown[index]

  const leave = useCallback((group: SynonymGroup) => {
    markSynonymsSeen(group.terms)
    setVisit((v) => (v.left.includes(group.key) ? v : { ...v, left: [...v.left, group.key] }))
  }, [markSynonymsSeen])

  const again = useCallback(() => {
    setVisit({ keys: pickVisit(groups, progress.synonymSeen, progress.words).map((g) => g.key), left: [] })
  }, [groups, progress.synonymSeen, progress.words])

  // Enter does what the visible button does, on keydown with preventDefault,
  // and a held Enter's repeats are cancelled rather than ignored: see
  // enterIntent for the 组句 mechanism both guard against.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement
      const focus = isEditableTarget(active) ? 'editable' : active instanceof HTMLAnchorElement ? 'link' : 'other'
      const intent = enterIntent(e, focus, current !== undefined || shown.length > 0)
      if (intent === 'pass') return
      e.preventDefault()
      if (intent === 'swallow') return
      if (current !== undefined) leave(current.group)
      else again()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, shown.length, leave, again])

  // Each group opens at its top. A long one (6 words, their 要点 and up to 15
  // pair notes) runs several screens at 375px, and the window kept its scroll,
  // so the next group opened past its title (final review, 2026-10-23); the
  // same fix as Untangle.tsx's stage effect.
  const currentKey = current?.group.key
  useEffect(() => { window.scrollTo(0, 0) }, [currentKey])

  // The second click of a double click lands on the next group's button,
  // which would stamp a group nobody read.
  const click = (act: () => void) => (e: ReactMouseEvent) => {
    if (e.detail > 1) return
    act()
  }

  if (groups.length === 0) {
    return (
      <Page title="近义词" back="/">
        <p className="muted">学过的词里还没有共用一个中文意思的，多学一些再来。</p>
      </Page>
    )
  }

  if (current === undefined) {
    return (
      <Page title="近义词" back="/">
        <div className="review-done">
          <p className="review-done__label">看完 <span className="num">{shown.length}</span> 组</p>
          <Button variant="primary" block onClick={click(again)}>
            再看 {Math.min(shown.length, groups.length)} 组<span className="key">Enter</span>
          </Button>
          <Link to="/" className="btn btn--secondary btn--block">回今日</Link>
        </div>
      </Page>
    )
  }

  const n = index + 1
  const m = shown.length
  return (
    <Page title="近义词" back="/">
      <div className="review-progress">
        <ProgressMarks done={index} total={m} label="近义词进度" valueText={`第 ${n} 组，共 ${m} 组`} />
        <p className="muted review-progress__count">
          第 <span className="num">{n}</span> 组，共 <span className="num">{m}</span> 组
        </p>
      </div>
      <GroupBlock key={current.group.key} view={current.view} />
      <Button variant="primary" block onClick={click(() => leave(current.group))}>
        {n === m ? '看完了' : '下一组'}<span className="key">Enter</span>
      </Button>
    </Page>
  )
}

function GroupBlock({ view }: { view: GroupView }) {
  const headword = new Map(view.members.map((m) => [m.id, m.headword]))
  return (
    <article className="synonyms-group">
      <header>
        <h2 className="synonyms-group__term">{view.title}</h2>
        <p className="muted synonyms-group__count"><span className="num">{view.members.length}</span> 个词</p>
      </header>

      <section className="section">
        <h3 className="section-head">并排看</h3>
        <ul className="ledger">
          {view.members.map((m) => (
            <li key={m.id} className="ledger__row synonyms-member">
              <span className="ledger__word" lang="en">{m.headword}</span>
              {m.meanings.map((x, i) => (
                <span key={i} className="synonyms-member__meaning">
                  <span className="pos">{x.pos}</span>
                  <span className="ledger__secondary">{x.zh}</span>
                </span>
              ))}
              {m.usage.length > 0 && <span className="synonyms-member__usage" lang="en">{m.usage.join('、')}</span>}
              {m.antonyms.length > 0 && (
                <span className="synonyms-member__antonyms">
                  <span className="synonyms-member__tag">反义</span>
                  <span lang="en">{m.antonyms.join('、')}</span>
                </span>
              )}
              {/* A lone part of speech brings its base word (spec R2), so the
                  paragraph can compare like with like. */}
              {m.bridge !== undefined && (
                <span className="synonyms-member__bridge">
                  <span className="synonyms-member__tag">同根</span>
                  <span className="synonyms-member__form" lang="en">{m.bridge.form}</span>
                  <span className="pos">{m.bridge.pos}</span>
                  <span className="ledger__secondary">{m.bridge.zh}</span>
                  {m.bridge.usage.length > 0 && (
                    <span className="synonyms-member__usage" lang="en">{m.bridge.usage.join('、')}</span>
                  )}
                </span>
              )}
              {m.note !== undefined && (
                <div className="margin-note">
                  <p className="margin-note__label">要点</p>
                  <p className="margin-note__text">{m.note}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h3 className="section-head">差别在哪</h3>
        {view.kind === 'paragraph' ? (
          <div className="margin-note">
            <p className="margin-note__label">辨析</p>
            <p className="margin-note__text">{view.text}</p>
          </div>
        ) : (
          <>
            {view.pairs.length > 0 && (
              <ul className="ledger">
                {view.pairs.map((p) => (
                  <li key={`${p.a}|${p.b}`} className="review-tangle__item">
                    <p className="review-tangle__pair">
                      <span lang="en">{headword.get(p.a)}</span>
                      <span className="review-tangle__and">和</span>
                      <span lang="en">{headword.get(p.b)}</span>
                    </p>
                    <div className="margin-note">
                      <p className="margin-note__label">辨析</p>
                      <p className="margin-note__text">{p.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* The honest count: what tells the reader this group is
                unfinished, and the list a paragraph fills in. */}
            {view.missing > 0 && (
              <p className="faint">
                {view.pairs.length > 0 ? '其余' : '这'} <span className="num">{view.missing}</span> 对还没有辨析
              </p>
            )}
          </>
        )}
      </section>

      {/* The opposite side is another synonym group, with its own paragraph
          (spec R3). It is not stamped as seen: it keeps its own turn. */}
      {view.opposite !== undefined && (
        <section className="section">
          <h3 className="section-head">反面</h3>
          <p className="synonyms-opposite__term">{view.opposite.title}</p>
          <ul className="ledger">
            {view.opposite.members.map((m) => (
              <li key={m.id} className="ledger__row synonyms-member">
                <span className="ledger__word" lang="en">{m.headword}</span>
                {m.meanings.map((x, i) => (
                  <span key={i} className="synonyms-member__meaning">
                    <span className="pos">{x.pos}</span>
                    <span className="ledger__secondary">{x.zh}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {view.opposite.text !== undefined && (
            <div className="margin-note">
              <p className="margin-note__label">辨析</p>
              <p className="margin-note__text">{view.opposite.text}</p>
            </div>
          )}
        </section>
      )}
    </article>
  )
}
