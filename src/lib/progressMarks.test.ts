import { describe, expect, it } from 'vitest'
import { progressMarks } from './progressMarks'

describe('progressMarks', () => {
  it('marks the finished items, the one in hand, and the rest', () => {
    expect(progressMarks(2, 5, 28)).toEqual(['done', 'done', 'current', 'todo', 'todo'])
  })
  it('has no current mark before the first item is shown', () => {
    expect(progressMarks(0, 3, 28)).toEqual(['current', 'todo', 'todo'])
  })
  it('marks everything done once the last item is finished', () => {
    expect(progressMarks(3, 3, 28)).toEqual(['done', 'done', 'done'])
  })
  it('clamps a done count past the total instead of inventing marks', () => {
    expect(progressMarks(9, 3, 28)).toEqual(['done', 'done', 'done'])
  })
  it('draws exactly max marks at the limit', () => {
    expect(progressMarks(0, 28, 28)).toHaveLength(28)
  })
  it('gives up past the limit so the caller can draw a bar', () => {
    expect(progressMarks(0, 29, 28)).toBeNull()
  })
  it('gives up on an empty session', () => {
    expect(progressMarks(0, 0, 28)).toBeNull()
  })
})
