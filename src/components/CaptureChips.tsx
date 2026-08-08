import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { chipCaptureStatus } from '../lib/stagingCapture'
import type { ChipCaptureStatus } from '../lib/stagingCapture'
import { useApp } from '../state/store'
import { Chip } from './Chip'

/**
 * A row of word chips where the ones you don't own yet can be tapped to
 * drop into the staging area.
 *
 * Reading a card is the moment you know you want its synonyms. Before this,
 * acting on that meant leaving the card for /add and typing the word again,
 * so it didn't happen. A tap here goes through the same addStaging →
 * staging.json path as the capture box and /discover; nothing new is stored.
 *
 * Only the chips are here. The section heading and the row's own spacing
 * stay with the page, which is why this takes a className — the review card
 * and the word detail page lay their tag blocks out differently, and
 * unifying that is not what this change is for.
 */

export interface CaptureChip {
  /** What gets staged. */
  word: string
  /** Overrides the rendered content — related forms show form + pos + zh. */
  label?: ReactNode
}

/** Chinese by design: these are UI strings. */
const MARK: Record<ChipCaptureStatus, string | undefined> = {
  'in-library': '已有',
  'in-staging': '已加入',
  addable: undefined,
  inert: undefined,
}

export function CaptureChips({ items, className }: { items: CaptureChip[]; className?: string }) {
  const { words, staging, addStaging } = useApp()
  // Tracked locally for one reason: a chip that was a <button> must not
  // become a <span> under the finger that just pressed it. addStaging
  // updates `staging` synchronously, so without this the tapped element
  // unmounts mid-interaction and keyboard focus falls back to <body> —
  // the next Tab restarts from the top of the page. Same shape and same
  // reason as the `settled` set in pages/Discover.tsx.
  const [captured, setCaptured] = useState<Set<string>>(new Set())

  const status = useMemo(() => {
    const m = new Map<string, ChipCaptureStatus>()
    for (const it of items) m.set(it.word, chipCaptureStatus(it.word, words, staging))
    return m
  }, [items, words, staging])

  function capture(word: string) {
    setCaptured(prev => new Set(prev).add(word))
    // Enqueues locally first and then pushes; a failed push leaves the word
    // staged and queued, so "已加入" stays true either way.
    void addStaging(word)
  }

  return (
    <div className={className}>
      {items.map(it => {
        const st = status.get(it.word) ?? 'inert'
        const body = it.label ?? <span lang="en">{it.word}</span>
        const done = captured.has(it.word)
        const mark = done ? MARK['in-staging'] : MARK[st]
        const content = (
          <>
            {body}
            {mark !== undefined && <span className="chip__mark">{mark}</span>}
          </>
        )

        if (st !== 'addable' && !done) {
          return <Chip key={it.word} interactive={false} label={content} />
        }

        return (
          <Chip
            key={it.word}
            toggle={false}
            // Not `disabled`: disabling a focused element blurs it, which is
            // the very thing the `captured` set exists to prevent.
            aria-disabled={done || undefined}
            aria-label={done ? `${it.word},已加入待补全` : `把 ${it.word} 加入待补全`}
            // stopPropagation runs even when the chip is spent: the review
            // card is itself a role="button" that flips on click, so a tap
            // on an inert chip would otherwise flip the card away. The
            // speak button on the card front guards the same way.
            onClick={e => { e.stopPropagation(); if (!done) capture(it.word) }}
            label={content}
          />
        )
      })}
    </div>
  )
}
