import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { PageHeader, Empty } from '../components/ui'
import { daysUntil, noticeDate, openAtLabel, type chargerView } from '../adapters'
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

export function NoticesPage(props: {
  items: NoticeItem[]
  readIds: string[]
  stale: boolean
  authRequired?: boolean
  refreshing: boolean
  subscribedColleges?: string[]
  onChangeSubscribedColleges?: (ids: string[]) => void
  onRefresh: () => void
  onBack: () => void
  onOpen: (n: NoticeItem) => void
  onMarkAllRead: () => void
  onLogin?: () => void
}) {
  const sources = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of props.items) map.set(n.source, n.sourceName || n.source)
    return Array.from(map.entries())
  }, [props.items])
  const [src, setSrc] = useState('all')

  const list = props.items.filter((n) => src === 'all' || n.source === src).slice(0, 100)
  const unread = props.items.filter((n) => !props.readIds.includes(`${n.source}:${n.id}`)).length

  return (
    <SubShell
      title="校园通知"
      sub={`${unread} 条未读 · 本地共 ${props.items.length} 条`}
      eyebrow="CAMPUS NOTICES"
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      onBack={props.onBack}
      extra={
        props.items.length ? (
          <button
            className="mark-all-btn"
            onClick={props.onMarkAllRead}
            disabled={unread === 0}
          >
            {unread > 0 ? '全部已读' : '已全部已读'}
          </button>
        ) : null
      }
    >
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

      {sources.length > 1 ? (
        <div className="filterbar">
          <button className={`chip${src === 'all' ? ' selected' : ''}`} onClick={() => setSrc('all')}>
            全部
          </button>
          {sources.map(([k, name]) => (
            <button key={k} className={`chip${src === k ? ' selected' : ''}`} onClick={() => setSrc(k)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {list.length ? (
        <div className="card noticebox">
          {list.map((n) => {
            const read = props.readIds.includes(`${n.source}:${n.id}`)
            return (
              <button className={`notice${read ? ' is-read' : ''}`} key={`${n.source}:${n.id}`} onClick={() => props.onOpen(n)}>
                <div className="notice-icon">
                  <Icon name="bell" />
                  {!read ? <i className="unread-dot" aria-label="未读" /> : null}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3>{n.title}</h3>
                  <small>
                    {n.sourceName} · {noticeDate(n)}
                    {read ? ' · 已读' : ' · 未读'}
                  </small>
                </div>
                <Icon name="arrow" className="arrow" />
              </button>
            )
          })}
        </div>
      ) : (
        <Empty title="没有取到通知" sub="检查网络或稍后刷新。" icon="bell" />
      )}
      <p className="footer-note">正文按需拉取并自动离线缓存在本机 · 已读状态本地保存</p>
    </SubShell>
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
