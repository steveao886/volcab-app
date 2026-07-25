import type { CSSProperties, ReactNode } from 'react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { StateDot } from '../components/StateDot'
import { TextInput } from '../components/TextInput'
import { Textarea } from '../components/Textarea'

/**
 * 仅 DEV 可见的组件总览(路由 /dev,不进页签)。
 * 计划有意不给 UI 层写组件测试,这一页就是人工回归的落点:
 * 每个组件的每种状态都摆出来,改完设计系统对着扫一遍。
 * 生产构建里 App.tsx 用 import.meta.env.DEV 把整条路由摇掉。
 *
 * 排版辅助用内联样式而非 CSS 类,免得 dev 专用样式混进生产样式表。
 */

const ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  marginTop: 'var(--sp-3)',
}

const STACK: CSSProperties = {
  display: 'grid',
  gap: 'var(--sp-3)',
  marginTop: 'var(--sp-3)',
}

function Group({
  title,
  layout = ROW,
  children,
}: {
  title: string
  layout?: CSSProperties
  children: ReactNode
}) {
  return (
    <Card>
      <p className="pos">{title}</p>
      <div style={layout}>{children}</div>
    </Card>
  )
}

/* 词库里最长的七个词头 —— 375px 断行的回归样本 */
const LONGEST = [
  'interchangeability',
  'canonicalization',
  'extemporaneous',
  'nonrepudiation',
  'grandiloquence',
  'undervaluation',
  'circumlocution',
]

export function DevGallery() {
  return (
    <Page eyebrow="Components" title="组件总览">
      <Group title="button / variant">
        <Button variant="primary">主操作</Button>
        <Button variant="secondary">次要</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="danger">删除</Button>
      </Group>

      <Group title="button / size">
        <Button size="sm">小</Button>
        <Button size="md">中</Button>
        <Button size="lg">大</Button>
      </Group>

      <Group title="button / grade">
        <Button variant="grade-again">重来</Button>
        <Button variant="grade-hard">困难</Button>
        <Button variant="grade-good">良好</Button>
        <Button variant="grade-easy">简单</Button>
      </Group>

      <Group title="button / quiz feedback">
        <Button variant="correct" disabled>
          答对了
        </Button>
        <Button variant="incorrect" disabled>
          答错了
        </Button>
      </Group>

      <Group title="button / loading + disabled">
        <Button variant="primary" loading>
          登录中
        </Button>
        <Button variant="secondary" loading>
          查询中
        </Button>
        <Button variant="primary" disabled>
          不可用
        </Button>
      </Group>

      <Group title="button / icon · block · wrap" layout={STACK}>
        <Button variant="secondary">
          <Icon name="speak" size={18} />
          发音
        </Button>
        <Button variant="primary" block size="lg">
          开始复习
        </Button>
        <Button variant="secondary" block wrap>
          to formally revoke or repeal a law, agreement, or practice
        </Button>
      </Group>

      <Group title="chip">
        <Chip label="全部" count={476} selected />
        <Chip label="未学" count={312} />
        <Chip label="学习中" count={98} />
        <Chip label="已掌握" count={66} />
        <Chip label="abolish" interactive={false} />
        <Chip label="annul" interactive={false} />
      </Group>

      <Group title="badge · dot · checkbox">
        <Badge>已同步</Badge>
        <Badge tone="accent">新词</Badge>
        <Badge tone="success">已掌握</Badge>
        <Badge tone="warning">待同步</Badge>
        <Badge tone="danger">同步失败</Badge>
        <Badge tone="info">离线</Badge>
        <StateDot state="new" />
        <StateDot state="learning" />
        <StateDot state="review" />
        <label className="check">
          <input
            className="check__box"
            type="checkbox"
            aria-label="示例复选框"
          />
        </label>
        <label className="check">
          <input
            className="check__box"
            type="checkbox"
            defaultChecked
            aria-label="示例复选框(已选)"
          />
        </label>
      </Group>

      <Group title="field" layout={STACK}>
        <Field
          label="GitHub Token"
          htmlFor="dev-token"
          hint="只需 volcab-data 仓库的 Contents 读写权限"
        >
          <TextInput id="dev-token" type="password" placeholder="github_pat_…" />
        </Field>
        <Field label="中文释义" htmlFor="dev-zh" error="中文释义为必填">
          <TextInput id="dev-zh" />
        </Field>
        <Field label="例句" htmlFor="dev-ex" hint="2–3 句现代生活场景">
          <Textarea
            id="dev-ex"
            defaultValue="The board voted to abrogate the clause before renewal."
          />
        </Field>
        <Field label="已禁用" htmlFor="dev-disabled">
          <TextInput id="dev-disabled" defaultValue="不可编辑" disabled />
        </Field>
      </Group>

      <Group title="card variants" layout={STACK}>
        <Card pad="sm">card · pad=sm</Card>
        <Card raised>card · raised</Card>
        <a className="card card--interactive card--sm" href="#/dev">
          card · interactive(词库列表行)
        </a>
      </Group>

      <Group title="typography" layout={STACK}>
        <p className="word" lang="en">
          abrogate
        </p>
        <p className="ipa" lang="en" aria-hidden="true">
          /ˈæbrəɡeɪt/
        </p>
        <p className="pos">verb</p>
        <p>正式废除(法律、协议);中文正文用 --lh-body 的行距。</p>
        <p className="muted">muted · 次级文字</p>
        <p className="faint">faint · 三级文字</p>
        <p className="num">476 · 12 / 30 · 连续 8 天</p>
        <hr className="rule" />
        <div className="progress">
          <div className="progress__fill" style={{ width: '42%' }} />
        </div>
      </Group>

      <Group title="headword overflow · 375px 回归样本" layout={STACK}>
        {LONGEST.map((w) => (
          <p className="word word--xl" lang="en" key={w}>
            {w}
          </p>
        ))}
      </Group>
    </Page>
  )
}
