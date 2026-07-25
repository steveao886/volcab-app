import type { ComponentPropsWithRef } from 'react'

/**
 * 按钮。
 * primary            墨板实心 —— 页面唯一主操作
 * secondary          纸面 + 描边
 * ghost              纯文字
 * danger             实心朱砂 —— 只给破坏性操作
 * grade-*            SRS 四档打分(重来/困难/良好/简单),热→冷一条温度带
 * correct/incorrect  测验判题反馈,置灰后仍保持颜色
 *
 * 外观互斥,所以统一走 variant,而不是「secondary + 另加一个 class」,
 * 免得两条 background 声明靠打包顺序决胜负。
 *
 * 样式全在 CSS(.btn / .btn--*),需要一个「长得像按钮的链接」时,
 * 直接给 <Link> 写 className="btn btn--secondary" 即可,不必包装组件。
 *
 * props 用 ComponentPropsWithRef 而不是 ButtonHTMLAttributes:React 19 里
 * ref 就是一个普通 prop,但只有声明了它才拿得到 —— 它跟着 ...rest 落到
 * <button> 上。判完题把焦点交给「下一题」、确认面板展开把焦点交给「取消」,
 * 都要真正的 ref;缺了它,调用方只能退回 getElementById / querySelector。
 */
interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?:
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'danger'
    | 'grade-again'
    | 'grade-hard'
    | 'grade-good'
    | 'grade-easy'
    | 'correct'
    | 'incorrect'
  size?: 'sm' | 'md' | 'lg'
  /** 撑满一行 */
  block?: boolean
  /** 允许长文案换行并左对齐(测验选项是整句英文释义) */
  wrap?: boolean
  /** 加载中:置 aria-busy、禁用并显示转圈 */
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  wrap = false,
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`]
  if (size !== 'md') classes.push(`btn--${size}`)
  if (block) classes.push('btn--block')
  if (wrap) classes.push('btn--wrap')
  if (className) classes.push(className)

  return (
    <button
      type={type}
      className={classes.join(' ')}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
