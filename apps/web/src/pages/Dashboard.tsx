import { useCallback, useEffect, useRef, useState } from 'react'
import type { TouchEvent } from 'react'
import { Icon } from '../icons'
import { Empty, Modal, PageHeader } from '../components/ui'
import { data } from '../api'
import { buildDemoChaoxingCourses } from '../demoData'
import { haptic } from '../haptics'
import { buildChaoxingTodos, filterByIgnoredCourses, parseLeftTimeMinutes } from '../android/lib/chaoxing'
import type { ChaoxingActivitiesResult, ChaoxingCourseProgress, ChaoxingDashboard, ChaoxingProgressResult, ChaoxingSettings, ChaoxingTodo } from '../types'
import './dashboard-swipe.css'

type CourseSection = 'activities' | 'progress'
type Section = 'todo' | 'works' | 'exams' | CourseSection
const settingsKey = 'haust:chaoxing_settings_v1'
const normalizeCourse = (name: string) => name.trim().toLowerCase()

function readSettings(): ChaoxingSettings {
  const defaults = { ignoredCourses: [], autoLoadActivities: false, autoLoadProgress: false }
  try {
    const stored = JSON.parse(localStorage.getItem(settingsKey) || 'null')
    return {
      ignoredCourses: Array.isArray(stored?.ignoredCourses)
        ? stored.ignoredCourses.filter((name: unknown) => typeof name === 'string') : [],
      autoLoadActivities: stored?.autoLoadActivities === true,
      autoLoadProgress: stored?.autoLoadProgress === true
    }
  } catch { return defaults }
}

type CountdownBadge = {
  main: string
  unit: string
  short: string
  level: 'urgent' | 'soon' | 'normal'
}

/** 把「剩余511小时11分钟」之类冗长文案转换成直观易扫读的倒计时徽章 */
function formatCountdown(minutes: number | null, fallbackText = ''): CountdownBadge | null {
  if (minutes == null || !Number.isFinite(minutes)) {
    const clean = fallbackText.replace(/^剩余[：:]?/, '').trim()
    if (!clean) return null
    return { main: clean.slice(0, 6), unit: '', short: clean, level: 'normal' }
  }
  if (minutes <= 0) return { main: '即将', unit: '截止', short: '即将截止', level: 'urgent' }
  if (minutes < 60) {
    return { main: String(minutes), unit: '分钟', short: `剩 ${minutes} 分钟`, level: 'urgent' }
  }
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return {
      main: String(h),
      unit: m >= 30 ? '小时+' : '小时',
      short: m ? `剩 ${h}h ${m}m` : `剩 ${h} 小时`,
      level: 'urgent'
    }
  }
  const days = Math.floor(minutes / 1440)
  const remH = Math.floor((minutes % 1440) / 60)
  if (days <= 3) {
    return {
      main: String(days),
      unit: '天后',
      short: remH ? `${days} 天 ${remH}h` : `${days} 天后`,
      level: 'soon'
    }
  }
  return { main: String(days), unit: '天后', short: `${days} 天后`, level: 'normal' }
}

export function useChaoxingCourseData() {
  const [cache, setCache] = useState(() => data.chaoxingCourseCache())
  const [phase, setPhase] = useState<Partial<Record<CourseSection, 'loading' | 'done' | 'unsupported'>>>({})
  const requests = useRef<Partial<Record<CourseSection, object>>>({})
  const loaded = useRef<Partial<Record<CourseSection, string[]>>>({})

  const load = useCallback(async (section: CourseSection, ignored: string[], force = false) => {
    if (requests.current[section]) return
    const excluded = loaded.current[section]
    if (!force && excluded && !excluded.some((name) => !ignored.some((value) => normalizeCourse(value) === normalizeCourse(name)))) return
    const request = requests.current[section] = {}
    setPhase((prev) => ({ ...prev, [section]: 'loading' }))
    const result = section === 'activities' ? await data.chaoxingActivities(ignored) : await data.chaoxingProgress(ignored)
    if (requests.current[section] !== request) return
    delete requests.current[section]
    loaded.current[section] = ignored
    if (result) setCache((prev) => ({ activities: null, progress: null, ...prev, [section]: result }))
    setPhase((prev) => ({ ...prev, [section]: result ? 'done' : 'unsupported' }))
  }, [])

  const reset = useCallback(() => {
    requests.current = {}
    loaded.current = {}
    setCache(undefined)
    setPhase({})
  }, [])

  return { cache, phase, load, reset }
}

const swipeReveal = 92

function SwipeProgressCard({ item, cardKey, isOpen, confirming, onSwipeStart, onOpen, onClose, onIgnore, onVisit }: {
  item: ChaoxingCourseProgress
  cardKey: string
  isOpen: boolean
  confirming: boolean
  onSwipeStart: () => void
  onOpen: () => void
  onClose: () => void
  onIgnore: () => void
  onVisit: () => void
}) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const gesture = useRef<{
    id: number
    startX: number
    startY: number
    baseOffset: number
    offset: number
    axis: 'horizontal' | 'vertical' | null
  } | null>(null)
  const suppressClick = useRef(false)
  const surfaceRef = useRef<HTMLButtonElement>(null)
  const fallbackRef = useRef<HTMLButtonElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const full = item.totalTasks > 0 && item.completedTasks >= item.totalTasks
  const pct = item.percent ?? 0

  useEffect(() => {
    if (isOpen && document.activeElement === fallbackRef.current) {
      actionRef.current?.focus({ preventScroll: true })
    }
  }, [isOpen])

  function startTouch(event: TouchEvent<HTMLButtonElement>) {
    if (event.touches.length !== 1) {
      cancelTouch()
      return
    }
    const touch = event.touches[0]
    const baseOffset = isOpen ? -swipeReveal : 0
    suppressClick.current = false
    gesture.current = {
      id: touch.identifier, startX: touch.clientX, startY: touch.clientY, baseOffset, offset: baseOffset, axis: null
    }
  }

  function moveTouch(event: TouchEvent<HTMLButtonElement>) {
    const swipe = gesture.current
    if (!swipe || swipe.axis === 'vertical') return
    if (event.touches.length !== 1) {
      cancelTouch()
      return
    }
    const touch = event.touches[0]
    if (touch.identifier !== swipe.id) return
    const dx = touch.clientX - swipe.startX
    const dy = touch.clientY - swipe.startY
    if (!swipe.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 8) return
      suppressClick.current = true
      swipe.axis = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal'
      if (swipe.axis === 'vertical') return
      onSwipeStart()
    }
    const offset = swipe.baseOffset + dx
    const resisted = offset < -swipeReveal ? -swipeReveal + (offset + swipeReveal) * 0.25 : offset
    swipe.offset = Math.max(-112, Math.min(0, resisted))
    setDragOffset(swipe.offset)
  }

  function endTouch(event: TouchEvent<HTMLButtonElement>) {
    const swipe = gesture.current
    if (!swipe || !Array.from(event.changedTouches).some((touch) => touch.identifier === swipe.id)) return
    gesture.current = null
    if (swipe.axis !== 'horizontal') return
    setDragOffset(null)
    if (swipe.offset < -44) onOpen()
    else onClose()
  }

  function cancelTouch() {
    gesture.current = null
    suppressClick.current = true
    setDragOffset(null)
  }

  return (
    <div
      className={`dash-swipe${isOpen ? ' is-open' : ''}${dragOffset !== null ? ' is-dragging' : ''}`}
      data-progress-swipe-key={cardKey}
      onPointerDown={() => { suppressClick.current = false }}
      onClickCapture={(event) => {
        if (event.detail > 0 && suppressClick.current) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          onClose()
          surfaceRef.current?.focus()
        }
      }}
    >
      <button
        ref={surfaceRef}
        type="button"
        className={`card dash-prog-card${full ? ' full' : ''}`}
        style={{ transform: `translateX(${dragOffset ?? (isOpen ? -swipeReveal : 0)}px)` }}
        onTouchStart={startTouch}
        onTouchMove={moveTouch}
        onTouchEnd={endTouch}
        onTouchCancel={cancelTouch}
        onClick={() => {
          if (isOpen) onClose()
          else onVisit()
        }}
      >
        <div className="dash-prog-top">
          <span className="dash-prog-copy">
            <b>{item.courseName}</b>
            <small>
              {item.teacherName ? `${item.teacherName} · ` : ''}
              {item.totalTasks > 0 ? `已完成 ${item.completedTasks} / ${item.totalTasks} 任务点` : '暂无章节任务点'}
            </small>
          </span>
          <strong className={`dash-prog-pct${full ? ' full' : ''}`}>
            {item.percent == null ? '—' : `${item.percent}%`}
          </strong>
        </div>
        <span className="dash-prog-track" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </span>
      </button>
      <button
        ref={fallbackRef}
        type="button"
        className="dash-swipe-more"
        aria-label={`显示忽略操作：${item.courseName}`}
        aria-expanded={isOpen}
        tabIndex={isOpen ? -1 : 0}
        onClick={onOpen}
      >
        <span aria-hidden="true">···</span>
      </button>
      <button
        ref={actionRef}
        type="button"
        className={`dash-swipe-action${confirming ? ' is-confirming' : ''}`}
        aria-hidden={!isOpen}
        tabIndex={isOpen ? 0 : -1}
        onClick={() => { if (isOpen) onIgnore() }}
      >
        {confirming ? '确认忽略' : '忽略'}
      </button>
    </div>
  )
}

export function Dashboard(props: {
  dashboard: ChaoxingDashboard | null
  loading: boolean
  demoMode?: boolean
  supported: boolean
  courseData: ReturnType<typeof useChaoxingCourseData>
  onRefresh: () => void
  onLogin: () => void
  onOpenItem: (url: string, title: string) => void
  onLaunchApp: () => void
}) {
  const [section, setSection] = useState<Section>('todo')
  const [settings, setSettings] = useState(readSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [foldOpen, setFoldOpen] = useState<Record<string, boolean>>({})
  const [swipedKey, setSwipedKey] = useState<string | null>(null)
  const [confirmIgnoreKey, setConfirmIgnoreKey] = useState<string | null>(null)
  const [demoCourses] = useState(buildDemoChaoxingCourses)
  const dash = props.dashboard
  const loggedIn = !!dash?.loggedIn
  const hasCachedData = !!(dash && ((dash.works?.length || 0) > 0 || (dash.exams?.length || 0) > 0 || dash.stale))
  const { cache, phase, load } = props.courseData
  const results: { activities: ChaoxingActivitiesResult | null; progress: ChaoxingProgressResult | null } | undefined =
    props.demoMode ? demoCourses : cache
  const ignored = settings.ignoredCourses
  const courses = [...(results?.activities?.courses || []), ...(results?.progress?.courses || [])]
  const namedItems = [...(dash?.works || []), ...(dash?.exams || [])]
  const namesById = new Map<string, string>()
  for (const item of namedItems) if (item.courseId && item.course) namesById.set(item.courseId, item.course)
  for (const c of courses) if (c.courseId && c.courseName) namesById.set(c.courseId, c.courseName)
  const courseName = (item: { course: string; courseId: string }) =>
    (item.courseId && namesById.get(item.courseId)) || item.course || ''
  const works = filterByIgnoredCourses(dash?.works || [], ignored, courseName)
  const exams = filterByIgnoredCourses(dash?.exams || [], ignored, courseName)
  const activities = filterByIgnoredCourses(results?.activities?.activities || [], ignored, (item) => item.courseName)
  const progress = filterByIgnoredCourses(results?.progress?.progress || [], ignored, (item) => item.courseName)
  const inProgress = progress
    .filter((item) => item.totalTasks > 0 && item.completedTasks < item.totalTasks)
    .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0) ||
      (b.totalTasks - b.completedTasks) - (a.totalTasks - a.completedTasks))
  const noTasks = progress.filter((item) => item.totalTasks === 0)
  const completed = progress.filter((item) => item.totalTasks > 0 && item.completedTasks >= item.totalTasks)
  const discovered = new Map<string, string>()
  for (const name of [...ignored, ...namedItems.map(courseName), ...courses.map((c) => c.courseName)]) {
    if (name.trim()) discovered.set(normalizeCourse(name), name.trim())
  }
  const todos = buildChaoxingTodos(works, exams)
  for (const item of activities) {
    if (!item.ongoing || results?.activities?.authRequired) continue
    const end = item.endTime || ''
    const timestamp = /^\d{10,13}$/.test(end) ? Number(end) * (end.length === 10 ? 1000 : 1) : Date.parse(end)
    const minutes = Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 60000)) : null
    const todo: ChaoxingTodo = {
      ...item, kind: 'activity', course: item.courseName, minutes, urgent: minutes != null && minutes <= 1440
    }
    todos.push(todo)
  }
  todos.sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity))

  const canLoad = props.supported && !props.demoMode && loggedIn && !dash?.authRequired && !props.loading
  useEffect(() => {
    if (!canLoad) return
    if (section === 'activities' || settings.autoLoadActivities) void load('activities', ignored)
    if (section === 'progress' || settings.autoLoadProgress) void load('progress', ignored)
  }, [canLoad, section, settings, phase, load, ignored])

  function updateSettings(next: ChaoxingSettings) {
    setSettings(next)
    try { localStorage.setItem(settingsKey, JSON.stringify(next)) } catch { /* Storage may be disabled. */ }
  }

  const closeSwipe = useCallback(() => {
    setSwipedKey(null)
    setConfirmIgnoreKey(null)
  }, [])

  useEffect(() => {
    if (swipedKey === null) return
    function dismissOutside(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element) || target.closest('[data-progress-swipe-key]')?.getAttribute('data-progress-swipe-key') !== swipedKey) {
        closeSwipe()
      }
    }
    document.addEventListener('click', dismissOutside, true)
    return () => document.removeEventListener('click', dismissOutside, true)
  }, [swipedKey, closeSwipe])

  const renderProgressCard = (item: ChaoxingCourseProgress) => {
    const key = `${item.courseId}:${item.clazzId}`
    return (
      <SwipeProgressCard
        key={key}
        cardKey={key}
        item={item}
        isOpen={swipedKey === key}
        confirming={confirmIgnoreKey === key}
        onSwipeStart={() => {
          if (swipedKey !== key) setSwipedKey(null)
          setConfirmIgnoreKey(null)
        }}
        onOpen={() => {
          haptic('light')
          setSwipedKey(key)
          setConfirmIgnoreKey(null)
        }}
        onClose={closeSwipe}
        onIgnore={() => {
          if (confirmIgnoreKey !== key) {
            haptic('light')
            setConfirmIgnoreKey(key)
            return
          }
          haptic('medium')
          updateSettings({ ...settings, ignoredCourses: [...ignored, item.courseName] })
          closeSwipe()
        }}
        onVisit={() => props.onOpenItem(item.url, item.courseName)}
      />
    )
  }

  const toggleFold = (key: string) => setFoldOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  const courseSection = section === 'activities' || section === 'progress' ? section : null
  const courseResult = courseSection ? results?.[courseSection] : undefined
  const courseLoading = !!courseSection && !props.demoMode &&
    (phase[courseSection] === 'loading' || (!phase[courseSection] && canLoad))
  const authRequired = courseResult?.authRequired
  const courseError = courseResult?.error
  const showingCache = !!courseResult && !props.demoMode &&
    (courseLoading || !courseSection || phase[courseSection] !== 'done' || courseResult.stale)

  const pendingWorks = works.filter((w) => w.uncommitted)
  const doneWorks = works.filter((w) => !w.uncommitted)
  const activeExams = exams.filter((e) => !e.finished && !e.expired)
  const doneExams = exams.filter((e) => e.finished || e.expired)
  const ongoingActivities = activities.filter((a) => a.ongoing)
  const endedActivities = activities.filter((a) => !a.ongoing)

  const urgentTodos = todos.filter((t) => t.urgent)
  const normalTodos = todos.filter((t) => !t.urgent)
  const hero = todos[0] || null
  const heroCountdown = hero
    ? formatCountdown(hero.minutes, hero.kind === 'exam' ? hero.timeLeft : hero.kind === 'work' ? hero.leftTime : hero.status)
    : null

  const subtitle = props.demoMode
    ? `演示数据 · ${todos.length} 项待办`
    : !props.supported
      ? '仅 Android 客户端支持学习通聚合'
      : loggedIn
        ? `${todos.length} 项待办${ignored.length ? ` · 已忽略 ${ignored.length} 门课` : ''}`
        : '连接学习通后自动汇总待办作业与考试'

  const renderTodoRow = (item: ChaoxingTodo) => {
    const isExam = item.kind === 'exam'
    const rawTime = isExam ? item.timeLeft : item.kind === 'work' ? item.leftTime : item.status
    const cd = formatCountdown(item.minutes, rawTime)
    const id = isExam ? item.examId : item.kind === 'work' ? item.workId : item.activeId
    const key = `${item.kind}:${item.courseId}:${id || item.title}`
    const kindLabel = isExam ? '考试' : item.kind === 'work' ? '作业' : '活动'
    return (
      <button
        key={key}
        type="button"
        className={`dash-row kind-${item.kind}${item.urgent ? ' urgent' : ''}`}
        onClick={() => props.onOpenItem(item.url, item.title)}
      >
        <span className="dash-row-copy">
          <b>{item.title}</b>
          <small>
            <span className={`dash-kind-dot kind-${item.kind}`}>{kindLabel}</span>
            {courseName(item) || (isExam ? '考试课程' : '学习通课程')}
          </small>
        </span>
        {cd ? (
          <span className={`dash-cd ${cd.level}`}>{cd.short}</span>
        ) : (
          <span className="dash-cd normal">进行中</span>
        )}
        <Icon name="arrow" className="arrow" />
      </button>
    )
  }

  return (
    <div className="dashboard">
      <PageHeader
        title="仪表盘"
        sub={subtitle}
        refreshing={props.loading || courseLoading}
        onRefresh={() => courseSection && canLoad ? void load(courseSection, ignored, true) : props.onRefresh()}
        extra={
          <div className="dash-actions">
            {(props.supported || props.demoMode) && (
              <button className="mark-all-btn" type="button" onClick={() => setSettingsOpen(true)}>
                设置{ignored.length ? `(${ignored.length})` : ''}
              </button>
            )}
            {props.supported && (
              <button className="mark-all-btn" type="button" onClick={props.onLaunchApp}>
                学习通
              </button>
            )}
          </div>
        }
      />

      {settingsOpen && (
        <Modal title="仪表盘设置" onClose={() => setSettingsOpen(false)}>
          <div className="dash-settings">
            <label>
              <input
                type="checkbox"
                role="switch"
                checked={settings.autoLoadActivities}
                onChange={(e) => updateSettings({ ...settings, autoLoadActivities: e.target.checked })}
              />
              进入仪表盘自动加载课程任务
            </label>
            <label>
              <input
                type="checkbox"
                role="switch"
                checked={settings.autoLoadProgress}
                onChange={(e) => updateSettings({ ...settings, autoLoadProgress: e.target.checked })}
              />
              进入仪表盘自动加载课程进度
            </label>
            <h3>按课程忽略（忽略后各标签均隐藏）</h3>
            {discovered.size === 0 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>暂无已发现的课程</p>}
            {[...discovered].map(([key, name]) => {
              const isIgnored = ignored.some((value) => normalizeCourse(value) === key)
              return (
                <div className="dash-course-setting" key={key}>
                  <span>{name}</span>
                  <button
                    type="button"
                    className={`chip${isIgnored ? ' selected' : ''}`}
                    aria-pressed={isIgnored}
                    aria-label={`${isIgnored ? '取消忽略' : '忽略'} ${name}`}
                    onClick={() =>
                      updateSettings({
                        ...settings,
                        ignoredCourses: isIgnored
                          ? ignored.filter((value) => normalizeCourse(value) !== key)
                          : [...ignored, name]
                      })
                    }
                  >
                    {isIgnored ? '已忽略' : '忽略'}
                  </button>
                </div>
              )
            })}
          </div>
        </Modal>
      )}

      {props.demoMode ? (
        <div className="demo-banner" role="status">
          <span className="demo-banner-text">当前为演示模式示例任务，登录学习通后查看真实作业与考试</span>
          <button className="demo-banner-btn" type="button" onClick={props.onLogin}>
            去登录
          </button>
        </div>
      ) : null}

      {!props.demoMode && dash?.authRequired && hasCachedData ? (
        <div className="demo-banner" role="status">
          <span className="demo-banner-text">学习通登录已过期，当前显示上次缓存</span>
          <button className="demo-banner-btn" type="button" onClick={props.onLogin}>
            重新登录
          </button>
        </div>
      ) : null}

      {!props.demoMode && dash?.error && !dash.authRequired ? (
        <div className="demo-banner" role="status">
          <span className="demo-banner-text">
            {dash.error === 'parse'
              ? '学习通页面解析异常，请点右上角刷新或重新登录学习通'
              : '学习通网络请求失败，请检查网络后点右上角刷新'}
          </span>
          <button className="demo-banner-btn" type="button" onClick={props.onRefresh}>
            重试
          </button>
        </div>
      ) : null}

      {!props.supported && !props.demoMode ? (
        <Empty
          title="桌面端暂未接入学习通抓取"
          sub="在 Android 手机端打开科小喵，即可通过内嵌浏览器复用学习通登录态汇总待办作业与考试。"
          icon="grid"
        />
      ) : !loggedIn && !hasCachedData && !props.demoMode ? (
        <div className="card dash-connect">
          <div className="dash-connect-icon">
            <Icon name="grid" />
          </div>
          <h2>连接超星学习通</h2>
          <p>
            在应用内登录一次学习通（支持手机号、验证码或河科大机构账号），即可自动汇总全部课程的待办作业与考试，点击直达提交页。
          </p>
          <div className="dash-connect-actions">
            <button className="primary" type="button" onClick={props.onLogin} disabled={props.loading}>
              {props.loading ? '正在连接…' : '登录超星学习通'}
            </button>
            <button className="softbtn" type="button" onClick={props.onLaunchApp}>
              打开学习通 App
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 顶部焦点卡：最紧急待办 or 全清庆祝态 */}
          {hero ? (
            <button
              type="button"
              className={`dash-hero${hero.urgent ? ' urgent' : ''}`}
              onClick={() => props.onOpenItem(hero.url, hero.title)}
            >
              <div className="dash-hero-top">
                <span className="dash-hero-pill">
                  {hero.urgent ? '即将截止' : '最近待办'} · {hero.kind === 'exam' ? '考试' : hero.kind === 'work' ? '作业' : '活动'}
                </span>
                <span className="dash-hero-course">
                  {courseName(hero) || (hero.kind === 'exam' ? '考试课程' : '学习通')}
                </span>
              </div>
              <div className="dash-hero-main">
                <div className="dash-hero-copy">
                  <b>{hero.title}</b>
                  <span>
                    {todos.length > 1 ? `共 ${todos.length} 项未完成待办 · 点击直达任务页 ›` : '点击直达学习通提交页 ›'}
                  </span>
                </div>
                {heroCountdown ? (
                  <div className="dash-hero-count">
                    <strong>{heroCountdown.main}</strong>
                    {heroCountdown.unit ? <small>{heroCountdown.unit}</small> : null}
                  </div>
                ) : null}
              </div>
            </button>
          ) : (
            <div className="dash-hero clear">
              <div className="dash-hero-top">
                <span className="dash-hero-pill">全部清空</span>
                <span className="dash-hero-course">学习通</span>
              </div>
              <div className="dash-hero-main">
                <div className="dash-hero-copy">
                  <b>当前没有未完成待办</b>
                  <span>所有已识别的作业与进行中考试都已处理完毕。</span>
                </div>
              </div>
            </div>
          )}

          {/* 3 个紧凑彩色指标胶囊：点击直接切换过滤 */}
          <div className="dash-metrics">
            <button
              type="button"
              className={`dash-metric work${section === 'works' ? ' active' : ''}`}
              onClick={() => setSection('works')}
            >
              <strong>{pendingWorks.length}</strong>
              <span>待交作业</span>
            </button>
            <button
              type="button"
              className={`dash-metric exam${section === 'exams' ? ' active' : ''}`}
              onClick={() => setSection('exams')}
            >
              <strong>{activeExams.length}</strong>
              <span>进行中考试</span>
            </button>
            <button
              type="button"
              className={`dash-metric act${section === 'activities' ? ' active' : ''}`}
              onClick={() => setSection('activities')}
            >
              <strong>{results?.activities ? ongoingActivities.length : '·'}</strong>
              <span>{results?.activities ? '课堂活动' : '查课程任务'}</span>
            </button>
          </div>

          {/* 紧凑分段切换栏 */}
          <div className="dash-tabs" role="tablist" aria-label="学习通视图切换">
            {(
              [
                ['todo', `待办 ${todos.length}`],
                ['works', `作业 ${works.length}`],
                ['exams', `考试 ${exams.length}`],
                ['activities', '任务'],
                ['progress', '进度']
              ] as Array<[Section, string]>
            ).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                role="tab"
                aria-selected={section === tabKey}
                className={`dash-tab${section === tabKey ? ' selected' : ''}`}
                onClick={() => setSection(tabKey)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── 课程任务 / 课程进度（按需节流加载） ── */}
          {courseSection ? (
            <>
              {courseLoading && (
                <div className="sync-banner" role="status">
                  <span className="sync-banner-row">
                    <i className="sync-dot" aria-hidden="true" />
                    <span>按 500ms 节流拉取{courseSection === 'activities' ? '课程任务' : '课程进度'}中…{showingCache ? '（先展示上次缓存）' : ''}</span>
                  </span>
                  <span className="sync-track" aria-hidden="true" />
                </div>
              )}
              {!courseLoading && (authRequired || courseError || phase[courseSection] === 'unsupported') && (
                <div className="demo-banner" role="status">
                  <span className="demo-banner-text">
                    {authRequired
                      ? '学习通登录已过期，请重新登录'
                      : courseError === 'parse'
                        ? '课程数据解析失败，请稍后重试'
                        : courseError
                          ? '课程数据请求失败，请检查网络'
                          : '当前客户端暂未接入此功能'}
                  </span>
                  {authRequired ? (
                    <button className="demo-banner-btn" type="button" onClick={props.onLogin}>
                      重新登录
                    </button>
                  ) : null}
                </div>
              )}

              {section === 'activities' && (
                <>
                  {ongoingActivities.length > 0 && (
                    <div className="dash-group">
                      <div className="dash-group-head urgent">
                        <span>进行中活动</span>
                        <em>{ongoingActivities.length}</em>
                      </div>
                      <div className="card dash-list">
                        {ongoingActivities.map((item) => (
                          <button
                            type="button"
                            className="dash-row kind-activity urgent"
                            key={`${item.courseId}:${item.clazzId}:${item.activeId}`}
                            onClick={() => props.onOpenItem(item.url, item.title)}
                          >
                            <span className="dash-row-copy">
                              <b>{item.title}</b>
                              <small>
                                <span className="dash-kind-dot kind-activity">{item.type}</span>
                                {item.courseName}
                              </small>
                            </span>
                            <span className="dash-cd urgent">{item.status}</span>
                            <Icon name="arrow" className="arrow" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {endedActivities.length > 0 && (
                    <div className="dash-fold-wrap">
                      <button
                        type="button"
                        className="dash-fold-btn"
                        onClick={() => toggleFold('activities')}
                        aria-expanded={!!foldOpen.activities}
                      >
                        <span>已结束活动 ({endedActivities.length})</span>
                        <span>{foldOpen.activities ? '收起' : '展开 ›'}</span>
                      </button>
                      {foldOpen.activities && (
                        <div className="card dash-list muted-list">
                          {endedActivities.map((item) => (
                            <button
                              type="button"
                              className="dash-row kind-done"
                              key={`${item.courseId}:${item.clazzId}:${item.activeId}`}
                              onClick={() => props.onOpenItem(item.url, item.title)}
                            >
                              <span className="dash-row-copy">
                                <b>{item.title}</b>
                                <small>{item.courseName} · {item.type}</small>
                              </span>
                              <span className="dash-cd done">{item.status}</span>
                              <Icon name="arrow" className="arrow" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!courseLoading && !authRequired && !courseError && courseResult && activities.length === 0 && (
                    <Empty title="暂无课程任务" sub="当前课程下没有签到、测验或讨论活动。" icon="book" />
                  )}
                </>
              )}

              {section === 'progress' && (
                <>
                  <div className="dash-progress-hint">
                    <span>左滑课程卡片可快速忽略</span>
                    {ignored.length > 0 && (
                      <button type="button" onClick={() => setSettingsOpen(true)}>
                        管理已忽略 ({ignored.length})
                      </button>
                    )}
                  </div>
                  {(inProgress.length > 0 || noTasks.length > 0) && (
                    <div className="dash-prog-grid">
                      {inProgress.map(renderProgressCard)}
                      {noTasks.map(renderProgressCard)}
                    </div>
                  )}
                  {completed.length > 0 && (
                    <div className="dash-fold-wrap">
                      <button
                        type="button"
                        className="dash-fold-btn"
                        onClick={() => toggleFold('progressDone')}
                        aria-expanded={!!foldOpen.progressDone}
                      >
                        <span>已完成 {completed.length} 门</span>
                        <span>{foldOpen.progressDone ? '收起' : '展开 ›'}</span>
                      </button>
                      {foldOpen.progressDone && (
                        <div className="dash-prog-grid">
                          {completed.map(renderProgressCard)}
                        </div>
                      )}
                    </div>
                  )}
                  {!courseLoading && !authRequired && !courseError && courseResult && progress.length === 0 && (
                    <Empty title="暂无课程进度" sub="点右上角刷新重试，或在设置里检查是否忽略了课程。" icon="book" />
                  )}
                </>
              )}
            </>
          ) : section === 'todo' ? (
            todos.length ? (
              <div className="dash-stream">
                {urgentTodos.length > 0 && (
                  <div className="dash-group">
                    <div className="dash-group-head urgent">
                      <span>24 小时内截止</span>
                      <em>{urgentTodos.length}</em>
                    </div>
                    <div className="card dash-list">
                      {urgentTodos.map(renderTodoRow)}
                    </div>
                  </div>
                )}
                {normalTodos.length > 0 && (
                  <div className="dash-group">
                    <div className="dash-group-head">
                      <span>近期进行中</span>
                      <em>{normalTodos.length}</em>
                    </div>
                    <div className="card dash-list">
                      {normalTodos.map(renderTodoRow)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Empty title="当前没有未完成待办" sub="去「进度」或「全部作业」看看历史记录吧。" icon="check" />
            )
          ) : section === 'works' ? (
            works.length ? (
              <div className="dash-stream">
                {pendingWorks.length > 0 ? (
                  <div className="dash-group">
                    <div className="dash-group-head">
                      <span>待提交作业</span>
                      <em>{pendingWorks.length}</em>
                    </div>
                    <div className="card dash-list">
                      {pendingWorks.map((w) => {
                        const mins = parseLeftTimeMinutes(w.leftTime)
                        const cd = formatCountdown(mins, w.leftTime)
                        return (
                          <button
                            key={w.workId || `${w.courseId}-${w.title}`}
                            type="button"
                            className={`dash-row kind-work${cd?.level === 'urgent' ? ' urgent' : ''}`}
                            onClick={() => props.onOpenItem(w.url, w.title)}
                          >
                            <span className="dash-row-copy">
                              <b>{w.title}</b>
                              <small>{courseName(w) || '学习通课程'}</small>
                            </span>
                            <span className={`dash-cd ${cd?.level || 'normal'}`}>
                              {cd ? cd.short : (w.status || '待提交')}
                            </span>
                            <Icon name="arrow" className="arrow" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="card dash-note">暂无待提交作业，已完成项已折叠在下方。</div>
                )}

                {doneWorks.length > 0 && (
                  <div className="dash-fold-wrap">
                    <button
                      type="button"
                      className="dash-fold-btn"
                      onClick={() => toggleFold('works')}
                      aria-expanded={!!foldOpen.works}
                    >
                      <span>已提交 / 已完成作业 ({doneWorks.length})</span>
                      <span>{foldOpen.works ? '收起' : '展开 ›'}</span>
                    </button>
                    {foldOpen.works && (
                      <div className="card dash-list muted-list">
                        {doneWorks.map((w) => (
                          <button
                            key={w.workId || `${w.courseId}-${w.title}`}
                            type="button"
                            className="dash-row kind-done"
                            onClick={() => props.onOpenItem(w.url, w.title)}
                          >
                            <span className="dash-row-copy">
                              <b>{w.title}</b>
                              <small>{courseName(w) || '学习通课程'}</small>
                            </span>
                            <span className="dash-cd done">{w.status || '已提交'}</span>
                            <Icon name="arrow" className="arrow" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Empty title="暂无作业记录" sub="点击右上角刷新重新拉取学习通作业列表。" icon="book" />
            )
          ) : exams.length ? (
            <div className="dash-stream">
              {activeExams.length > 0 ? (
                <div className="dash-group">
                  <div className="dash-group-head urgent">
                    <span>进行中考试</span>
                    <em>{activeExams.length}</em>
                  </div>
                  <div className="card dash-list">
                    {activeExams.map((ex) => {
                      const mins = parseLeftTimeMinutes(ex.timeLeft)
                      const cd = formatCountdown(mins, ex.timeLeft)
                      return (
                        <button
                          key={ex.examId || `${ex.courseId}-${ex.title}`}
                          type="button"
                          className={`dash-row kind-exam${cd?.level === 'urgent' ? ' urgent' : ''}`}
                          onClick={() => props.onOpenItem(ex.url, ex.title)}
                        >
                          <span className="dash-row-copy">
                            <b>{ex.title}</b>
                            <small>{courseName(ex) || '考试课程'}</small>
                          </span>
                          <span className={`dash-cd ${cd?.level || 'soon'}`}>
                            {cd ? cd.short : (ex.status || '进行中')}
                          </span>
                          <Icon name="arrow" className="arrow" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="card dash-note">暂无进行中考试，历史考试已折叠在下方。</div>
              )}

              {doneExams.length > 0 && (
                <div className="dash-fold-wrap">
                  <button
                    type="button"
                    className="dash-fold-btn"
                    onClick={() => toggleFold('exams')}
                    aria-expanded={!!foldOpen.exams}
                  >
                    <span>已完成 / 已过期考试 ({doneExams.length})</span>
                    <span>{foldOpen.exams ? '收起' : '展开 ›'}</span>
                  </button>
                  {foldOpen.exams && (
                    <div className="card dash-list muted-list">
                      {doneExams.map((ex) => (
                        <button
                          key={ex.examId || `${ex.courseId}-${ex.title}`}
                          type="button"
                          className="dash-row kind-done"
                          onClick={() => props.onOpenItem(ex.url, ex.title)}
                        >
                          <span className="dash-row-copy">
                            <b>{ex.title}</b>
                            <small>{courseName(ex) || '考试课程'}</small>
                          </span>
                          <span className="dash-cd done">
                            {ex.status || (ex.finished ? '已完成' : '已过期')}
                          </span>
                          <Icon name="arrow" className="arrow" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <Empty title="暂无考试记录" sub="点击右上角刷新重新拉取学习通考试列表。" icon="cap" />
          )}

          <p className="footer-note">点击条目优先在应用内打开（自动复用超星登录态）· 右上角可进设置或学习通 App</p>
        </>
      )}
    </div>
  )
}
