import { useRef } from 'react'
import { Icon } from '../icons'
import { PageHeader, Empty } from '../components/ui'
import { periodTime, bellTableLabel, weekdayName, type ConflictGroup, type Sess } from '../adapters'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const LEGEND: Array<[string, string]> = [
  ['math', '数学 / 语言'],
  ['mech', '力学 / 图学'],
  ['elec', '电工 / 编程'],
  ['polit', '思政'],
  ['sport', '体育']
]

export function Schedule(props: {
  week: number
  view: 'day' | 'week'
  day: number
  todayWeekday: number
  isCurrentWeek: boolean
  dateLabel: (day: number) => string
  dateFull: (day: number) => string
  sessions: Sess[]
  conflicts: ConflictGroup[]
  refreshing: boolean
  onRefresh: () => void
  onBack?: () => void
  onWeek: (delta: number) => void
  onReset: () => void
  onView: (v: 'day' | 'week') => void
  onDay: (d: number) => void
  onCourse: (id: string) => void
  onConflict: () => void
  /** 没登录 / 课表没拉到时，空状态要说得清楚，别显示成「这一天没有课程」 */
  loggedIn: boolean
  hasTable: boolean
  courseError: string
  onLogin: () => void
}) {
  const { week, view, day, todayWeekday, isCurrentWeek, dateLabel, dateFull, sessions, conflicts, refreshing } = props
  const daySessions = sessions.filter((s) => s.day === day).sort((a, b) => a.start - b.start)
  const rows = Math.min(12, Math.max(8, ...sessions.map((s) => s.end), 8))
  const conflictDays = Array.from(new Set(conflicts.map((g) => weekdayName(g.day)))).join('、')
  const countByDay = (d: number) => sessions.filter((s) => s.day === d).length

  /* 日视图左右滑动切换日期：横向位移明显大于纵向才算 */
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const next = day + (dx < 0 ? 1 : -1)
    if (next >= 1 && next <= 7) props.onDay(next)
  }

  return (
    <>
      <PageHeader
        title="课表"
        sub={`${dateLabel(1)} – ${dateLabel(7)}${isCurrentWeek ? ' · 本周' : ''}`}
        refreshing={refreshing}
        onRefresh={props.onRefresh}
        onBack={props.onBack}
      />

      <div className="sched-bar">
        <div className="stepper">
          <button aria-label="上一周" onClick={() => props.onWeek(-1)} disabled={week <= 1}>
            <Icon name="left" />
          </button>
          <b>第 {week} 周</b>
          <button aria-label="下一周" onClick={() => props.onWeek(1)} disabled={week >= 20}>
            <Icon name="arrow" />
          </button>
        </div>
        {!isCurrentWeek ? (
          <button className="today-btn" onClick={props.onReset}>
            回到本周
          </button>
        ) : null}
        <div className="segment" role="tablist" aria-label="视图">
          <button role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'selected' : ''} onClick={() => props.onView('day')}>
            日
          </button>
          <button role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'selected' : ''} onClick={() => props.onView('week')}>
            周
          </button>
        </div>
      </div>

      {view === 'day' ? (
        <>
          <div className="weekstrip">
            {DAYS.map((d) => {
              const isToday = isCurrentWeek && d === todayWeekday
              const n = countByDay(d)
              return (
                <button
                  key={d}
                  className={[day === d ? 'selected' : '', isToday ? 'today' : ''].join(' ').trim()}
                  onClick={() => props.onDay(d)}
                  aria-pressed={day === d}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={`${weekdayName(d)} ${dateFull(d)}，${n} 门课`}
                >
                  <small>{weekdayName(d).slice(1)}</small>
                  <b>{dateLabel(d).split('/')[1]}</b>
                  <i className={n ? 'has' : ''} />
                </button>
              )
            })}
          </div>

          <div className="day-title">
            <h2>
              {dateFull(day)}
              <span>{weekdayName(day)}</span>
            </h2>
            <small>{daySessions.length ? `${daySessions.length} 门课程` : ''}</small>
          </div>

          <div className="tl" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {daySessions.length ? (
              daySessions.map((s, i) => {
                const prev = daySessions[i - 1]
                const sameSlot = !!prev && prev.start === s.start && prev.end === s.end
                return (
                <div className={`tl-row${sameSlot ? ' same' : ''}`} key={s.id}>
                  <div className="tl-time">
                    {sameSlot ? null : (
                      <>
                        <b>{periodTime(s.start)[0]}</b>
                        <small>{periodTime(s.end)[1]}</small>
                      </>
                    )}
                  </div>
                  <button className="tl-card" data-cat={s.cat} onClick={() => props.onCourse(s.id)}>
                    <span className="tl-no">
                      第 {s.start}
                      {s.end > s.start ? `–${s.end}` : ''} 节
                    </span>
                    <h3>{s.name}</h3>
                    <span className="tl-meta">
                      <span>
                        <Icon name="pin" />
                        {s.room || '教室待定'}
                      </span>
                      {s.teacher ? (
                        <span>
                          <Icon name="user" />
                          {s.teacher}
                        </span>
                      ) : null}
                    </span>
                    {s.conflictIds.length ? (
                      <span className="tl-warn">
                        <Icon name="warning" />同时段还有 {s.conflictIds.length} 门课
                      </span>
                    ) : null}
                  </button>
                </div>
                )
              })
            ) : (
              <Empty
                title={!props.loggedIn ? '还没登录教务' : !props.hasTable ? '课表还没拉下来' : '这一天没有课'}
                sub={
                  !props.loggedIn
                    ? '登录后这里会显示你的课表。'
                    : !props.hasTable
                      ? props.courseError || '点右上角刷新重试一次。'
                      : '安排点自己的事吧。'
                }
                icon={!props.loggedIn || !props.hasTable ? 'warning' : 'sun'}
              >
                {!props.loggedIn ? (
                  <button className="softbtn" style={{ marginTop: 14 }} onClick={props.onLogin}>
                    <Icon name="user" /> 登录教务
                  </button>
                ) : null}
              </Empty>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="gridwrap">
            <div className="weekgrid" style={{ gridTemplateRows: `50px repeat(${rows}, 64px)` }}>
              <div />
              {DAYS.map((d) => (
                <div
                  key={`h${d}`}
                  className={`dayhead ${isCurrentWeek && d === todayWeekday ? 'today' : ''}`}
                  style={{ gridColumn: d + 1, gridRow: 1 }}
                >
                  {weekdayName(d).slice(1)}
                  <b>{dateLabel(d)}</b>
                </div>
              ))}
              {Array.from({ length: rows }, (_, i) => i + 1).map((p) => (
                <div key={`p${p}`} className="period" style={{ gridColumn: 1, gridRow: p + 1 }}>
                  {p}
                  <small>{periodTime(p)[0]}</small>
                </div>
              ))}
              {Array.from({ length: rows }, (_, i) => i + 1).map((p) =>
                DAYS.map((d) => <div key={`s${d}-${p}`} className="slot" style={{ gridColumn: d + 1, gridRow: p + 1 }} />)
              )}
              {sessions
                .filter((s) => !s.conflictIds.length || s.id === [...s.conflictIds, s.id].sort()[0])
                .map((s) => (
                  <button
                    key={s.id}
                    className="courseblock"
                    data-cat={s.cat}
                    style={{ gridColumn: s.day + 1, gridRow: `${s.start + 1} / span ${s.end - s.start + 1}` }}
                    onClick={() => props.onCourse(s.id)}
                  >
                    <b>{s.name}</b>
                    <small>{(s.room || '').replace('开元', '')}</small>
                    {s.conflictIds.length ? <span className="warning">冲突 · 另 {s.conflictIds.length} 门</span> : null}
                  </button>
                ))}
            </div>
          </div>
          <div className="legend">
            {LEGEND.map(([c, label]) => (
              <span key={c} data-cat={c}>
                <i />
                {label}
              </span>
            ))}
          </div>
        </>
      )}

      {conflicts.length ? (
        <button className="conflict" onClick={props.onConflict}>
          <Icon name="warning" />
          <span>
            <b>本周有 {conflicts.length} 组课程冲突</b>
            <br />
            {conflictDays} · 查看并确认安排
          </span>
          <Icon name="arrow" />
        </button>
      ) : null}

      <p className="footer-note">
        {view === 'day' ? '左右滑动切换日期 · ' : '左右滑动查看整周 · '}作息：{bellTableLabel()}（通用参考，非教务下发）
      </p>
    </>
  )
}
