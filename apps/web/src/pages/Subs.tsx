import { useId, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import { PageHeader, Empty } from '../components/ui'
import { CollegePickerModal } from '../components/CollegePickerModal'
import { daysUntil, noticeDate, noticeKey, openAtLabel, type chargerView } from '../adapters'
import { getCollegeById, getSubscribedCollegeSources, readSubscribedColleges, writeSubscribedColleges } from '../college-notices'
import { haptic } from '../haptics'
import type { Exam, NoticeItem } from '../types'

/** 子页外壳：与主页面同样的 topbar，多一个返回按钮 */
function SubShell(props: {
  title: string
  sub: string
  eyebrow: string
  refreshing: boolean
  onRefresh: () => void
  onBack: () => void
  children: React.ReactNode
  action?: { icon: string; label: string; onClick: () => void }
  extra?: React.ReactNode
}) {
  return (
    <>
      <PageHeader
        title={props.title}
        sub={props.sub}
        eyebrow={props.eyebrow}
        refreshing={props.refreshing}
        onRefresh={props.onRefresh}
        onBack={props.onBack}
        action={props.action}
        extra={props.extra}
      />
      {props.children}
    </>
  )
}

const CORE_NOTICE_FILTERS = [
  { id: 'jwc', shortName: '教务处' },
  { id: 'school', shortName: '全校' },
  { id: 'news', shortName: '新闻' }
]

function localNoticeDate(now: Date, daysAgo = 0) {
  const date = new Date(now)
  date.setDate(date.getDate() - daysAgo)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function NoticesPage(props: {
  items: NoticeItem[]
  readIds: string[]
  stale: boolean
  authRequired?: boolean
  refreshing: boolean
  subscribedColleges?: string[]
  onChangeSubscribedColleges?: (ids: string[]) => void
  onRefresh: () => void
  onBack?: () => void
  onOpen: (n: NoticeItem) => void
  onMarkAllRead: () => void
  onLogin?: () => void
}) {
  const [savedColleges, setSavedColleges] = useState(readSubscribedColleges)
  const subscribedColleges = props.subscribedColleges ?? savedColleges
  const collegeSources = getSubscribedCollegeSources(subscribedColleges)
  const [src, setSrc] = useState('all')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const searchId = useId()
  const searchInput = useRef<HTMLInputElement>(null)
  const searchTrigger = useRef<HTMLButtonElement>(null)
  const term = query.trim().toLowerCase()

  const readIds = useMemo(() => new Set(props.readIds), [props.readIds])
  const unread = props.items.filter((n) => !readIds.has(noticeKey(n))).length
  const channels = [
    { id: 'all', shortName: '全部' },
    ...(unread > 0 || src === 'unread' ? [{ id: 'unread', shortName: `未读 ${unread}` }] : []),
    ...CORE_NOTICE_FILTERS,
    ...collegeSources
  ]
  const activeSource = channels.some(({ id }) => id === src) ? src : 'all'

  const list = props.items.filter((n) =>
    (activeSource === 'all' || (activeSource === 'unread' ? !readIds.has(noticeKey(n)) : n.source === activeSource)) &&
    (!term || [n.title, n.dept, n.sourceName].some((value) => value?.toLowerCase().includes(term)))
  )
  const filtered = Boolean(term || activeSource !== 'all')
  const now = new Date()
  const today = localNoticeDate(now)
  const yesterday = localNoticeDate(now, 1)
  const weekAgo = localNoticeDate(now, 7)
  const groups: { label: string; items: NoticeItem[] }[] = [
    { label: '今天', items: [] },
    { label: '近 7 天', items: [] },
    { label: '更早', items: [] }
  ]
  for (const n of list) {
    const groupIndex = n.date === today ? 0 : n.date >= weekAgo && n.date < today ? 1 : 2
    groups[groupIndex].items.push(n)
  }
  const visibleGroups = groups.filter((group) => group.items.length > 0)

  function closeSearch() {
    setSearchOpen(false)
    setQuery('')
    searchTrigger.current?.focus()
  }

  function clearFilters() {
    haptic('light')
    setSrc('all')
    setQuery('')
  }

  function saveColleges(ids: string[]) {
    if (props.subscribedColleges === undefined) setSavedColleges(writeSubscribedColleges(ids))
    props.onChangeSubscribedColleges?.(ids)
    if (getCollegeById(src) && !ids.includes(src)) setSrc('all')
    setPickerOpen(false)
  }

  return (
    <div className="notices-page">
      <PageHeader
        title="校园通知"
        sub={unread > 0 ? `${unread} 条未读` : `全部已读 · 共 ${props.items.length} 条`}
        refreshing={props.refreshing}
        onRefresh={props.onRefresh}
        extra={
          <>
            <button
              ref={searchTrigger}
              className="iconbtn"
              type="button"
              aria-label="搜索通知"
              aria-expanded={searchOpen}
              aria-controls={searchOpen ? searchId : undefined}
              onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}
            >
              <Icon name="search" />
            </button>
            <button
              className={`mark-all-btn notice-college-trigger${subscribedColleges.length === 0 ? ' has-dot' : ''}`}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPickerOpen(true)}
            >
              {collegeSources.length ? `学院(${collegeSources.length})` : '学院'}
            </button>
          </>
        }
      />
      {searchOpen && (
        <div className="notice-search-bar" id={searchId} role="search" aria-label="搜索通知">
          <div className="notice-search notice-search-with-clear">
            <Icon name="search" />
            <input
              ref={searchInput}
              type="search"
              aria-label="搜索标题或发布部门"
              placeholder="搜索标题或发布部门…"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button className="notice-search-clear" type="button" aria-label="清除搜索" onClick={() => {
                setQuery('')
                searchInput.current?.focus()
              }}>×</button>
            )}
          </div>
          <button className="notice-search-cancel" type="button" onClick={closeSearch}>取消</button>
        </div>
      )}
      {props.authRequired ? (
        <div className="demo-banner" role="status" style={{ marginBottom: 14 }}>
          <span className="demo-banner-text">校园网认证已过期，当前显示离线缓存；已缓存正文仍可直接阅读</span>
          {props.onLogin ? (
            <button className="demo-banner-btn" type="button" onClick={props.onLogin}>
              去登录
            </button>
          ) : null}
        </div>
      ) : props.stale ? (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, fontSize: 12 }}>当前显示的是本地离线缓存，刚才刷新失败。</div>
      ) : null}

      <div className="notice-channels" role="group" aria-label="筛选通知">
        {channels.map(({ id, shortName }) => (
          <button
            className="notice-channel"
            type="button"
            key={id}
            aria-pressed={activeSource === id}
            onClick={() => {
              if (activeSource !== id) haptic('light')
              setSrc(id)
            }}
          >
            {getCollegeById(id) && <i className="notice-college-dot" aria-hidden="true" />}
            {shortName}
          </button>
        ))}
      </div>

      {visibleGroups.length ? visibleGroups.map((group, index) => (
        <section className="notice-group" key={group.label}>
          <div className="notice-group-head">
            <h3>{group.label}</h3>
            {index === 0 && unread > 0 && (
              <button className="notice-mark-read" type="button" onClick={props.onMarkAllRead}>全部已读</button>
            )}
          </div>
          <div className="card notice-group-card">
            {group.items.map((n) => {
              const key = noticeKey(n)
              const read = readIds.has(key)
              const college = getCollegeById(n.source)
              const core = CORE_NOTICE_FILTERS.find(({ id }) => id === n.source)
              const sourceName = n.sourceName?.trim() || college?.shortName || core?.shortName || n.source
              const variant = college ? ' src-college' : core ? ` src-${core.id}` : ''
              const shortDate = n.date === today ? '今天' : n.date === yesterday ? '昨天'
                : /^\d{4}-\d{2}-\d{2}$/.test(n.date) ? n.date.slice(5).replace('-', '/') : noticeDate(n)
              return (
                <button className={`notice-item-row${read ? ' is-read' : ''}`} type="button" key={key} onClick={() => props.onOpen(n)}>
                  <span className="notice-item-dot" aria-hidden="true" />
                  <span className="notice-item-copy">
                    <span className="notice-item-title">
                      <span className="notice-read-status">{read ? '已读：' : '未读：'}</span>
                      {n.title}
                    </span>
                    <span className="notice-item-meta">
                      <span className={`notice-source-badge${variant}`}>{sourceName}</span>
                      {shortDate && <span className="notice-item-date">{shortDate}</span>}
                    </span>
                  </span>
                  <Icon name="arrow" className="arrow" />
                </button>
              )
            })}
          </div>
        </section>
      )) : props.items.length > 0 && filtered ? (
        <Empty title={activeSource === 'unread' && !term ? '没有未读通知' : '没有匹配的通知'} icon="bell">
          <button className="softbtn notice-clear-filters" type="button" onClick={clearFilters}>清除筛选</button>
        </Empty>
      ) : (
        <Empty title="没有取到通知" sub="检查网络或稍后刷新。" icon="bell" />
      )}
      <p className="footer-note">正文按需拉取并自动离线缓存在本机 · 已读状态本地保存</p>
      {pickerOpen && (
        <CollegePickerModal selected={subscribedColleges} onSave={saveColleges} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  )
}

export function ChargersPage(props: {
  view: NonNullable<ReturnType<typeof chargerView>>
  refreshing: boolean
  onRefresh: () => void
  onBack: () => void
}) {
  const { view } = props
  return (
    <SubShell
      title="充电桩"
      sub={`空闲 ${view.free} / ${view.total} · ${view.rows.length} 个点位`}
      eyebrow="CHARGING PILES"
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      onBack={props.onBack}
    >
      <div className="card stats">
        <div className="stat">
          <strong>{view.free}</strong>
          <small>当前空闲</small>
        </div>
        <div className="stat">
          <strong>{view.total}</strong>
          <small>总端口</small>
        </div>
        <div className="stat">
          <strong>{view.devices}</strong>
          <small>设备数</small>
        </div>
      </div>
      <div className="card">
        {view.rows.map((r) => (
          <div className="taskrow" key={r.name}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{r.name}</b>
              <small style={{ display: 'block', marginTop: 3 }}>
                {r.distance} m · 充电中 {r.charging} · {r.devices} 台设备
              </small>
              <div className="charge-track" style={{ marginTop: 8 }}>
                <i style={{ width: `${r.percent}%` }} />
              </div>
            </div>
            <strong style={{ fontSize: 15, color: r.free ? 'var(--brand)' : 'var(--muted)', flexShrink: 0 }}>
              {r.free}/{r.total}
            </strong>
          </div>
        ))}
      </div>
      <p className="footer-note">数据来自智惠充电公开接口{view.stale ? '（本地缓存）' : ''}</p>
    </SubShell>
  )
}

export function CardPage(props: {
  view: { balance: string | null; at: string; stale: boolean } | null
  refreshing: boolean
  onRefresh: () => void
  onBack: () => void
}) {
  const { view } = props
  const at = view?.at ? new Date(view.at) : null
  const atText = at && !Number.isNaN(at.getTime()) ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '—'
  return (
    <SubShell
      title="校园卡"
      sub={view?.balance ? `余额 ¥${view.balance}` : '暂无数据'}
      eyebrow="CAMPUS CARD"
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      onBack={props.onBack}
    >
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <small>{view?.balance ? '账户余额' : '还没有读到余额'}</small>
        <div style={{ fontSize: 42, fontWeight: 650, margin: '10px 0', color: 'var(--brand)' }}>
          {view?.balance ? `¥${view.balance}` : '暂无数据'}
        </div>
        <small>{view?.balance ? `上次同步 ${atText}` : '点右上角刷新重试 · 学校卡片服务偶尔返回“-元”'}</small>
      </div>
      <p className="footer-note">数据来自 i 科大首页卡片，只读，不发起任何支付</p>
    </SubShell>
  )
}

export function ExamPage(props: { exams: Exam[]; refreshing: boolean; onRefresh: () => void; onBack: () => void }) {
  return (
    <SubShell
      title="考试安排"
      sub={props.exams.length ? `已发布 ${props.exams.length} 场` : '暂无数据'}
      eyebrow="EXAMS"
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      onBack={props.onBack}
    >
      {props.exams.length ? (
        <div className="card">
          {props.exams.map((e, i) => {
            const days = daysUntil(e)
            return (
              <div className="taskrow" key={`${e.code}-${i}`} style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 14 }}>{e.name}</b>
                  <small style={{ display: 'block', marginTop: 4 }}>
                    {openAtLabel(e)} {e.time} · {e.room}
                    {e.seat ? ` · 座位 ${e.seat}` : ''}
                  </small>
                </div>
                <span className="due" style={{ flexShrink: 0, color: days != null && days <= 14 ? 'var(--danger)' : 'var(--muted)' }}>
                  {days == null ? '—' : days < 0 ? '已结束' : `${days} 天`}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <Empty title="教务还没发布考试安排" sub="发布后这里会自动出现。" icon="cap" />
      )}
      <p className="footer-note">数据来自教务系统考试安排</p>
    </SubShell>
  )
}
