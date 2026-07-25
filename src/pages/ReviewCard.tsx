import { Chip } from '../components/Chip'
import type { Word } from '../types'

/**
 * 复习卡翻面后的内容:音标 + 全部释义 + 例句 + 近/反义词 + 搭配 + 同根词。
 * 拆成单独组件是因为这块内容比正面(词头 + 发音)重得多,
 * 且每个区块都要在数组为空时整体不渲染 —— 单独放一个文件更容易看清这条规则。
 */

function TagRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="review-tags">
      <p className="review-tags__label pos">{label}</p>
      <div className="review-tags__row">
        {items.map((item) => (
          <Chip key={item} interactive={false} label={<span lang="en">{item}</span>} />
        ))}
      </div>
    </div>
  )
}

export function ReviewCardBack({ word }: { word: Word }) {
  const showIndex = word.meanings.length > 1

  return (
    <div className="review-back">
      <p className="ipa" lang="en" aria-hidden="true">
        {word.phonetic}
      </p>

      <ol className="review-meanings">
        {word.meanings.map((m, i) => (
          <li className="review-meaning" key={`${m.pos}-${i}`}>
            <p className="review-meaning__head">
              {showIndex && <span className="review-meaning__idx num faint">{i + 1}</span>}
              <span className="pos">{m.pos}</span>
            </p>
            {/* 故意选择:英文释义走全权重正文色,中文释义走 .muted 降一档。
                词库定位在 C1/C2(circumlocution / grandiloquence 这个难度),
                复习翻面后应该先靠英文释义完成"用英语理解英语"的复述与确认——
                这也是页面视觉方向"辞书排版"的应有取舍:辞书正文是被释义的语言,
                译文是边注。中文译文仍然在场、随时可读,只是不作为主目标。
                这不是"中文不重要",是刻意把认知目标锚在英文释义上。 */}
            <p lang="en">{m.en}</p>
            <p className="muted">{m.zh}</p>
          </li>
        ))}
      </ol>

      {word.examples.length > 0 && (
        <div className="review-tags">
          <p className="review-tags__label pos">例句</p>
          <ul className="review-examples">
            {word.examples.map((ex) => (
              <li key={ex} lang="en">
                {ex}
              </li>
            ))}
          </ul>
        </div>
      )}

      {word.synonyms.length > 0 && <TagRow label="近义词" items={word.synonyms} />}
      {word.antonyms.length > 0 && <TagRow label="反义词" items={word.antonyms} />}
      {word.collocations.length > 0 && <TagRow label="搭配" items={word.collocations} />}

      {word.relatedForms.length > 0 && (
        <div className="review-tags">
          <p className="review-tags__label pos">同根词</p>
          <div className="review-tags__row">
            {word.relatedForms.map((rf) => (
              <Chip
                key={rf.form}
                interactive={false}
                label={
                  <>
                    <span lang="en">{rf.form}</span>
                    <span className="review-tags__pos">{rf.pos}</span>
                    {rf.zh}
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
