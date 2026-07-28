import { describe, expect, it } from 'vitest'
import { parseEnex } from './parse-enex'

const sample = `<?xml version="1.0"?>
<en-export>
  <note>
    <title>12-15</title>
    <content><![CDATA[<en-note><div>Her <b>austere</b> (strict) demeanor was <b>unobtrusive</b>. She worked <b>surreptitiously </b>to win.</div><div>&nbsp;&amp; more</div></en-note>]]></content>
  </note>
  <note>
    <title>101-103</title>
    <content><![CDATA[<en-note><div>A journey of endurance and zenith.</div></en-note>]]></content>
  </note>
</en-export>`

describe('parseEnex', () => {
  it('extracts each note\'s title, bold terms, and plain text', () => {
    const notes = parseEnex(sample)
    expect(notes).toHaveLength(2)
    expect(notes[0].title).toBe('12-15')
    expect(notes[0].boldTerms).toEqual(['austere', 'unobtrusive', 'surreptitiously'])
    expect(notes[0].text).toContain('austere (strict) demeanor')
    expect(notes[0].text).toContain('& more')
    expect(notes[0].text).not.toContain('<')
    expect(notes[1].boldTerms).toEqual([])
  })
})
