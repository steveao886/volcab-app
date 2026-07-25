import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export interface NoteOut { title: string; boldTerms: string[]; text: string }

export function parseEnex(xml: string): NoteOut[] {
  const notes: NoteOut[] = []
  for (const m of xml.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
    const block = m[1]
    const title = block.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    const cdata = block.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? ''
    const boldTerms = [...cdata.matchAll(/<b>([\s\S]*?)<\/b>/g)]
      .map(b => clean(b[1]))
      .filter(t => t.length > 0)
    notes.push({ title, boldTerms, text: clean(cdata) })
  }
  return notes
}

function clean(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// CLI 入口:npm run parse-enex
if (process.argv[1]?.replace(/\\/g, '/').endsWith('parse-enex.ts')) {
  const xml = readFileSync('Volcab.enex', 'utf8')
  const notes = parseEnex(xml)
  mkdirSync('scripts/out', { recursive: true })
  writeFileSync('scripts/out/candidates.json', JSON.stringify(notes, null, 2))
  console.log(`解析 ${notes.length} 篇笔记,粗体词共 ${notes.reduce((n, x) => n + x.boldTerms.length, 0)} 个`)
}
