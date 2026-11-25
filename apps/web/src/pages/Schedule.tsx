import { useEffect, useId, useRef, useState, type TouchEvent } from 'react'
import { Icon } from '../icons'
import { PageHeader, Empty } from '../components/ui'
import { periodTime, bellTableLabel, weekdayName, type ConflictGroup, type Sess } from '../adapters'
import { haptic } from '../haptics'
import './schedule-modern.css'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEKS = Array.from({ length: 20 }, (_, index) => index + 1)
const PERIODS = Array.from({ length: 12 }, (_, index) => index + 1)
const LEGEND = [
  ['math', '数学 / 语言'],
  ['mech', '力学 / 图学'],
  ['elec', '电工 / 编程'],
  ['polit', '思政'],
  ['sport', '体育']
]

function clockMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// App supplies month/day labels for the displayed week, so the drawer can
// locate this week even when first opened from a saved, noncurrent week.
function findCurrentWeek(week: number, mondayLabel: string, now: Date) {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(mondayLabel)
  if (!match) return undefined

  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  return WEEKS.find((candidate) => {
    const displayedMonday = new Date(monday)
    displayedMonday.setDate(monday.getDate() + (week - candidate) * 7)
    return displayedMonday.getMonth() + 1 === Number(match[1]) && displayedMonday.getDate() === Number(match[2])
  })
}

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
  onSelectWeek?: (targetWeek: number) => void
  onReset: () => void
  onView: (v: 'day' | 'week') => void
  onDay: (d: number) => void
  onCourse: (id: string) => void
  onConflict: () => void
  loggedIn: boolean
  hasTable: boolean
  courseError: string
  onLogin: () => void
}) {
  const { week, view, day, todayWeekday, isCurrentWeek, dateLabel, dateFull, sessions, conflicts, refreshing } = props
  const [now, setNow] = useState(() => new Date())
  const [weeksOpen, setWeeksOpen] = useState(false)
  const [weekendOverride, setWeekendOverride] = useState<boolean | null>(null)
  const [dayTransition, setDayTransition] = useState<{ day: number; week: number; dir: 'left' | 'right' }>()
  const drawerId = useId()
  const weekToggle = useRef<HTMLButtonElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = window.setInterval(update, 15_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  const currentWeek = isCurrentWeek ? week : weeksOpen ? findCurrentWeek(week, dateLabel(1), now) : undefined
  const showWeekends = weekendOverride ?? sessions.some((session) => session.day > 5)
  const visibleDays = showWeekends ? DAYS : DAYS.slice(0, 5)
  const isToday = (d: number) => isCurrentWeek && d === todayWeekday
  const daySessions = sessions.filter((session) => session.day === day).sort((a, b) => a.start - b.start)
  const dayDir = dayTransition?.day === day && dayTransition.week === week ? dayTransition.dir : 'none'
  const conflictDays = [...new Set(conflicts.map((group) => weekdayName(group.day)))].join('、')

  const minutesNow = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const periods = PERIODS.map((number) => {
    const [start, end] = periodTime(number, now)
    return { number, start, from: clockMinutes(start), to: clockMinutes(end) }
  })
  const activePeriod = view === 'week' && isCurrentWeek && visibleDays.includes(todayWeekday)
    ? periods.find(({ from, to }) => minutesNow >= from && minutesNow < to)
    : undefined
  const activeTop = activePeriod
    ? (minutesNow - activePeriod.from) / (activePeriod.to - activePeriod.from) * 100
    : 0
  const rowCount = Math.min(12, Math.max(8, activePeriod?.number ?? 0, ...sessions.map((session) => session.end)))
  const shownPeriods = periods.slice(0, rowCount)

  const timeline = daySessions.map((session) => {
    const [start] = periodTime(session.start, now)
    const [, end] = periodTime(session.end, now)
    return { session, start, end, from: clockMinutes(start), to: clockMinutes(end) }
  })
  const nextSession = isToday(day) ? timeline.find(({ from }) => from > minutesNow) : undefined

  const selectWeek = (target: number) => {
    haptic('light')
    setWeeksOpen(false)
    if (target === week) return
    setDayTransition(undefined)
    if (props.onSelectWeek) props.onSelectWeek(target)
    else props.onWeek(target - week)
  }

  const selectDay = (target: number) => {
    if (target === day || target < 1 || target > 7) return
    haptic('light')
    setDayTransition({ day: target, week, dir: target > day ? 'left' : 'right' })
    props.onDay(target)
  }

  const selectView = (target: 'day' | 'week') => {
    if (target === view) return
    haptic('light')
    setDayTransition(undefined)
    props.onView(target)
  }

  const openCourse = (id: string) => {
    haptic('light')
    props.onCourse(id)
  }

  const onTouchStart = (event: TouchEvent) => {
    const point = event.touches[0]
    touch.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null
  }
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current
    const point = event.changedTouches[0]
    touch.current = null
    if (!start || !point || event.touches.length) return
    const dx = point.clientX - start.x
    const dy = point.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    selectDay(day + (dx < 0 ? 1 : -1))
  }

  const needsTable = !props.loggedIn || !props.hasTable
  const emptySchedule = (
    <Empty
      title={!props.loggedIn ? '还没登录教务' : !props.hasTable ? '课表还没拉下来' : view === 'day' ? '这一天没有课' : '这一周没有课'}
      sub={
        !props.loggedIn
          ? '登录后这里会显示你的课表。'
          : !props.hasTable
            ? props.courseError || '点右上角刷新重试一次。'
            : '安排点自己的事吧。'
      }
      icon={needsTable ? 'warning' : 'sun'}
    >
      {!props.loggedIn && (
        <button className="softbtn sm-login" onClick={props.onLogin}>
          <Icon name="user" /> 登录教务
        </button>
      )}
    </Empty>
  )

  return (
    <div className="schedule-modern">
      <PageHeader
        title="课表"
        sub={`${dateLabel(1)} – ${dateLabel(7)}${isCurrentWeek ? ' · 本周' : ''}`}
        refreshing={refreshing}
        onRefresh={props.onRefresh}
        onBack={props.onBack}
      />

      <div
        className="sm-controls"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && weeksOpen) {
            event.stopPropagation()
            setWeeksOpen(false)
            weekToggle.current?.focus()
          }
        }}
      >
        <div className="sm-toolbar">
          <div className="sm-stepper">
            <button aria-label="上一周" onClick={() => selectWeek(week - 1)} disabled={week <= 1}>
              <Icon name="left" />
            </button>
            <button
              ref={weekToggle}
              className="sm-week-toggle"
              aria-expanded={weeksOpen}
              aria-controls={drawerId}
              onClick={() => {
                haptic('light')
                setWeeksOpen(!weeksOpen)
              }}
            >
              第 {week} 周 <span className="sm-chevron" aria-hidden="true" />
            </button>
            <button aria-label="下一周" onClick={() => selectWeek(week + 1)} disabled={week >= 20}>
              <Icon name="left" />
            </button>
          </div>
          {!isCurrentWeek && (
            <button
              className="sm-reset"
              onClick={() => {
                haptic('light')
                setWeeksOpen(false)
                setDayTransition(undefined)
                props.onReset()
              }}
            >
              回本周
            </button>
          )}
          <div className="sm-toolbar-end">
            {view === 'week' && (
              <button
                className="sm-weekends"
                aria-label="显示周末"
                aria-pressed={showWeekends}
                onClick={() => {
                  haptic('light')
                  setWeekendOverride(!showWeekends)
                }}
              >
                {showWeekends ? '7 天' : '5 天'}
              </button>
            )}
            <div className="sm-segment" role="group" aria-label="课表视图" data-view={view}>
              <span className="sm-segment-thumb" aria-hidden="true" />
              <button aria-pressed={view === 'day'} onClick={() => selectView('day')}>日</button>
              <button aria-pressed={view === 'week'} onClick={() => selectView('week')}>周</button>
            </div>
          </div>
        </div>

        <div className="sm-drawer" id={drawerId} data-open={weeksOpen} aria-hidden={!weeksOpen}>
          <div className="sm-drawer-inner">
            <div className="sm-weeks" role="group" aria-label="选择周次">
              {WEEKS.map((target) => (
                <button
                  key={target}
                  tabIndex={weeksOpen ? 0 : -1}
                  aria-pressed={target === week}
                  aria-label={`第 ${target} 周${target === currentWeek ? '，本周' : ''}`}
                  onClick={() => {
                    selectWeek(target)
                    weekToggle.current?.focus()
                  }}
                >
                  <span>{target}</span>
                  {target === currentWeek && <small>本周</small>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {view === 'day' ? (
        <>
          <div className="sm-dates" role="group" aria-label="选择日期">
            {DAYS.map((d) => {
              const count = sessions.filter((session) => session.day === d).length
              return (
                <button
                  key={d}
                  onClick={() => selectDay(d)}
                  aria-pressed={day === d}
                  aria-current={isToday(d) ? 'date' : undefined}
                  aria-label={`${weekdayName(d)} ${dateFull(d)}，${count} 门课`}
                >
                  <small>{weekdayName(d).slice(1)}</small>
                  <b>{dateLabel(d).split('/').pop()}</b>
                  <span className="sm-date-dots" aria-hidden="true">
                    {Array.from({ length: Math.min(3, count) }, (_, index) => <i key={index} />)}
                  </span>
                </button>
              )
            })}
          </div>

          <div
            className="sm-day-viewport"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchCancel={() => { touch.current = null }}
          >
            <div key={`${week}-${day}`} data-dir={dayDir} className="sm-day-content">
              <div className="sm-day-heading">
                <h2>{dateFull(day)} <span>{weekdayName(day)}</span></h2>
                {daySessions.length > 0 && <small>{daySessions.length} 门课程</small>}
              </div>

              {timeline.length ? (
                <div className="sm-timeline">
                  {timeline.map((item, index) => {
                    const { session, start, end, from, to } = item
                    const prev = timeline[index - 1]?.session
                    const sameSlot = prev?.start === session.start && prev.end === session.end
                    const live = isToday(day) && minutesNow >= from && minutesNow < to
                    const ended = isToday(day) && minutesNow >= to
                    const next = item === nextSession
                    return (
                      <div className="sm-timeline-row" key={session.id}>
                        <div className="sm-time">
                          {!sameSlot && <><b>{start}</b><small>{end}</small></>}
                        </div>
                        <button
                          className="sm-day-card"
                          data-cat={session.cat}
                          data-state={live ? 'live' : ended ? 'ended' : undefined}
                          onClick={() => openCourse(session.id)}
                        >
                          <span className="sm-card-top">
                            <span className="sm-period-pill">
                              第 {session.start}{session.end > session.start ? `–${session.end}` : ''} 节
                            </span>
                            {live && <span className="sm-live-badge"><i />上课中</span>}
                            {next && <span className="sm-next-badge">下一节</span>}
                          </span>
                          <span className="sm-course-title">{session.name}</span>
                          <span className="sm-course-meta">
                            <span><Icon name="pin" />{session.room || '教室待定'}</span>
                            {session.teacher && <span><Icon name="user" />{session.teacher}</span>}
                          </span>
                          {session.conflictIds.length > 0 && (
                            <span className="sm-day-warning">
                              <Icon name="warning" />同时段还有 {session.conflictIds.length} 门课
                            </span>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : emptySchedule}
            </div>
          </div>
        </>
      ) : (
        <>
          {(needsTable || sessions.length === 0) && emptySchedule}
          {(!needsTable || sessions.length > 0) && (
            <>
              <div
                className="sm-week-grid"
                data-days={visibleDays.length}
                style={{
                  gridTemplateColumns: `34px repeat(${visibleDays.length}, minmax(0, 1fr))`,
                  gridTemplateRows: `42px repeat(${rowCount}, var(--sm-row-height))`
                }}
              >
                <div className="sm-week-head sm-grid-corner" style={{ gridColumn: 1 }}>节次</div>
                {visibleDays.map((d) => (
                  <div
                    key={d}
                    className="sm-week-head"
                    data-last={d === visibleDays[visibleDays.length - 1]}
                    aria-current={isToday(d) ? 'date' : undefined}
                    style={{ gridColumn: d + 1 }}
                  >
                    {weekdayName(d).slice(1)}
                    <b>{dateLabel(d)}</b>
                  </div>
                ))}
                {shownPeriods.map(({ number, start }) => (
                  <div
                    key={number}
                    className="sm-week-period"
                    data-last={number === rowCount}
                    style={{ gridColumn: 1, gridRow: number + 1 }}
                  >
                    <b>{number}</b>
                    <small>{start}</small>
                  </div>
                ))}
                {visibleDays.map((d) => (
                  <div
                    key={d}
                    className="sm-week-lane"
                    data-today={isToday(d)}
                    data-last={d === visibleDays[visibleDays.length - 1]}
                    aria-hidden="true"
                    style={{ gridColumn: d + 1, gridRow: '2 / -1' }}
                  />
                ))}
                {sessions
                  .filter((session) => visibleDays.includes(session.day))
                  .filter((session) => !session.conflictIds.some((id) => id < session.id))
                  .map((session) => (
                    <button
                      key={session.id}
                      className="sm-week-card"
                      data-cat={session.cat}
                      data-single={session.start === session.end}
                      aria-label={`${session.name}，${weekdayName(session.day)}，第 ${session.start}${session.end > session.start ? `–${session.end}` : ''} 节${session.room ? `，${session.room}` : ''}${session.conflictIds.length ? `，另有 ${session.conflictIds.length} 门课冲突` : ''}`}
                      style={{
                        gridColumn: session.day + 1,
                        gridRow: `${session.start + 1} / span ${session.end - session.start + 1}`
                      }}
                      onClick={() => openCourse(session.id)}
                    >
                      <b>{session.name}</b>
                      {session.room && <small>{session.room.replace(/^开元\s*/, '')}</small>}
                      {session.conflictIds.length > 0 && (
                        <span className="sm-week-warning" aria-hidden="true"><Icon name="warning" /></span>
                      )}
                    </button>
                  ))}
                {activePeriod && (
                  <>
                    <div className="sm-now-track" aria-hidden="true" style={{ gridColumn: '2 / -1', gridRow: activePeriod.number + 1 }}>
                      <i style={{ top: `${activeTop}%` }} />
                    </div>
                    <div className="sm-now-track sm-now-today" aria-hidden="true" style={{ gridColumn: todayWeekday + 1, gridRow: activePeriod.number + 1 }}>
                      <i style={{ top: `${activeTop}%` }} />
                    </div>
                  </>
                )}
              </div>
              <div className="sm-legend" aria-label="课程分类">
                {LEGEND.map(([category, label]) => (
                  <span key={category} data-cat={category}>
                    <i aria-hidden="true" />{label}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {conflicts.length > 0 && (
        <button className="conflict sm-conflict" onClick={props.onConflict}>
          <Icon name="warning" />
          <span>
            <b>本周有 {conflicts.length} 组课程冲突</b>
            <small>{conflictDays} · 查看并确认安排</small>
          </span>
          <Icon name="arrow" />
        </button>
      )}

      <p className="sm-footer">
        {view === 'day' && '左右滑动切换日期 · '}作息：{bellTableLabel(now)}（通用参考，非教务下发）
      </p>
    </div>
  )
}
