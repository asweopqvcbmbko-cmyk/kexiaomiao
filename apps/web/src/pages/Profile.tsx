import { Icon } from '../icons'
import { PageHeader } from '../components/ui'
import type { Theme } from '../theme'
import type { SessionStatus } from '../types'
import './profile-system.css'

const themeChoices = {
  light: { icon: 'sun', label: '浅色', status: '浅色模式' },
  dark: { icon: 'moon', label: '深色', status: '深色模式' },
  system: { icon: 'monitor', label: '跟随系统', status: '跟随系统' }
} satisfies Record<Theme, { icon: string; label: string; status: string }>

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
  const studentName = loggedIn ? props.status?.studentName : undefined
  const versionName = props.appVersionName || '0.1.10'
  const week = `第 ${props.week} 教学周`
  const identity = loggedIn
    ? [studentName, '已登录', week].filter(Boolean).join(' · ')
    : props.demoMode
      ? `演示模式 · ${week}`
      : `未登录 · 点下方登录教务 · ${week}`
  const theme = themeChoices[props.theme]

  const tiles = [
    {
      icon: 'user',
      name: '教务账号',
      value: loggedIn ? (studentName ? `已登录 · ${studentName}` : '已登录') : props.demoMode ? '演示模式' : '未登录',
      dot: loggedIn,
      onClick: props.onLogin
    },
    {
      icon: 'sync',
      name: '数据同步',
      value: props.refreshing ? '正在同步…' : props.lastSync ? `上次刷新 ${props.lastSync}` : '点击立即同步',
      spinning: props.refreshing,
      onClick: props.onRefresh
    },
    {
      icon: theme.icon,
      name: '外观主题',
      value: theme.status,
      opensDialog: true,
      onClick: props.onOpenTheme
    },
    {
      icon: 'refresh',
      name: '云端更新',
      value: props.hasUpdate ? '发现新版本' : `v${versionName} · 检查更新`,
      highlighted: props.hasUpdate,
      opensDialog: true,
      onClick: props.onOpenUpdateSettings
    }
  ]

  const rows = [
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
      icon: 'info',
      name: '关于科小喵',
      sub: '校园助手 · 开放源代码与版本信息',
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

      <div className="profile-system">
        <div className={`profile-system-hero-frame${props.hasUpdate ? ' has-update' : ''}`}>
          <button type="button" className="profile-system-hero" aria-haspopup="dialog" onClick={props.onOpenUpdateSettings}>
            <span className="profile-system-hero-top">
              <span className="profile-system-hero-brand">
                <span className="profile-system-cat"><Icon name="cat" /></span>
                <span className="profile-system-brand-copy">
                  <b>科小喵</b>
                  <span className="profile-system-channel">{/beta/i.test(versionName) ? 'Beta' : '正式版'}</span>
                </span>
              </span>
              <span className="profile-system-update-badge">
                {props.hasUpdate ? <span className="profile-system-update-dot" aria-hidden="true" /> : null}
                {props.hasUpdate ? '发现新版本' : '检查更新'}
                {!props.hasUpdate ? <Icon name="arrow" /> : null}
              </span>
            </span>
            <span className="profile-system-hero-main">
              <span className="profile-system-version"><span>v</span>{versionName}</span>
              <span className="profile-system-identity">{identity}</span>
            </span>
            <span className="profile-system-hero-bottom">
              {props.term ? <span>{props.term}</span> : null}
              <span className="profile-system-hero-link">云端更新与版本通道 <Icon name="arrow" /></span>
            </span>
          </button>
        </div>

        <div className="profile-system-grid" role="group" aria-label="快捷设置">
          {tiles.map((tile) => (
            <button
              type="button"
              className="profile-system-tile"
              key={tile.name}
              aria-busy={tile.spinning}
              aria-haspopup={tile.opensDialog ? 'dialog' : undefined}
              onClick={tile.onClick}
            >
              <span className="profile-system-tile-top">
                <span className="profile-system-icon">
                  <Icon name={tile.icon} className={tile.spinning ? 'profile-system-spinning' : undefined} />
                </span>
                <Icon name="arrow" className="profile-system-chevron" />
              </span>
              <span className="profile-system-tile-copy">
                <b>{tile.name}</b>
                <span className={`profile-system-tile-status${tile.highlighted ? ' is-highlighted' : ''}`}>
                  {tile.dot ? <span className="profile-system-login-dot" aria-hidden="true" /> : null}
                  <span className="profile-system-tile-value" title={tile.value}>{tile.value}</span>
                </span>
              </span>
            </button>
          ))}
        </div>

        <section className="profile-system-section">
          <h2 id="profile-system-appearance">外观</h2>
          <div className="profile-system-themes" role="group" aria-labelledby="profile-system-appearance">
            {(['light', 'dark', 'system'] as const).map((v) => (
              <button
                type="button"
                className="themechoice"
                key={v}
                aria-pressed={props.theme === v}
                onClick={() => props.onChangeTheme(v)}
                data-theme-choice={v}
              >
                <Icon name={themeChoices[v].icon} />
                {themeChoices[v].label}
              </button>
            ))}
          </div>
        </section>

        <section className="profile-system-section">
          <h2>常规与数据</h2>
          <div className="profile-system-group">
            {rows.map((row) => (
              <button type="button" className="profile-system-row" key={row.name} onClick={row.onClick}>
                <span className="profile-system-icon"><Icon name={row.icon} /></span>
                <span className="profile-system-row-copy">
                  <b>{row.name}</b>
                  <small>{row.sub}</small>
                </span>
                <Icon name="arrow" className="profile-system-chevron" />
              </button>
            ))}
          </div>
        </section>

        <section className="profile-system-section">
          <h2>账号安全</h2>
          <div className="profile-system-group profile-system-danger">
            <button type="button" className="profile-system-row" onClick={props.onClearCred}>
              <span className="profile-system-icon"><Icon name="warning" /></span>
              <span className="profile-system-row-copy">
                <b>清除登录凭据</b>
                <small>清除凭据、会话与账号缓存，下次需重新登录</small>
              </span>
              <Icon name="arrow" className="profile-system-chevron" />
            </button>
          </div>
        </section>
      </div>

      <p className="footer-note">科小喵 · 让每一天，井然有序。</p>
    </>
  )
}
