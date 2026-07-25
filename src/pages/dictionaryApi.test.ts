import { describe, expect, it } from 'vitest'
import { mapDictionaryResponse } from './dictionaryApi'

/**
 * 夹具取自真实响应(2026-07-25 手动 curl api.dictionaryapi.dev 核对),
 * 裁掉了 audio/license/sourceUrls 等映射函数用不到的字段,保留真实的
 * definition/phonetic 文本与数组顺序。
 */

// curl https://api.dictionaryapi.dev/api/v2/entries/en/abrogate
// 关键特征:顶层无 phonetic,phonetics 数组为空 —— 完全没有音标可用
const ABROGATE_FIXTURE = [
  {
    word: 'abrogate',
    phonetics: [],
    meanings: [
      {
        partOfSpeech: 'verb',
        definitions: [
          {
            definition:
              'To annul by an authoritative act; to abolish by the authority of the maker or her or his successor; to repeal; — applied to the repeal of laws, decrees, ordinances, the abolition of customs, etc.',
            synonyms: [],
            antonyms: [],
          },
          { definition: 'To put an end to; to do away with.', synonyms: [], antonyms: [] },
          { definition: 'To block a process or function.', synonyms: [], antonyms: [] },
        ],
        synonyms: ['abolish', 'annul'],
        antonyms: ['establish', 'fix'],
      },
      {
        partOfSpeech: 'adjective',
        definitions: [{ definition: 'Abrogated; abolished.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
    ],
  },
]

// curl https://api.dictionaryapi.dev/api/v2/entries/en/run
// 关键特征:phonetics[0] 只有 audio 没有 text;后面两条已经带斜杠;
// meanings 有 4 条(verb, noun, verb, adjective),用来验证「只取前 3 条」
const RUN_FIXTURE = [
  {
    word: 'run',
    phonetics: [
      { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-au.mp3' },
      { text: '/ɹʊn/', audio: '' },
      { text: '/ɹʌn/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3' },
    ],
    meanings: [
      {
        partOfSpeech: 'verb',
        definitions: [{ definition: 'To run.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'noun',
        definitions: [
          {
            definition: 'Act or instance of running, of moving rapidly using the feet.',
            synonyms: [],
            antonyms: [],
            example: 'I just got back from my morning run.',
          },
          { definition: 'Act or instance of hurrying (to or from a place).', synonyms: [], antonyms: [] },
        ],
        synonyms: ['execute', 'start'],
        antonyms: ['rise'],
      },
      {
        partOfSpeech: 'verb',
        definitions: [{ definition: 'To move swiftly.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'adjective',
        definitions: [{ definition: 'In a liquid state; melted or molten.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
    ],
  },
]

// curl https://api.dictionaryapi.dev/api/v2/entries/en/happy
// 关键特征:phonetics[0] 同样只有 audio;第一条带 text 的是英式 /ˈhæpiː/
const HAPPY_FIXTURE = [
  {
    word: 'happy',
    phonetics: [
      { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/happy-au.mp3' },
      { text: '/ˈhæpiː/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/happy-uk.mp3' },
      { text: '/ˈhæpi/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/happy-us.mp3' },
    ],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'A happy event, thing, person, etc.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'Preceded by the: happy people as a group.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'verb',
        definitions: [
          {
            definition: 'Often followed by up: to become happy; to brighten up, to cheer up.',
            synonyms: [],
            antonyms: [],
          },
        ],
        synonyms: ['happify'],
        antonyms: [],
      },
      {
        partOfSpeech: 'adjective',
        definitions: [
          { definition: 'Having a feeling arising from a consciousness of well-being.', synonyms: [], antonyms: [] },
        ],
        synonyms: [],
        antonyms: [],
      },
    ],
  },
]

// curl https://api.dictionaryapi.dev/api/v2/entries/en/zzzqqq → HTTP 404
const NOT_FOUND_BODY = {
  title: 'No Definitions Found',
  message: "Sorry pal, we couldn't find definitions for the word you were looking for.",
  resolution: 'You can try the search again at later time or head to the web instead.',
}

describe('mapDictionaryResponse · 真实响应夹具', () => {
  it('abrogate:无音标(顶层缺失且 phonetics 为空),取前 2 条 meaning(该词只有 2 条)', () => {
    const result = mapDictionaryResponse(ABROGATE_FIXTURE)
    expect(result.phonetic).toBe('')
    expect(result.meanings).toEqual([
      {
        pos: 'v.',
        en: 'To annul by an authoritative act; to abolish by the authority of the maker or her or his successor; to repeal; — applied to the repeal of laws, decrees, ordinances, the abolition of customs, etc.',
      },
      { pos: 'adj.', en: 'Abrogated; abolished.' },
    ])
  })

  it('run:跳过没有 text 的 phonetics[0],取第一条有效音标;4 条 meaning 只取前 3', () => {
    const result = mapDictionaryResponse(RUN_FIXTURE)
    expect(result.phonetic).toBe('/ɹʊn/')
    expect(result.meanings).toEqual([
      { pos: 'v.', en: 'To run.' },
      { pos: 'n.', en: 'Act or instance of running, of moving rapidly using the feet.' },
      { pos: 'v.', en: 'To move swiftly.' },
    ])
  })

  it('happy:同样跳过无 text 的第一条,取英式音标;词性缩写符合本应用约定', () => {
    const result = mapDictionaryResponse(HAPPY_FIXTURE)
    expect(result.phonetic).toBe('/ˈhæpiː/')
    expect(result.meanings.map((m) => m.pos)).toEqual(['n.', 'n.', 'v.'])
  })

  it('404 的错误响应体(非数组)→ 空结果,不抛异常', () => {
    expect(mapDictionaryResponse(NOT_FOUND_BODY)).toEqual({ phonetic: '', meanings: [] })
  })
})

describe('mapDictionaryResponse · 边界与畸形输入', () => {
  it('空数组 → 空结果', () => {
    expect(mapDictionaryResponse([])).toEqual({ phonetic: '', meanings: [] })
  })

  it('null / undefined → 空结果,不抛异常', () => {
    expect(mapDictionaryResponse(null)).toEqual({ phonetic: '', meanings: [] })
    expect(mapDictionaryResponse(undefined)).toEqual({ phonetic: '', meanings: [] })
  })

  it('字符串 / 数字等完全无关的类型 → 空结果', () => {
    expect(mapDictionaryResponse('abrogate')).toEqual({ phonetic: '', meanings: [] })
    expect(mapDictionaryResponse(42)).toEqual({ phonetic: '', meanings: [] })
  })

  it('phonetics 里全是空白 text → 视为无音标', () => {
    const data = [{ phonetics: [{ text: '' }, { text: '   ' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('')
  })

  it('phonetic 文本不带斜杠 → 补全为 /.../ 形式', () => {
    const data = [{ phonetics: [{ text: 'əˈbreɪʒən' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('/əˈbreɪʒən/')
  })

  it('顶层 phonetic 字符串优先于 phonetics 数组,且同样会被归一化', () => {
    const data = [{ phonetic: 'test', phonetics: [{ text: '/should-not-use/' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('/test/')
  })

  it('顶层 phonetic 为空字符串 → 回退到 phonetics 数组', () => {
    const data = [{ phonetic: '', phonetics: [{ text: '/fallback/' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('/fallback/')
  })

  it('meaning 缺少 definitions(空数组)→ 跳过该条,不计入前 3 条配额', () => {
    const data = [
      {
        meanings: [
          { partOfSpeech: 'verb', definitions: [] },
          { partOfSpeech: 'noun', definitions: [{ definition: 'ok' }] },
        ],
      },
    ]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'n.', en: 'ok' }])
  })

  it('meaning 缺少 partOfSpeech → pos 留空字符串,而不是崩溃或塞入 undefined', () => {
    const data = [{ meanings: [{ definitions: [{ definition: 'no pos field' }] }] }]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: '', en: 'no pos field' }])
  })

  it('未知词性(非标准 partOfSpeech)→ 退化为「词.」形式的缩写', () => {
    const data = [{ meanings: [{ partOfSpeech: 'phrase', definitions: [{ definition: 'x' }] }] }]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'phrase.', en: 'x' }])
  })

  it('meanings 字段类型不对(不是数组)→ 空 meanings,不抛异常', () => {
    const data = [{ meanings: 'oops' }]
    expect(mapDictionaryResponse(data).meanings).toEqual([])
  })

  it('definitions 元素不是对象 / definition 不是字符串 → 逐个跳过继续找', () => {
    const data = [
      {
        meanings: [
          { partOfSpeech: 'verb', definitions: [null, 42, { definition: 123 }, { definition: 'valid' }] },
        ],
      },
    ]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'v.', en: 'valid' }])
  })

  it('超过 3 条 meaning 时只取前 3 条(即使全部有效)', () => {
    const data = [
      {
        meanings: Array.from({ length: 5 }, (_, i) => ({
          partOfSpeech: 'noun',
          definitions: [{ definition: `def-${i}` }],
        })),
      },
    ]
    expect(mapDictionaryResponse(data).meanings).toEqual([
      { pos: 'n.', en: 'def-0' },
      { pos: 'n.', en: 'def-1' },
      { pos: 'n.', en: 'def-2' },
    ])
  })

  it('数组第一项不是对象(如 null 打头)→ 跳过,继续找第一个可用词条', () => {
    const data = [null, { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'second entry' }] }] }]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'n.', en: 'second entry' }])
  })
})
