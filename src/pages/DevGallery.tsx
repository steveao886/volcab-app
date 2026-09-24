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
import { ProgressMarks } from '../components/ProgressMarks'
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
 * Laid out in the 朱批 vocabulary it exists to show: each group is a
 * section under a ruled head, not a card. Layout helpers use inline styles
 * rather than CSS classes, so dev-only styles don't leak into the
 * production stylesheet.
 */

const ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--sp-3)',
}

const STACK: CSSProperties = {
  display: 'grid',
  gap: 'var(--sp-3)',
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
    <section className="section">
      <h2 className="section-head">{title}</h2>
      <div style={layout}>{children}</div>
    </section>
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
    <Page title="组件总览">
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

      <Group title="button / quiz feedback">
        <Button variant="correct" disabled>
          答对了
        </Button>
        <Button variant="incorrect" disabled>
          答错了
        </Button>
      </Group>

      <Group title="button / loading, disabled">
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

      <Group title="button / icon, block, wrap" layout={STACK}>
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

      {/* The grade row of 复习, shared with 练习 and 回想: ruled, 界栏
          between the columns, the miss in cinnabar, keys printed. */}
      <Group title="ruled-row（复习、练习、回想）" layout={STACK}>
        <div className="ruled-row">
          <Button className="ruled-row__miss">
            <span className="ruled-row__label">重来<span className="key">1</span></span>
            <span className="num ruled-row__sub">稍后</span>
          </Button>
          <Button>
            <span className="ruled-row__label">困难<span className="key">2</span></span>
            <span className="num ruled-row__sub">1 天</span>
          </Button>
          <Button>
            <span className="ruled-row__label">良好<span className="key">3</span></span>
            <span className="num ruled-row__sub">4 天</span>
          </Button>
          <Button>
            <span className="ruled-row__label">简单<span className="key">4</span></span>
            <span className="num ruled-row__sub">9 天</span>
          </Button>
        </div>
        <Button variant="primary" block>
          提交 <span className="key">Enter</span>
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

      <Group title="state marks、badge、checkbox">
        <StateDot state="new" />
        <StateDot state="learning" />
        <StateDot state="review" />
        <Badge>已同步</Badge>
        <Badge tone="accent">新词</Badge>
        <Badge tone="success">已掌握</Badge>
        <Badge tone="warning">待同步</Badge>
        <Badge tone="danger">同步失败</Badge>
        <Badge tone="info">离线</Badge>
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

      <Group title="marks：圈点、勾、旁批、波浪线" layout={STACK}>
        <ProgressMarks done={3} total={10} label="示例进度" valueText="第 4 / 10 题" />
        <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <span className="mark-tick" aria-hidden="true" />
          已保存
        </p>
        <div className="margin-note">
          <p className="margin-note__label">要点</p>
          <p className="margin-note__text">只形容坏事自行减弱，主语是坏事本身，不能带宾语。</p>
        </div>
        <p lang="en">
          The storm finally <mark className="example-hit">abated</mark> after midnight.
        </p>
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

      {/* The only boxes left: the flip card, a self-contained prompt, and
          what floats (dialogs, the update prompt). */}
      <Group title="card（只剩翻面卡与浮层）" layout={STACK}>
        <Card pad="sm">card，pad=sm</Card>
        <Card raised>card，raised</Card>
      </Group>

      <Group title="ledger：主次文字加数值" layout={STACK}>
        <ul className="ledger">
          <li>
            <a className="ledger__row" href="#/dev">
              <span className="ledger__main">
                <span className="ledger__word" lang="en">abrogate</span>
                <span className="ledger__secondary">正式废除（法律、协议）</span>
              </span>
              <StateDot state="review" />
            </a>
          </li>
          <li>
            <a className="ledger__row" href="#/dev">
              <span className="ledger__main">
                <span className="ledger__primary">回想</span>
                <span className="ledger__secondary">只看中文，回想英文词</span>
              </span>
              <span className="ledger__value">71%</span>
            </a>
          </li>
        </ul>
      </Group>

      <Group title="ledger：标签加数值（设置、词条页）" layout={STACK}>
        <dl className="ledger">
          <div className="ledger__row">
            <dt className="ledger__label">GitHub 用户</dt>
            <dd className="ledger__value" style={{ margin: 0 }}>octocat</dd>
          </div>
          <div className="ledger__row">
            <dt className="ledger__label">Token</dt>
            <dd className="ledger__value" style={{ margin: 0 }}>•••• 4f2a</dd>
          </div>
        </dl>
      </Group>

      <Group title="readout 与界栏（数据页）" layout={STACK}>
        <div className="readout">
          <p className="readout__value">2781</p>
          <p className="readout__label">次复习</p>
        </div>
        <div className="readouts">
          <div className="readout">
            <p className="readout__value">4</p>
            <p className="readout__label">当前连续</p>
          </div>
          <div className="readout">
            <p className="readout__value">56</p>
            <p className="readout__label">最长连续</p>
          </div>
          <div className="readout">
            <p className="readout__value">60</p>
            <p className="readout__label">累计学习</p>
          </div>
          <div className="readout">
            <p className="readout__value">291</p>
            <p className="readout__label">测验次数</p>
          </div>
        </div>
      </Group>

      <Group title="chart tokens：黛紫、赭石">
        <span style={{ width: 40, height: 12, background: 'var(--chart-1)' }} />
        <span className="muted">--chart-1</span>
        <span style={{ width: 40, height: 12, background: 'var(--chart-2)' }} />
        <span className="muted">--chart-2</span>
      </Group>

      <Group title="sync badge（页头 actions 槽）">
        <SyncStatus status="synced" onRetry={noop} />
        <SyncStatus status="pending" onRetry={noop} />
        <SyncStatus status="offline" onRetry={noop} />
        <SyncStatus status="error" onRetry={noop} />
      </Group>

      <Group title="sync note（正文内联）" layout={STACK}>
        <SyncStatus variant="note" status="synced" onRetry={noop} />
        <SyncStatus variant="note" status="pending" onRetry={noop} />
        <SyncStatus variant="note" status="offline" onRetry={noop} />
        <SyncStatus
          variant="note"
          status="error"
          message="GitHub 接口调用过于频繁，已被限流。改动都在本地，过一会儿会自动重试。"
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
          <p className="empty-state__hint">换个关键词，或清除筛选条件再试试。</p>
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
        <p className="muted">muted，次级文字</p>
        <p className="faint">faint，三级文字</p>
        <p className="num">476　12 / 30　连续 8 天</p>
        <hr className="rule" />
        <div className="progress">
          <div className="progress__fill" style={{ width: '42%' }} />
        </div>
      </Group>

      <Group title="headword overflow（375px 回归样本）" layout={STACK}>
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
        body="它们的学习进度(状态、复习次数、失误次数等)会一并清除，且无法恢复。"
        detail={confirmDemo === 'list' ? 'abrogate、canonicalization、due diligence' : undefined}
        confirmLabel="确认删除"
        busy={confirmDemo === 'busy'}
        onConfirm={() => setConfirmDemo(null)}
        onCancel={() => setConfirmDemo(null)}
      />
    </Page>
  )
}
