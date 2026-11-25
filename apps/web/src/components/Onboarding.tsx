import './onboarding-oobe.css'
import { useLayoutEffect, useRef, useState, type TouchEvent, type TouchList } from 'react'
import {
  COLLEGES, MAX_SUBSCRIBED_COLLEGES, getSubscribedCollegeSources,
  readSubscribedColleges, sanitizeCollegeIds, writeSubscribedColleges
} from '../college-notices'
import { haptic } from '../haptics'
import { Icon } from '../icons'
import { applyTheme, readTheme, type Theme } from '../theme'

export type OnboardingProps = {
  step: number
  replayMode?: boolean
  onStepChange: (step: number) => void
  onBindAccount: () => void
  onStartDemo: () => void
  onSkip: () => void
  theme?: Theme
  onChangeTheme?: (t: Theme) => void
  subscribedColleges?: string[]
  onChangeSubscribedColleges?: (ids: string[]) => void
}

const STEPS = [
  { title: '你好，科小喵', description: '欢迎使用河科大校园助手，先挑一个顺眼的外观。' },
  { title: '课表与待办，一屏掌握', description: '点一点「日 / 周」，看看接下来上什么课、去哪里上。' },
  { title: '低进度置顶，旧课一滑即藏', description: '学习通仪表盘优先展示低进度课程。用下面的示例练习忽略旧课。' },
  { title: '全校与 30 个学院通知，亚秒级直达', description: '选好学院，主页就能看到与你有关的通知。' },
  { title: '一次登录，无感畅用', description: '查余额、看待办和更新应用，都可以在科小喵完成。' },
  { title: '开启有条不紊的校园生活', description: '绑定校园账号同步真实数据，也可以先用示例探索。' }
] as const

const THEMES = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' }
] as const

const TODAY = [
  { time: '08:00', title: '高等数学', detail: '公教 1-203', current: true },
  { time: '10:15', title: '大学英语', detail: '公教 2-305' },
  { time: '14:30', title: '程序设计', detail: '实验楼 402' }
]

const WEEK = [
  { day: '周一', courses: ['高数', '', '英语'] },
  { day: '周二', courses: ['高数', '英语', '程序设计'] },
  { day: '周三', courses: ['', '线代', '体育'] },
  { day: '周四', courses: ['英语', '高数', ''] },
  { day: '周五', courses: ['线代', '', '程序设计'] }
]

const FEATURES = [
  { icon: 'card', title: '电费与校园卡', description: '宿舍空调电费、校园卡余额一屏直查。' },
  { icon: 'storage', title: '凭据本机加密', description: 'Android Keystore 加密保存凭据，应用不会向第三方上传这些数据。' },
  { icon: 'sync', title: '过期静默续登', description: '教务、学习通和校园网会话过期后，后台尝试自动续登。' },
  { icon: 'bolt', title: '云端更新', description: '在「我的」流光大卡一键检查更新，也能切换 Beta 通道。' }
] as const

type TouchOrigin = { x: number; y: number; id: number }

function startTouch(event: TouchEvent): TouchOrigin | null {
  const touch = event.touches[0]
  return event.touches.length === 1 && touch
    ? { x: touch.clientX, y: touch.clientY, id: touch.identifier }
    : null
}

function horizontalDistance(origin: TouchOrigin | null, touches: TouchList) {
  if (!origin) return 0
  const touch = Array.from(touches).find(({ identifier }) => identifier === origin.id)
  if (!touch) return 0
  const dx = touch.clientX - origin.x
  return Math.abs(dx) > 1.25 * Math.abs(touch.clientY - origin.y) ? dx : 0
}

function ThemePicker({ value, onSelect }: { value: Theme; onSelect: (value: Theme) => void }) {
  return (
    <div className="oobe-themes" role="group" aria-label="选择外观">
      {THEMES.map(({ value: option, label, icon }) => (
        <button className="oobe-theme" key={option} type="button" aria-pressed={value === option} onClick={() => onSelect(option)}>
          <span className="oobe-phone" data-preview={option} aria-hidden="true">
            <span className="oobe-phone-screen"><i /><i /><i /><i /></span>
            <span className="oobe-phone-check"><Icon name="check" /></span>
          </span>
          <span className="oobe-theme-label"><Icon name={icon} />{label}</span>
        </button>
      ))}
    </div>
  )
}

function MiniSchedule() {
  const [view, setView] = useState<'日' | '周'>('日')

  return (
    <section className="oobe-panel oobe-schedule" aria-label="课表示例">
      <div className="oobe-panel-head">
        <span className="oobe-panel-label"><Icon name="calendar" /> 课程表</span>
        <div className="oobe-segments" role="group" aria-label="课表视图">
          {(['日', '周'] as const).map((option) => (
            <button key={option} type="button" aria-pressed={view === option} onClick={() => {
              if (option === view) return
              haptic('light')
              setView(option)
            }}>{option}</button>
          ))}
        </div>
      </div>
      <div className="oobe-schedule-view" key={view}>
        {view === '日' ? (
          <ol className="oobe-timeline" aria-label="周二课程">
            {TODAY.map(({ time, title, detail, current }) => (
              <li key={time}>
                <time>{time}</time>
                <span className="oobe-timeline-dot" data-current={current} aria-hidden="true" />
                <span className="oobe-lesson"><strong>{title}</strong><small>{detail}</small></span>
                {current && <span className="oobe-now">上课中</span>}
              </li>
            ))}
          </ol>
        ) : (
          <div className="oobe-week" role="group" aria-label="本周课程">
            {WEEK.map(({ day, courses }) => (
              <div key={day} className="oobe-week-day">
                <strong>{day}</strong>
                {courses.map((course, slot) => (
                  <span key={slot} className={course ? 'oobe-week-lesson' : undefined} aria-hidden={!course}>{course}</span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="oobe-schedule-task"><Icon name="task" /><span>今日待办</span><small>英语作业 · 22:00 前</small></div>
    </section>
  )
}

function CourseSandbox() {
  const [phase, setPhase] = useState<'idle' | 'open' | 'confirm' | 'done'>('idle')
  const [drag, setDrag] = useState<number | null>(null)
  const gesture = useRef<TouchOrigin | null>(null)
  const action = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const done = phase === 'done'

  useLayoutEffect(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    const target = done ? retry : action
    target.current?.focus({ preventScroll: true })
  }, [done])

  return (
    <div
      className="oobe-sandbox"
      onTouchStart={(event) => {
        event.stopPropagation()
        gesture.current = startTouch(event)
      }}
      onTouchMove={(event) => {
        event.stopPropagation()
        if (event.touches.length !== 1) gesture.current = null
        if (done || phase === 'confirm' || !gesture.current) return
        const dx = horizontalDistance(gesture.current, event.touches)
        setDrag(dx < 0 && phase === 'idle' ? Math.min(60, -dx * 0.65) : null)
      }}
      onTouchEnd={(event) => {
        event.stopPropagation()
        const dx = horizontalDistance(gesture.current, event.changedTouches)
        gesture.current = null
        setDrag(null)
        if (done || phase === 'confirm') return
        if (dx < -38 && phase === 'idle') {
          haptic('light')
          setPhase('open')
        } else if (dx > 38 && phase === 'open') {
          setPhase('idle')
        }
      }}
      onTouchCancel={(event) => {
        event.stopPropagation()
        gesture.current = null
        setDrag(null)
      }}
    >
      <div className="oobe-course-collapse" data-done={done} aria-hidden={done || undefined}>
        <div className="oobe-course-clip">
          <div className="oobe-course" data-phase={phase} data-dragging={drag !== null}>
            <div className="oobe-course-copy" style={drag === null ? undefined : { right: 68 + drag }}>
              <small>2025-2026-1</small>
              <strong>大学英语（上）</strong>
              <div className="oobe-course-meter">
                <span role="progressbar" aria-label="示例课程进度" aria-valuenow={100} />
                <b>100%</b>
              </div>
            </div>
            <button
              className="oobe-ignore"
              ref={action}
              type="button"
              disabled={done}
              style={drag === null ? undefined : { width: 68 + drag }}
              onClick={(event) => {
                if (phase === 'confirm') {
                  restoreFocus.current = event.detail === 0
                  haptic('success')
                  setPhase('done')
                } else {
                  haptic('light')
                  setPhase('confirm')
                }
              }}
            >
              {phase === 'confirm' ? '确认忽略' : '忽略'}
            </button>
          </div>
        </div>
      </div>
      <div className="oobe-course-feedback">
        <div role="status">
          {done ? (
            <p className="oobe-achievement"><Icon name="check" /><strong>太棒了！你已掌握快速忽略旧学期课程</strong></p>
          ) : (
            <p className="oobe-swipe-hint">
              {phase === 'idle' && <span aria-hidden="true">←</span>}
              {phase === 'idle' ? '向左滑动试试忽略' : phase === 'open' ? '点「忽略」继续' : '再次点击「确认忽略」收起课程'}
            </p>
          )}
        </div>
        {done && (
          <button className="oobe-retry" ref={retry} type="button" onClick={(event) => {
            restoreFocus.current = event.detail === 0
            setPhase('idle')
          }}>再试一次</button>
        )}
      </div>
    </div>
  )
}

const QUICK_COLLEGES = ['jd', 'cl', 'dx', 'rj', 'tmgc', 'sxy', 'yxb', 'wy']

function CollegePicker({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const query = search.trim().toLowerCase()
  const matching = COLLEGES.filter(({ id, shortName, fullName, group }) => query
    ? [id, shortName, fullName, group].some((value) => value.includes(query))
    : showAll || ids.includes(id) || QUICK_COLLEGES.includes(id))
  const full = ids.length >= MAX_SUBSCRIBED_COLLEGES

  return (
    <section className="oobe-panel oobe-colleges" aria-label="订阅学院">
      <label className="oobe-search">
        <Icon name="search" />
        <input type="search" value={search} placeholder="搜索学院名称" aria-label="搜索学院名称" onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div className="oobe-college-head">
        {!query && (
          <button className="oobe-college-toggle" type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? '收起学院' : '查看全部学院'}
          </button>
        )}
        <span role="status">已选 {ids.length} / {MAX_SUBSCRIBED_COLLEGES}</span>
      </div>
      <div className="oobe-college-list" role="group" aria-label={query ? '搜索结果' : '可订阅学院'}>
        {matching.map(({ id, shortName, fullName }) => {
          const selected = ids.includes(id)
          return (
            <button
              key={id}
              type="button"
              title={fullName}
              aria-label={fullName}
              aria-pressed={selected}
              disabled={full && !selected}
              onClick={() => {
                if (full && !selected) return
                haptic('light')
                onChange(selected ? ids.filter((item) => item !== id) : [...ids, id])
              }}
            >
              {selected && <Icon name="check" />}{shortName}
            </button>
          )
        })}
        {matching.length === 0 && <p className="oobe-no-colleges" role="status">没有匹配的学院，换个关键词试试。</p>}
      </div>
    </section>
  )
}

function SetupSummary({ theme, ids }: { theme: Theme; ids: string[] }) {
  const appearance = THEMES.find(({ value }) => value === theme)
  const colleges = getSubscribedCollegeSources(ids)

  return (
    <div className="oobe-summary">
      <span><Icon name={appearance?.icon ?? 'monitor'} />{appearance?.label}</span>
      {colleges.length ? colleges.map(({ id, fullName }) => (
        <span key={id}><Icon name="bell" />{fullName}</span>
      )) : <span><Icon name="bell" />暂未订阅学院</span>}
    </div>
  )
}

export function Onboarding({
  step, replayMode, onStepChange, onBindAccount, onStartDemo, onSkip,
  theme, onChangeTheme, subscribedColleges, onChangeSubscribedColleges
}: OnboardingProps) {
  const [localTheme, setLocalTheme] = useState<Theme | undefined>(() => theme === undefined ? readTheme() : undefined)
  const [localColleges, setLocalColleges] = useState<string[] | undefined>(() => {
    try {
      return subscribedColleges === undefined ? readSubscribedColleges() : undefined
    } catch {
      return []
    }
  })
  const currentTheme = (onChangeTheme && theme !== undefined ? theme : localTheme ?? theme) ?? 'system'
  const collegeIds = sanitizeCollegeIds(
    onChangeSubscribedColleges && subscribedColleges !== undefined ? subscribedColleges : localColleges ?? subscribedColleges
  )
  const current = Number.isFinite(step) ? Math.max(0, Math.min(STEPS.length - 1, Math.trunc(step))) : 0
  const isLast = current === STEPS.length - 1
  const origin = useRef<TouchOrigin | null>(null)
  const previous = useRef(current)
  const body = useRef<HTMLElement>(null)
  const slide = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    if (current === previous.current) return
    if (slide.current) slide.current.dataset.direction = current < previous.current ? 'back' : 'forward'
    if (body.current) body.current.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
    previous.current = current
    origin.current = null
    haptic('light')
  }, [current])

  function changeTheme(next: Theme) {
    haptic('light')
    if (onChangeTheme) onChangeTheme(next)
    else applyTheme(next)
    if (!onChangeTheme || theme === undefined) setLocalTheme(next)
  }

  function changeColleges(next: string[]) {
    if (onChangeSubscribedColleges) {
      onChangeSubscribedColleges(next)
      if (subscribedColleges === undefined) setLocalColleges(next)
      return
    }
    try {
      setLocalColleges(writeSubscribedColleges(next))
    } catch {
      setLocalColleges(next)
    }
  }

  return (
    <div className="oobe" role="region" aria-label="新手引导">
      <header className="oobe-top">
        <div className="oobe-brand"><span><Icon name="cat" /></span><strong>科小喵</strong></div>
        <div
          className="oobe-progress"
          role="progressbar"
          aria-label="引导进度"
          aria-valuemin={0}
          aria-valuemax={STEPS.length}
          aria-valuenow={current + 1}
          aria-valuetext={`第 ${current + 1} / ${STEPS.length} 步`}
        >
          <span>第 {current + 1} / {STEPS.length} 步</span>
          <span className="oobe-progress-track"><i style={{ width: `${(current + 1) * 100 / STEPS.length}%` }} /></span>
        </div>
        <button className="oobe-skip" type="button" onClick={onSkip}>{replayMode ? '关闭' : '跳过'}</button>
      </header>

      <main
        className="oobe-body"
        ref={body}
        onTouchStart={(event) => { origin.current = startTouch(event) }}
        onTouchEnd={(event) => {
          const dx = horizontalDistance(origin.current, event.changedTouches)
          origin.current = null
          if (dx < -48 && !isLast) onStepChange(current + 1)
          else if (dx > 48 && current > 0) onStepChange(current - 1)
        }}
        onTouchCancel={() => { origin.current = null }}
      >
        <div className="oobe-slide" key={current} ref={slide}>
          <div className="oobe-intro">
            {(current === 0 || isLast) && (
              <span className="oobe-emblem"><Icon name={isLast ? 'check' : 'cat'} /></span>
            )}
            <h1 ref={heading} tabIndex={-1}>{STEPS[current].title}</h1>
            <p>{isLast && replayMode ? '你的偏好已就绪，可以返回主页或切换账号。' : STEPS[current].description}</p>
          </div>

          {current === 0 && <ThemePicker value={currentTheme} onSelect={changeTheme} />}
          {current === 1 && <MiniSchedule />}
          {current === 2 && <CourseSandbox />}
          {current === 3 && <CollegePicker ids={collegeIds} onChange={changeColleges} />}
          {current === 4 && (
            <div className="oobe-features">
              {FEATURES.map(({ icon, title, description }) => (
                <article className="oobe-panel oobe-feature" key={title}>
                  <span className="oobe-feature-icon"><Icon name={icon} /></span>
                  <h2>{title}</h2>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          )}
          {isLast && <SetupSummary theme={currentTheme} ids={collegeIds} />}
        </div>
      </main>

      <footer className="oobe-footer">
        <div className="oobe-actions" data-first={current === 0}>
          {current > 0 && (
            <button className="oobe-back" type="button" onClick={() => onStepChange(current - 1)}>
              <Icon name="left" />上一步
            </button>
          )}
          <button className="oobe-primary" type="button" onClick={isLast ? onBindAccount : () => onStepChange(current + 1)}>
            {isLast ? (replayMode ? '去登录 / 切换账号' : '立即绑定校园账号') : '下一步'}
            {!isLast && <Icon name="arrow" />}
          </button>
        </div>
        {isLast && (
          <button className="oobe-secondary" type="button" onClick={onStartDemo}>
            {replayMode ? '返回主页' : '先用示例数据逛逛'}
          </button>
        )}
      </footer>
    </div>
  )
}
