import { Icon } from '../icons'
import { PageHeader } from '../components/ui'
import type { Theme } from '../theme'
import type { SessionStatus } from '../types'

export function Profile(props: {
  status: SessionStatus | null
  week: number
  term: string
  theme: Theme
  lastSync: string
  refreshing: boolean
  syncMessage?: string
  onRefresh: () => void
  onLogin: () => void
  onClearCache: () => void
  onClearCred: () => void
  onOpenTheme: () => void
  onChangeTheme: (t: Theme) => void
  onOpenAbout: () => void
  onOpenUpdateSettings: () => void
  appVersionName?: string
  hasUpdate?: boolean
  demoMode?: boolean
  onReplayOnboarding: () => void
}) {
  const loggedIn = !!props.status?.loggedIn && !props.demoMode

  const rows: Array<{ icon: string; name: string; sub: string; onClick: () => void }> = [
    {
      icon: 'sync',
      name: '数据同步',
      sub: props.demoMode
        ? '演示模式（登录校园账号后同步实时数据）'
        : props.lastSync
          ? `上次刷新 ${props.lastSync}`
          : '点右侧刷新拉取最新数据',
      onClick: props.onRefresh
    },
    {
      icon: 'user',
      name: '教务账号',
      sub: loggedIn
        ? `已登录${props.status?.studentName ? ' · ' + props.status.studentName : ''}`
        : props.demoMode
          ? '当前为演示模式 · 点此登录真实账号'
          : '未登录 · 点此登录',
      onClick: props.onLogin
    },
    {
      icon: 'storage',
      name: '缓存管理',
      sub: '清除本地业务缓存（保留凭据与宿舍绑定）',
      onClick: props.onClearCache
    },
    {
      icon: 'book',
      name: '重新查看新手引导',
      sub: '回看功能介绍与模式选择（不清空已有数据）',
      onClick: props.onReplayOnboarding
    },
    {
      icon: 'sync',
      name: '自动更新设置',
      sub: props.hasUpdate
        ? '发现新版本 · 点此查看并下载更新'
        : `当前 v${props.appVersionName || '0.1.10'} · 云端检查与 Beta 渠道`,
      onClick: props.onOpenUpdateSettings
    },
    {
      icon: 'info',
      name: '关于科小喵',
      sub: '校园助手 · 界面改版',
      onClick: props.onOpenAbout
    }
  ]

  return (
    <>
      <PageHeader
        title="我的"
        sub="校园生活，有条不紊。"
        refreshing={props.refreshing}
        onRefresh={props.onRefresh}
      />

      {props.syncMessage ? (
        <div className="sync-banner" role="status" aria-live="polite" style={{ marginBottom: 14 }}>
          <span className="sync-banner-row">
            <i className="sync-dot" aria-hidden="true" />
            <span>{props.syncMessage}</span>
          </span>
          <span className="sync-track" aria-hidden="true" />
        </div>
      ) : null}

      <div className="card profile">
        <div className="cat">
          <Icon name="cat" />
        </div>
        <div>
          <h2>
            {props.status?.studentName || '校园助手'}{' '}
            <span className="pill">{loggedIn ? '已登录' : '去登录'}</span>
          </h2>
          <small>
            第 {props.week} 教学周
            {props.term ? ` · ${props.term}` : ''}
          </small>
        </div>
      </div>

      <div className="card settings">
        {rows.map((r) => (
          <button className="setting" key={r.name} onClick={r.onClick}>
            <Icon name={r.icon} />
            <span className="setting-copy">
              <b>{r.name}</b>
              <small>{r.sub}</small>
            </span>
            <Icon name="arrow" className="arrow" />
          </button>
        ))}
        <button className="setting danger" onClick={props.onClearCred}>
          <Icon name="close" />
          <span className="setting-copy">
            <b>清除登录凭据</b>
            <small>清除凭据、会话与账号缓存，下次需重新登录</small>
          </span>
          <Icon name="arrow" className="arrow" />
        </button>
      </div>

      <div className="sectionhead">
        <h2>外观</h2>
      </div>
      <div className="themechoices">
        {(
          [
            ['light', 'sun', '浅色'],
            ['dark', 'moon', '深色'],
            ['system', 'monitor', '跟随系统']
          ] as Array<[Theme, string, string]>
        ).map(([v, i, n]) => (
          <button
            key={v}
            className={`themechoice${props.theme === v ? ' selected' : ''}`}
            onClick={() => props.onChangeTheme(v)}
            data-theme-choice={v}
          >
            <Icon name={i} />
            {n}
          </button>
        ))}
      </div>

      <p className="footer-note">科小喵 · 让每一天，井然有序。</p>
    </>
  )
}
