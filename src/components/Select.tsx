import type { ComponentPropsWithRef } from 'react'

/**
 * 下拉选择框。沿用 .input 的外观,但**保留原生箭头**:tokens.css 声明了
 * `color-scheme: light dark`,原生控件会自己跟着深浅色走,自绘一个箭头反而
 * 要为两套主题各画一遍、还得管好点击区域。
 *
 * 用它而不是数字输入框,是为了让取值范围在结构上就无法违反(义项占比只能是
 * 10–90 的整十,遇见概率只能是 1–10 的整数),校验不必再去抓打错的字。
 */
export function Select({ className, ...rest }: ComponentPropsWithRef<'select'>) {
  return <select className={className ? `input ${className}` : 'input'} {...rest} />
}
