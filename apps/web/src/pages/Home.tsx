import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { PageHeader } from '../components/ui'
import { periodTime, noticeDate, type Sess, type cardView, type chargerView } from '../adapters'
import type { Exam, NoticeItem } from '../types'
import type { AirconElectricityResult, AirconRoom } from '../types/aircon-electricity'
import type { CardKey } from '../snapshot'

type HomeProps = {
  dateText: string
  dayText: string
  week: number
  todaySessions: Sess[]
  exam: { ex: Exam; days: number | null } | null
  chargers: ReturnType<typeof chargerView>
  card: ReturnType<typeof cardView>
  room: AirconRoom | null
  electricity: AirconElectricityResult | null
  noticeUnread: number
  unreadNotices: NoticeItem[]
  noticeTitles: string[]
  refreshing: boolean
  syncMessage?: string
  initialSkeleton?: boolean
  demoMode?: boolean
  showDemoTip?: boolean
  onDismissDemoTip?: () => void
  swrCards?: Partial<Record<CardKey, boolean>>
  ripples?: Partial<Record<CardKey, number>>
  loggedIn: boolean
  hasTable: boolean
  courseError: string
  onRefresh: () => void
  onOpenNotices: () => void
  onOpenNotice: (item: NoticeItem) => void
  onOpenChargers: () => void
  onOpenCard: () => void
  onBindRoom: () => void
  onOpenSchedule: () => void
  onExam: () => void
  onLogin: () => void
}

type Group = { start: string; end: string; sessions: Sess[] }
type Phase = 'upcoming' | 'current' | 'ended'

/** 电量低于这个值时整张卡片换成警示色 */
const LOW_KWH = 30

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
function syncTime(value?: string | null) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(+date)
    ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : ''
}
function span(mins: number) {
  if (mins < 60) return `${Math.max(1, mins)} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}
const fmtNum = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')

function SwrFx({ loading, ripple }: { loading?: boolean; ripple?: number }) {
  return (
    <>
      {loading ? <span className="swr-bar" aria-hidden="true" /> : null}
      {ripple ? <span key={ripple} className="swr-wave" aria-hidden="true" /> : null}
    </>
  )
}

export function Home(props: HomeProps) {
  const { exam, chargers, card, room, electricity } = props
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const currentMinute = now.getHours() * 60 + now.getMinutes()

  const groupMap = new Map<string, Group>()
  for (const session of props.todaySessions) {
    const start = periodTime(session.start)[0]
    const end = periodTime(session.end)[1]
    const key = start + '/' + end
    const group = groupMap.get(key)
    if (group) group.sessions.push(session)
    else groupMap.set(key, { start, end, sessions: [session] })
  }
  const groups = [...groupMap.values()].map((group) => {
    const phase: Phase =
      currentMinute < minutes(group.start) ? 'upcoming' : currentMinute < minutes(group.end) ? 'current' : 'ended'
    return { ...group, phase }
  })
  const focus = groups.find((g) => g.phase === 'current') ?? groups.find((g) => g.phase === 'upcoming') ?? null
  const remaining = groups.filter((g) => g.phase !== 'ended').length

  const reading = electricity?.status === 'ok' ? electricity.reading : null
  const low = reading?.remainingKwh != null && reading.remainingKwh <= LOW_KWH
  const readingTime = reading ? syncTime(reading.updatedAt || reading.fetchedAt) : ''
  const electricNote =
    electricity && 'message' in electricity && electricity.message
      ? electricity.message
      : electricity?.status === 'query_failed'
        ? '查询失败，刷新后重试'
        : electricity?.status === 'no_data'
          ? '学校没有返回读数'
          : reading
            ? readingTime ? `更新于 ${readingTime}` : '已查询'
            : room
              ? '正在查询…'
              : ''

  const chargerPct = chargers?.total ? Math.max(0, Math.min(100, (chargers.free / chargers.total) * 100)) : null
  const cardSync = syncTime(card?.at)
  const swrClass = (key: CardKey) =>
    ` swr-card${props.swrCards?.[key] ? ' swr-loading' : ''}${props.ripples?.[key] ? ' swr-ripple' : ''}`

  return (
    <div
      className="home"
      onClick={() => {
        if (props.showDemoTip) props.onDismissDemoTip?.()
      }}
    >
      <PageHeader
        title={props.dayText}
        sub={`${props.dateText} · 第 ${props.week} 教学周`}
        refreshing={props.refreshing}
        onRefresh={props.onRefresh}
      />

      {props.syncMessage ? (
        <div className="sync-banner" role="status" aria-live="polite">
          <span className="sync-banner-row">
            <i className="sync-dot" aria-hidden="true" />
            <span>{props.syncMessage}</span>
          </span>
          <span className="sync-track" aria-hidden="true" />
        </div>
      ) : null}

      {props.demoMode ? (
        <div className="demo-banner-wrap">
          <div className="demo-banner" role="status">
            <span className="demo-banner-text">当前为演示模式，绑定校园账号后查看实时数据</span>
            <button
              className="demo-banner-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                props.onDismissDemoTip?.()
                props.onLogin()
              }}
            >
              去登录
            </button>
          </div>
          {props.showDemoTip ? (
            <div className="demo-tip" role="tooltip">
              点这里随时登录你的校园账号，当前可先用示例数据体验全部卡片
            </div>
          ) : null}
        </div>
      ) : null}

      {props.initialSkeleton ? (
        <div className="home-skeleton" aria-label="首次加载中">
          <div className="skel skel-focus" />
          <div className="skel skel-notices" />
          <div className="skel skel-power" />
          <div className="skel-grid">
            <div className="skel skel-tile" />
            <div className="skel skel-tile" />
          </div>
        </div>
      ) : (
        <>
      {/* 现在 / 下一节：首页最重要的一件事（点击任意区域进入完整课表） */}
      <section
        className={`focus schedule-clickable ${focus ? focus.phase : 'idle'}${exam ? '' : ' solo'}${swrClass('focus')}`}
        aria-label="当前课程，点击查看全部课表"
        onClick={props.onOpenSchedule}
      >
        <SwrFx loading={props.swrCards?.focus} ripple={props.ripples?.focus} />
        {focus ? (
          <>
            <div className="focus-top">
              <span className="focus-tag">{focus.phase === 'current' ? '正在上课' : '下一节课'}</span>
              <span className="focus-time">
                {focus.start} – {focus.end} · 全部课表 ›
              </span>
            </div>
            {focus.sessions.map((s) => (
              <div key={s.id} className="focus-course">
                <b>{s.name}</b>
                <span>
                  <Icon name="pin" />
                  {s.room || '教室待定'}
                  {s.teacher ? ` · ${s.teacher}` : ''}
                </span>
              </div>
            ))}
            <p className="focus-count">
              {focus.phase === 'current'
                ? `还有 ${span(minutes(focus.end) - currentMinute)}下课`
                : `${span(minutes(focus.start) - currentMinute)}后开始`}
              {remaining > 1 ? ` · 今天还有 ${remaining} 段课` : ''}
            </p>
          </>
        ) : (
          <div className="focus-idle">
            <b>
              {props.refreshing && props.loggedIn && !props.hasTable
                ? '已登录，正在同步今日课表…'
                : props.syncMessage && !props.loggedIn
                  ? '正在验证登录状态…'
                  : !props.loggedIn
                    ? '登录教务，查看今天的课'
                    : !props.hasTable
                      ? props.courseError || '课表还没读到'
                      : groups.length
                        ? '今天的课都上完了'
                        : '今天没有课'}
            </b>
            <span>
              {props.refreshing && props.loggedIn && !props.hasTable
                ? '课表与考试拉取完成后会立即展示在这里。'
                : props.loggedIn && props.hasTable
                  ? '好好休息，或者去自习室坐一会儿。'
                  : '课表、考试都会在登录后同步到这里。'}
            </span>
            {!props.loggedIn && !props.syncMessage ? (
              <button className="focus-btn" onClick={(event) => { event.stopPropagation(); props.onLogin() }}>
                登录教务
              </button>
            ) : props.loggedIn && !props.hasTable && !props.refreshing ? (
              <button className="focus-btn" onClick={(event) => { event.stopPropagation(); props.onRefresh() }}>
                重新读取
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* 考试倒计时：独立醒目卡片 */}
      {exam ? (
        <button
          className={`exam-card${exam.days != null && exam.days <= 14 ? ' urgent' : ''}${swrClass('exam')}`}
          onClick={props.onExam}
          aria-label={`考试倒计时，${exam.ex.name}`}
        >
          <SwrFx loading={props.swrCards?.exam} ripple={props.ripples?.exam} />
          <span className="exam-card-copy">
            <span className="exam-card-tag">
              <Icon name="cap" />
              考试倒计时
            </span>
            <b>{exam.ex.name}</b>
            <small>
              {[exam.ex.date, exam.ex.time, exam.ex.room].filter(Boolean).join(' · ') || '考场待公布'}
            </small>
          </span>
          <span className="exam-card-count">
            <strong>{exam.days == null ? '—' : Math.max(0, exam.days)}</strong>
            <small>{exam.days == null ? '待定' : exam.days <= 0 ? '今天开考' : '天后'}</small>
          </span>
        </button>
      ) : null}

      {/* 未读通知：首屏直达，有未读展开前 3 条可直接点击阅读，全已读自动收起为紧凑条 */}
      <section className={`home-notices card${props.noticeUnread ? ' has-unread' : ' all-read'}${swrClass('notices')}`} aria-label="未读校园通知">
        <SwrFx loading={props.swrCards?.notices} ripple={props.ripples?.notices} />
        <div className="home-notices-head">
          <button className="home-notices-title" onClick={props.onOpenNotices}>
            <span className="tile-icon">
              <Icon name="bell" />
              {props.noticeUnread ? <i className="badge">{props.noticeUnread > 99 ? '99+' : props.noticeUnread}</i> : null}
            </span>
            <b>校园通知</b>
            <span className={`home-notices-pill${props.noticeUnread ? ' unread' : ''}`}>
              {props.noticeUnread ? `${props.noticeUnread} 条未读` : '已全部已读'}
            </span>
          </button>
          <button className="link" onClick={props.onOpenNotices}>
            全部 <Icon name="arrow" />
          </button>
        </div>
        {props.unreadNotices.length ? (
          <div className="home-notices-list">
            {props.unreadNotices.map((n) => (
              <button
                key={`${n.source}:${n.id}`}
                className="home-notice-item"
                onClick={() => props.onOpenNotice(n)}
              >
                <i className="home-notice-dot" aria-hidden="true" />
                <span className="home-notice-body">
                  <b>{n.title}</b>
                  <small>{n.sourceName} · {noticeDate(n)}</small>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* 今日课表（点击任意区域进入完整课表） */}
      <section className="block" aria-label="今日课表">
        <div
          className="day-list schedule-clickable"
          onClick={props.onOpenSchedule}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              props.onOpenSchedule()
            }
          }}
        >
          <div className="day-list-cue">
            <span>全部课表 ›</span>
          </div>
          {groups.length ? groups.map((g) => (
              <div className={`day-row ${g.phase}`} key={g.start + g.end}>
                <div className="day-time">
                  <b>{g.start}</b>
                  <small>{g.end}</small>
                </div>
                <div className="day-items">
                  {g.sessions.map((s) => (
                    <div key={s.id} className="day-item" data-cat={s.cat}>
                      <b>{s.name}</b>
                      <small>{[s.room, s.teacher].filter(Boolean).join(' · ') || '—'}</small>
                    </div>
                  ))}
                </div>
                <span className="day-state">{g.phase === 'current' ? '上课中' : g.phase === 'ended' ? '已结束' : ''}</span>
              </div>
            )) : (
          <p className="day-list-empty">
            {props.refreshing && props.loggedIn && !props.hasTable
              ? '正在同步今日课表，请稍候…'
              : !props.loggedIn
                ? '登录教务后显示今日课程。'
                : props.hasTable
                  ? '今天没有排课。'
                  : props.courseError || '暂未读取到课表。'}
          </p>
          )}
        </div>
      </section>

      {/* 校园服务 */}
      <section className="block" aria-label="校园服务">
        {/* 空调电量：卡片本体不变，移入校园服务最上方 */}
        <button
          className={`power${low ? ' low' : ''}${room ? '' : ' empty'}${swrClass('aircon')}`}
          onClick={props.onBindRoom}
          aria-label={room ? `空调剩余电量，${room.roomName}，点击更换宿舍` : '绑定宿舍查看空调电量'}
        >
          <SwrFx loading={props.swrCards?.aircon} ripple={props.ripples?.aircon} />
          <span className="power-head">
            <span className="power-title">
              <Icon name="air" />
              空调电量
            </span>
            <span className="power-room">{room ? `${room.buildName ? room.buildName + ' ' : ''}${room.roomName}` : '未绑定宿舍'}</span>
          </span>
          {!room ? (
            <span className="power-cta">
              绑定宿舍，随时查看剩余电量 <Icon name="arrow" />
            </span>
          ) : reading ? (
            <>
              <span className="power-main">
                <strong>{fmtNum(reading.remainingKwh)}</strong>
                <em>{reading.quantityUnit || '度'}</em>
                {low ? <span className="power-flag">电量偏低</span> : null}
              </span>
              <span className="power-foot">
                {reading.balanceYuan != null ? <span>余额 ¥{fmtNum(reading.balanceYuan)}</span> : null}
                {electricNote ? <span>{electricNote}</span> : null}
              </span>
            </>
          ) : (
            <span className="power-state">
              <b>{electricNote || '暂无读数'}</b>
              <small>刷新重试，或点此检查宿舍绑定</small>
            </span>
          )}
        </button>

        <div className="tiles">
          <button className={`tile${swrClass('chargers')}`} onClick={props.onOpenChargers}>
            <SwrFx loading={props.swrCards?.chargers} ripple={props.ripples?.chargers} />
            <span className="tile-icon">
              <Icon name="bolt" />
            </span>
            <span className="tile-label">充电桩 · 开元</span>
            <span className="tile-value">
              {chargers ? (
                <>
                  <strong>{chargers.free}</strong>
                  <small>/ {chargers.total} 空闲</small>
                </>
              ) : (
                <small>等待读取</small>
              )}
            </span>
            {chargerPct !== null ? (
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${chargerPct}%` }} />
              </span>
            ) : null}
            {chargers?.stale ? <small className="tile-note">上次缓存</small> : null}
          </button>
          <button className={`tile${swrClass('card')}`} onClick={props.onOpenCard}>
            <SwrFx loading={props.swrCards?.card} ripple={props.ripples?.card} />
            <span className="tile-icon">
              <Icon name="card" />
            </span>
            <span className="tile-label">校园卡余额</span>
            <span className="tile-value">{card?.balance != null ? <strong>¥{card.balance}</strong> : <small>待同步</small>}</span>
            <small className="tile-note">{cardSync ? `同步于 ${cardSync}` : '尚未同步'}</small>
          </button>
        </div>
      </section>
        </>
      )}
    </div>
  )
}
