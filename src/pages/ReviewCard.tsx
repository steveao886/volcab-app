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
      <p className="review-tags__label section-title">{label}</p>
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
      {/* 音标整体 aria-hidden(屏幕阅读器读 IPA 只会念出一串乱码),但遇见概率
          必须读得出来 —— 所以它是同一行里的另一个元素,不能塞进 .ipa 里。 */}
      <div className="review-back__head">
        <p className="ipa" lang="en" aria-hidden="true">
          {word.phonetic}
        </p>
        {word.usageScore !== undefined && (
          <p className="review-usage">
            <span className="faint">遇见概率</span>{' '}
            <span className="num review-usage__value">{word.usageScore}</span>
            <span className="faint num">/10</span>
          </p>
        )}
      </div>

      <ol className="review-meanings">
        {word.meanings.map((m, i) => (
          <li className="review-meaning" key={`${m.pos}-${i}`}>
            <p className="review-meaning__head">
              {showIndex && <span className="review-meaning__idx num faint">{i + 1}</span>}
              <span className="pos">{m.pos}</span>
              {/* 占比走 .faint,是边注不是主角:翻面后第一眼该落在英文释义上。
                  数据层已按占比降序排好(见 scripts/validate-words.ts),这里
                  不排序 —— 前面那个序号因此顺带就是常用度次序。 */}
              {m.share !== undefined && (
                <span className="num faint review-meaning__share">{m.share}%</span>
              )}
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
          <p className="review-tags__label section-title">例句</p>
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
          <p className="review-tags__label section-title">同根词</p>
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
