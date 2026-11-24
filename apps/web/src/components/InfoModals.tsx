import { Icon } from '../icons'
import { Modal } from './ui'
import { bellTableLabel, periodTime, weekdayName, type ConflictGroup } from '../adapters'
import type { Theme } from '../theme'

/** 从 App.tsx 拆出的纯展示弹窗：只接 props，不碰全局状态 */

type Session = {
  id: string
  name: string
  day: number
  start: number
  end: number
  cat: string
  teacher?: string
  room?: string
  weeks?: string
  conflictIds: string[]
}

export function CourseModal({
  course,
  week,
  conflictsOf,
  onClose,
  onConflict
}: {
  course: Session
  week: number
  conflictsOf: Array<{ id: string; name: string }>
  onClose: () => void
  onConflict: () => void
}) {
  const c = course
  return (
    <Modal title="课程详情" onClose={onClose} label={`${c.name} 课程详情`}>
      <span className={`pill ${c.cat}`}>
        第 {week} 周 · {weekdayName(c.day)}
      </span>
      <h3>{c.name}</h3>
      <div className="detailrows">
        <p>
          <span>节次</span>第 {c.start}
          {c.end > c.start ? `–${c.end}` : ''} 节
        </p>
        <p>
          <span>上课时间</span>
          {periodTime(c.start)[0]}–{periodTime(c.end)[1]}（学校作息 · {bellTableLabel()}）
        </p>
        <p>
          <span>教师</span>
          {c.teacher || '—'}
        </p>
        <p>
          <span>教室</span>
          {c.room || '—'}
        </p>
        <p>
          <span>起止周</span>
          {c.weeks || '—'}
        </p>
      </div>
      {conflictsOf.length ? (
        <button className="conflict" onClick={onConflict}>
          <Icon name="warning" />
          <span className="conflict-copy">
            <b>同一时段还有 {conflictsOf.length} 门课</b>
            <br />
            {conflictsOf.map((x) => x.name).join('、')}
          </span>
          <Icon name="arrow" />
        </button>
      ) : null}
      <button className="primary" onClick={onClose}>
        知道了
      </button>
    </Modal>
  )
}

export function ConflictModal({
  groups,
  onClose,
  onPick
}: {
  groups: ConflictGroup[]
  onClose: () => void
  onPick: (id: string) => void
}) {
  return (
    <Modal title="课程冲突" onClose={onClose}>
      <p className="bodycopy">同一时间存在多门课程，请以教务系统最终安排为准。这里只展示冲突，不会替你选课。</p>
      {groups.map((g) => (
        <div key={`${g.day}-${g.start}`}>
          <div className="group-label">
            {weekdayName(g.day)} · 第 {g.start}
            {g.end > g.start ? `–${g.end}` : ''} 节
          </div>
          <div className="card">
            {g.items.map((x) => (
              <button
                className="setting taskrow"
                key={x.id}
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => onPick(x.id)}
              >
                <span style={{ flex: 1 }}>
                  <b>{x.name}</b>
                  <br />
                  <small>
                    {x.teacher || '—'} · {x.room || '—'}
                  </small>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  )
}

const THEME_CHOICES: Array<[Theme, string, string]> = [
  ['light', 'sun', '浅色'],
  ['dark', 'moon', '深色'],
  ['system', 'monitor', '跟随系统']
]

export function ThemeModal({
  theme,
  onChange,
  onClose
}: {
  theme: Theme
  onChange: (t: Theme) => void
  onClose: () => void
}) {
  return (
    <Modal title="外观与主题" onClose={onClose}>
      <p className="bodycopy">选择适合现在的色调，所有页面即时更新。</p>
      <div className="themechoices" role="radiogroup" aria-label="主题">
        {THEME_CHOICES.map(([v, icon, name]) => (
          <button
            key={v}
            role="radio"
            aria-checked={theme === v}
            className={`themechoice${theme === v ? ' selected' : ''}`}
            onClick={() => onChange(v)}
          >
            <Icon name={icon} />
            {name}
          </button>
        ))}
      </div>
      <p className="prototype">设置保存在本机。跟随系统会自动响应设备主题变化。</p>
    </Modal>
  )
}

export function AboutModal({ connected, onClose }: { connected: boolean; onClose: () => void }) {
  return (
    <Modal title="关于科小喵" onClose={onClose}>
      <div className="cat" style={{ margin: '10px auto 20px' }}>
        <Icon name="cat" />
      </div>
      <h3 style={{ textAlign: 'center' }}>科小喵 · 校园助手</h3>
      <p className="bodycopy">
        界面按已确认的 HTML 原型改写，校园数据来自教务、校园门户与智惠充电接口。
        {connected ? '' : '当前未连接本机数据服务。'}
      </p>
    </Modal>
  )
}
