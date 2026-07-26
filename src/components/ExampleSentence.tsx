import { splitByHeadword } from '../lib/headword'

/**
 * 例句,词头(含屈折变形)高亮。
 *
 * 用 <mark> 而不是 <span>:语义上就是「为便于查阅而标出的片段」,屏幕阅读器
 * 也会照此播报。默认的黄底与「墨与纸」不搭,由 .example-hit 覆盖掉。
 *
 * 定位不到时整句原样渲染 —— 高亮是锦上添花,不该因为定位失败就少显示什么。
 */
export function ExampleSentence({ sentence, headword }: { sentence: string; headword: string }) {
  return (
    <>
      {splitByHeadword(sentence, headword).map((seg, i) =>
        seg.hit ? (
          <mark className="example-hit" key={i}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
