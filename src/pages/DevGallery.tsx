import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { Page } from '../components/Page'
import { StateDot } from '../components/StateDot'
import { SyncStatus } from '../components/SyncStatus'
import { TextInput } from '../components/TextInput'
import { Textarea } from '../components/Textarea'

/**
 * Component overview visible only in DEV (route /dev, not in the tab bar).
 * The plan deliberately skips writing component tests for the UI layer, so
 * this page is where manual regression happens: every state of every
 * component is laid out here, to be scanned by eye after design-system
 * changes.
 * In production builds, App.tsx tree-shakes the whole route out via
 * import.meta.env.DEV.
 *
 * Layout helpers use inline styles rather than CSS classes, so dev-only
 * styles don't leak into the production stylesheet.
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

/* The group title originally borrowed .pos, but .pos is a part-of-speech
   tag (vermilion = annotation), not a section heading; and this page also
   happens to display .pos itself, so the two looking identical would just
   make it unclear which one is the sample. Same treatment as
   components.css's .section-title, just via inline styles here. */
const LABEL: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  lineHeight: 'var(--lh-tight)',
  letterSpacing: '0.02em',
  color: 'var(--text-muted)',
}

/* The stat grid's container is the page's responsibility (column count is a
   layout decision) — this just provides one inline for the demo */
const statsGrid = (columns: number): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${columns}, 1fr)`,
  gap: 'var(--sp-3)',
  textAlign: 'center',
  marginTop: 'var(--sp-3)',
})

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
      <p style={LABEL}>{title}</p>
      <div style={layout}>{children}</div>
    </Card>
  )
}

/* The seven longest headwords in the library — a regression sample for
   wrapping at 375px */
const LONGEST = [
  'interchangeability',
  'canonicalization',
  'extemporaneous',
  'nonrepudiation',
  'grandiloquence',
  'undervaluation',
  'circumlocution',
]

/** ConfirmDialog's three looks: plain explanation / with a list / confirming in progress */
type ConfirmDemo = null | 'plain' | 'list' | 'busy'

export function DevGallery() {
  const [confirmDemo, setConfirmDemo] = useState<ConfirmDemo>(null)
  const focusTargetRef = useRef<HTMLButtonElement>(null)
  const noop = () => {}

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

      {/* Button declares a ref prop (React 19's ref-as-prop); the quiz page
          relies on it to hand focus to "Next question" after grading, and
          the settings page's exit-confirm relies on it to hand focus to
          "Cancel". Clicking the left one should move focus to the right one
          immediately (you should see the focus ring). */}
      <Group title="button / ref">
        <Button variant="secondary" onClick={() => focusTargetRef.current?.focus()}>
          把焦点交给右边
        </Button>
        <Button ref={focusTargetRef} variant="primary">
          接住焦点的按钮
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

      {/* --- Below are shared primitives promoted from individual pages during the integration phase --- */}

      <Group title="stat · 三栏(今日页)" layout={statsGrid(3)}>
        <div className="stat">
          <p className="num stat__value">12</p>
          <p className="stat__label">今日到期</p>
        </div>
        <div className="stat">
          <p className="num stat__value">5</p>
          <p className="stat__label">新词</p>
        </div>
        <div className="stat">
          <p className="num stat__value stat__value--accent">8</p>
          <p className="stat__label">连续天数</p>
        </div>
      </Group>

      <Group title="stat · 四格 + --row(词条页)" layout={statsGrid(2)}>
        <div className="stat">
          <p className="stat__value stat__value--row">
            <StateDot state="learning" />
            学习中
          </p>
          <p className="stat__label">学习状态</p>
        </div>
        <div className="stat">
          <p className="num stat__value">2026-07-30</p>
          <p className="stat__label">到期日</p>
        </div>
        <div className="stat">
          <p className="num stat__value">7</p>
          <p className="stat__label">复习次数</p>
        </div>
        <div className="stat">
          <p className="num stat__value">2</p>
          <p className="stat__label">失误次数</p>
        </div>
      </Group>

      {/* Deliberately a separate primitive from .stat: that one is a
          centered big-number tile, this one is a single-line read-only
          metadata row with the label on the left and value on the right.
          Don't merge them. */}
      <Group title="settings-row(≠ stat)" layout={STACK}>
        <div className="settings-row">
          <p className="settings-row__label">GitHub 用户</p>
          <p className="settings-row__value">octocat</p>
        </div>
        <div className="settings-row">
          <p className="settings-row__label">Token</p>
          <p className="settings-row__value num">•••• 4f2a</p>
        </div>
      </Group>

      <Group title="sync · badge(页头 actions 槽)">
        <SyncStatus status="synced" onRetry={noop} />
        <SyncStatus status="pending" onRetry={noop} />
        <SyncStatus status="offline" onRetry={noop} />
        <SyncStatus status="error" onRetry={noop} />
      </Group>

      <Group title="sync · note(正文内联)" layout={STACK}>
        <SyncStatus variant="note" status="synced" onRetry={noop} />
        <SyncStatus variant="note" status="pending" onRetry={noop} />
        <SyncStatus variant="note" status="offline" onRetry={noop} />
        <SyncStatus
          variant="note"
          status="error"
          message="GitHub 接口调用过于频繁,已被限流。改动都在本地,过一会儿会自动重试。"
          onRetry={noop}
        />
      </Group>

      <Group title="disclosure" layout={STACK}>
        <details className="disclosure">
          <summary className="disclosure__summary">收起时的样子(点开看三角旋转)</summary>
          <div style={{ padding: 'var(--sp-4)', color: 'var(--text-muted)' }}>
            展开后 summary 下缘补一条发丝线。
          </div>
        </details>
        <details className="disclosure" open>
          <summary className="disclosure__summary">默认展开的样子</summary>
          <div style={{ padding: 'var(--sp-4)', color: 'var(--text-muted)' }}>
            三角旋转 90°;减弱动效时直接到位。
          </div>
        </details>
      </Group>

      <Group title="empty-state" layout={STACK}>
        <div className="empty-state">
          <p className="empty-state__title">词库还是空的</p>
          <p className="empty-state__hint">去添加第一个词条吧。</p>
          <Button variant="primary">添加新词</Button>
        </div>
        <div className="empty-state">
          <p className="empty-state__title">没有匹配"abrog"的词条</p>
          <p className="empty-state__hint">换个关键词,或清除筛选条件再试试。</p>
        </div>
      </Group>

      <Group title="confirm-dialog">
        <Button variant="danger" onClick={() => setConfirmDemo('plain')}>
          单个词条
        </Button>
        <Button variant="danger" onClick={() => setConfirmDemo('list')}>
          带词头清单
        </Button>
        <Button variant="danger" onClick={() => setConfirmDemo('busy')}>
          删除进行中
        </Button>
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

      {/* The three confirm dialogs share one component instance slot: only one can be open at a time */}
      <ConfirmDialog
        open={confirmDemo !== null}
        titleId="dev-confirm-title"
        title={confirmDemo === 'plain' ? '删除「abrogate」?' : '删除选中的 3 个词条?'}
        body="它们的学习进度(状态、复习次数、失误次数等)会一并清除,且无法恢复。"
        detail={confirmDemo === 'list' ? 'abrogate、canonicalization、due diligence' : undefined}
        confirmLabel="确认删除"
        busy={confirmDemo === 'busy'}
        onConfirm={() => setConfirmDemo(null)}
        onCancel={() => setConfirmDemo(null)}
      />
    </Page>
  )
}
