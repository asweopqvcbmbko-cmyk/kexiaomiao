import { useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Icon } from '../icons'
import { haptic } from '../haptics'
import { data, supportsSaveImageToGallery } from '../api'
import {
  DEFAULT_SPONSORS_MANIFEST,
  REWARD_QR_IMAGE,
  SPONSORS,
  fetchRemoteSponsors,
  readCachedSponsors,
  type SponsorsManifest
} from '../sponsors'
import appIconUrl from '../assets/app-icon.png'
import type { Theme } from '../theme'
import type { SessionStatus } from '../types'
import './profile-system.css'

export type ProfileSubPage = 'root' | 'about' | 'privacy' | 'support'

const themeLabels: Record<Theme, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统'
}
const repository = 'asweopqvcbmbko-cmyk/kexiaomiao'

type ProfileProps = {
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
  onOpenAbout?: () => void
  onOpenUpdateSettings: () => void
  appVersionName?: string
  hasUpdate?: boolean
  demoMode?: boolean
  onReplayOnboarding: () => void
  onOpenExternal?: (url: string) => void
  onToast?: (msg: string) => void
  chaoxingSupported?: boolean
  chaoxingLoggedIn?: boolean
  onLogoutChaoxing?: () => void
  subPage?: ProfileSubPage
  onSubPageChange?: (page: ProfileSubPage) => void
}

type Row = {
  title: string
  description?: string
  value?: string
  icon?: string
  tone: 'blue' | 'green' | 'amber' | 'violet' | 'teal' | 'sky' | 'red' | 'pink' | 'neutral'
  badge?: boolean
  dot?: boolean
  syncing?: boolean
  dialog?: boolean
  external?: boolean
  onClick?: () => void
}

function SettingsRow({ row, buttonRef, iosBadge = false }: { row: Row; buttonRef?: Ref<HTMLButtonElement>; iosBadge?: boolean }) {
  const hasIcon = Boolean(row.icon)
  const content = (
    <>
      {hasIcon ? (
        <span className={iosBadge ? 'pf-ios-icon' : 'pf-icon'} data-tone={row.tone} aria-hidden="true">
          <Icon name={row.icon!} className={row.syncing ? 'pf-spin' : undefined} />
        </span>
      ) : null}
      <span className="pf-row-copy">
        <span className="pf-row-title">{row.title}</span>
        {row.description ? <span className="pf-row-desc">{row.description}</span> : null}
      </span>
      {row.value ? (
        <span className={row.badge ? 'pf-value pf-pill-badge' : 'pf-value'}>
          {row.dot ? <span className="pf-online-dot" aria-hidden="true" /> : null}
          <span>{row.value}</span>
        </span>
      ) : null}
      {row.onClick ? <Icon name={row.external ? 'external' : 'arrow'} className="pf-chevron" /> : null}
    </>
  )

  return row.onClick ? (
    <button
      ref={buttonRef}
      type="button"
      className={`pf-row${hasIcon ? (iosBadge ? ' has-ios-icon' : ' has-icon') : ''}`}
      data-tone={row.tone}
      aria-haspopup={row.dialog ? 'dialog' : undefined}
      disabled={row.syncing}
      onClick={() => {
        haptic('light')
        row.onClick?.()
      }}
    >
      {content}
    </button>
  ) : (
    <div className={`pf-row${hasIcon ? (iosBadge ? ' has-ios-icon' : ' has-icon') : ''}`} data-tone={row.tone}>
      {content}
    </div>
  )
}

function SettingsGroup({ title, rows, iosBadge = false }: { title?: string; rows: Row[]; iosBadge?: boolean }) {
  return (
    <section className="pf-section" aria-label={title || '设置分组'}>
      {title ? <h2 className="pf-group-label">{title}</h2> : null}
      <div className="pf-card">
        {rows.map((row) => <SettingsRow key={row.title} row={row} iosBadge={iosBadge} />)}
      </div>
    </section>
  )
}

const credits: Row[] = [
  { title: 'React + TypeScript', description: '前端界面与状态架构', icon: 'grid', tone: 'blue' },
  { title: 'Capacitor Android', description: '原生 WebView 与系统桥接', icon: 'bolt', tone: 'teal' },
  {
    title: 'SleepDown-Schedule',
    description: '界面动效与 ColorOS / iOS 质感参考',
    icon: 'github',
    tone: 'neutral'
  }
]

const privacySections = [
  {
    title: '1. 本地优先与零第三方服务器',
    body: '科小喵是一款纯本地运行的开源校园助手。你的教务课表、考试安排、通知缓存、电费读数、校园卡余额与学习通待办均直接与河南科技大学官方系统或超星官方接口通信，不经过任何第三方中转服务器，我们不会收集、上传或统计你的任何个人数据。'
  },
  {
    title: '2. 账号凭据本机加密存储',
    body: '当你主动勾选「保存密码」时，统一身份认证账号密码与学习通凭据仅保存在本机 Android Keystore 加密存储区中，用于断网重连、应用升级后静默续登与电费认证换票。未勾选保存密码时，凭据仅用于当次登录流程，不落盘留存。'
  },
  {
    title: '3. 联网访问范围说明',
    body: '应用仅在必要时访问以下合法域名：学校官方教务/通知/统一认证/统一支付平台（*.haust.edu.cn）、校园电控平台（17wanxiao.com）、校园充电桩实时状态接口、超星学习通官方接口（*.chaoxing.com）以及 GitHub / jsDelivr 云端版本更新清单。'
  },
  {
    title: '4. 权限最小化原则',
    body: '应用不申请通讯录、短信、通话记录、定位或后台常驻权限。仅在你主动点击「保存图片到相册」或「应用内安装更新」时，按系统规范申请对应的相册写入或未知来源安装权限。'
  },
  {
    title: '5. 随时可控与彻底清除',
    body: '你可以随时在「设置 → 退出学习通」单独清除学习通会话与缓存，或在「设置 → 清除登录凭据」一键彻底销毁本机所有已保存凭据、Cookie 与账号缓存。项目全部源代码以 MIT 协议公开，欢迎随时审计。'
  }
]

const depthOf = (page: ProfileSubPage) => (page === 'root' ? 0 : page === 'about' ? 1 : 2)

export function Profile(props: ProfileProps) {
  const [internalPage, setInternalPage] = useState<ProfileSubPage>('root')
  const [transitionDir, setTransitionDir] = useState<'none' | 'enter' | 'exit'>('none')
  const [query, setQuery] = useState('')
  const [savingQr, setSavingQr] = useState(false)
  const [qrSaved, setQrSaved] = useState(false)
  const [sponsorsState, setSponsorsState] = useState<{
    manifest: SponsorsManifest
    hasCache: boolean
    loading: boolean
  }>(() => {
    const cached = readCachedSponsors()
    const fallback: SponsorsManifest = { ...DEFAULT_SPONSORS_MANIFEST, entries: SPONSORS }
    return {
      manifest: cached ?? fallback,
      hasCache: Boolean(cached),
      loading: false
    }
  })
  const sponsorsReqId = useRef(0)
  const qrSavedTimer = useRef<number | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const subHeading = useRef<HTMLHeadingElement>(null)
  const aboutTrigger = useRef<HTMLButtonElement>(null)

  useEffect(() => () => {
    sponsorsReqId.current += 1
    if (qrSavedTimer.current !== null) window.clearTimeout(qrSavedTimer.current)
  }, [])

  const page = props.subPage ?? internalPage
  const prevPage = useRef<ProfileSubPage>(page)

  const refreshSponsors = async (manual: boolean) => {
    const reqId = ++sponsorsReqId.current
    if (manual) haptic('light')
    setSponsorsState((prev) => ({ ...prev, loading: true }))
    const res = await fetchRemoteSponsors({
      fallback: { ...DEFAULT_SPONSORS_MANIFEST, entries: SPONSORS }
    })
    if (reqId !== sponsorsReqId.current) return
    setSponsorsState({
      manifest: res.manifest,
      hasCache: res.ok || res.fromCache,
      loading: false
    })
    if (manual) {
      if (res.ok) {
        haptic('success')
        props.onToast?.('致谢名单已更新')
      } else {
        props.onToast?.('暂时无法同步云端名单，已展示本地内容')
      }
    }
  }

  useEffect(() => {
    if (page === 'support') {
      void refreshSponsors(false)
    }
  }, [page])

  useEffect(() => {
    if (page !== prevPage.current) {
      setTransitionDir(depthOf(page) >= depthOf(prevPage.current) ? 'enter' : 'exit')
      prevPage.current = page
      window.scrollTo({ top: 0 })
      if (page !== 'root') {
        subHeading.current?.focus({ preventScroll: true })
      } else {
        aboutTrigger.current?.focus({ preventScroll: true })
      }
    }
  }, [page])

  const navigate = (next: ProfileSubPage) => {
    haptic('light')
    setTransitionDir(depthOf(next) >= depthOf(page) ? 'enter' : 'exit')
    if (props.onSubPageChange) props.onSubPageChange(next)
    else setInternalPage(next)
  }

  const versionName = props.appVersionName || '0.2.3'
  const version = `v${versionName}`
  const releaseLabel = /beta/i.test(versionName) ? 'Beta' : '正式版'

  const openRepository = () => {
    const url = `https://github.com/${repository}`
    if (props.onOpenExternal) props.onOpenExternal(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  const saveQrToGallery = async () => {
    if (!REWARD_QR_IMAGE || savingQr) return
    haptic('light')
    setSavingQr(true)
    try {
      const resp = await fetch(REWARD_QR_IMAGE)
      const blob = await resp.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(blob)
      })
      const res = await data.saveImageToGallery(dataUrl, 'KeXiaoMiao-Reward-QR')
      if (res.saved) {
        haptic('success')
        setQrSaved(true)
        if (qrSavedTimer.current !== null) window.clearTimeout(qrSavedTimer.current)
        qrSavedTimer.current = window.setTimeout(() => setQrSaved(false), 2400)
        props.onToast?.('赞赏码已保存到相册，可打开微信扫一扫识别')
      } else {
        props.onToast?.(res.message || '保存失败，请直接截屏识别')
      }
    } catch {
      props.onToast?.('保存失败，请直接截屏识别')
    } finally {
      setSavingQr(false)
    }
  }

  const loggedIn = !!props.status?.loggedIn && !props.demoMode
  const accountValue = loggedIn
    ? ['已登录', props.status?.studentName].filter(Boolean).join(' · ')
    : props.demoMode ? '演示模式' : '未登录'
  const syncValue = props.refreshing ? '正在同步…' : props.lastSync ? `上次 ${props.lastSync}` : '立即同步'
  const updateValue = props.hasUpdate ? '发现新版本' : version

  const groups: { title?: string; rows: Row[] }[] = [
    {
      rows: [
        { title: '教务账号', value: accountValue, icon: 'user', tone: 'blue', dot: loggedIn, onClick: props.onLogin },
        { title: '数据同步', value: syncValue, icon: 'sync', tone: 'green', syncing: props.refreshing, onClick: props.onRefresh },
        { title: '外观主题', value: themeLabels[props.theme], icon: 'sun', tone: 'amber', dialog: true, onClick: props.onOpenTheme },
        { title: '软件更新', value: updateValue, icon: 'refresh', tone: 'violet', badge: props.hasUpdate, onClick: props.onOpenUpdateSettings },
        { title: '重新查看新手引导', icon: 'book', tone: 'teal', onClick: props.onReplayOnboarding }
      ]
    },
    {
      title: '存储与账号安全',
      rows: [
        {
          title: '缓存管理',
          description: '清除本地业务缓存，保留凭据与宿舍绑定',
          icon: 'storage',
          tone: 'sky',
          onClick: props.onClearCache
        },
        ...(props.chaoxingSupported && props.onLogoutChaoxing ? [{
          title: '退出学习通',
          description: '仅清除学习通会话与缓存，保留教务与电费',
          value: props.chaoxingLoggedIn === undefined ? undefined : props.chaoxingLoggedIn ? '已登录' : '未登录',
          icon: 'logout',
          tone: 'amber' as const,
          onClick: props.onLogoutChaoxing
        }] : []),
        {
          title: '清除登录凭据',
          description: '清除全部凭据、会话与账号缓存',
          icon: 'warning',
          tone: 'red',
          onClick: props.onClearCred
        }
      ]
    }
  ]

  const identitySummary = `版本 ${versionName} · ${props.hasUpdate ? '发现新版本' : releaseLabel}`
  const aboutRow: Row = {
    title: '关于应用',
    description: `科小喵 · ${identitySummary}`,
    icon: 'cat',
    tone: 'violet',
    onClick: () => navigate('about')
  }

  const searchTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (row: Row, groupTitle = '') => {
    const text = [row.title, row.description, row.value, groupTitle].join(' ').toLowerCase()
    return searchTerms.every((term) => text.includes(term))
  }
  const searchActive = searchTerms.length > 0
  const matchingRows = searchActive
    ? groups.flatMap(({ title, rows }) => rows.filter((row) => matches(row, title || '')))
    : []
  const aboutMatches = searchActive && matches(aboutRow)

  const pageAnimClass = transitionDir === 'enter' ? 'pf-page-enter' : transitionDir === 'exit' ? 'pf-page-return' : ''

  /* ── 隐私政策子页 ── */
  if (page === 'privacy') {
    return (
      <div key="privacy" className={`profile-system pf-page ${pageAnimClass}`}>
        <header className="pf-subbar">
          <button
            type="button"
            className="pf-circle-back"
            aria-label="返回关于应用"
            onClick={() => navigate('about')}
          >
            <Icon name="left" />
          </button>
          <h1 ref={subHeading} tabIndex={-1}>隐私许可</h1>
        </header>

        <section className="pf-card pf-privacy-lead">
          <span className="pf-privacy-badge">
            <Icon name="shield" />
            本地优先 · 开源透明
          </span>
          <h2>科小喵隐私与数据安全许可</h2>
          <p>
            我们尊重每一位河科大同学的隐私权。科小喵以「最小权限、本机存储、直连学校接口」为核心原则设计，以下是完整的数据处理说明。
          </p>
        </section>

        <div className="pf-card pf-privacy-list">
          {privacySections.map((sec) => (
            <article key={sec.title} className="pf-privacy-item">
              <h3>{sec.title}</h3>
              <p>{sec.body}</p>
            </article>
          ))}
        </div>

        <p className="pf-privacy-foot">
          本项目遵循 MIT 开源许可协议 · 代码托管于 GitHub ({repository})
        </p>
      </div>
    )
  }

  /* ── 捐赠支持子页 ── */
  if (page === 'support') {
    const { manifest, hasCache, loading } = sponsorsState
    const sorted = manifest.entries
    const podium = sorted.length >= 3 ? [sorted[1], sorted[0], sorted[2]] : []
    const rest = sorted.length >= 3 ? sorted.slice(3) : sorted
    const showInitialLoading = loading && !hasCache && sorted.length === 0

    return (
      <div key="support" className={`profile-system pf-page ${pageAnimClass}`}>
        <header className="pf-subbar">
          <button
            type="button"
            className="pf-circle-back"
            aria-label="返回关于应用"
            onClick={() => navigate('about')}
          >
            <Icon name="left" />
          </button>
          <h1 ref={subHeading} tabIndex={-1}>捐赠支持</h1>
        </header>

        <section className="pf-card pf-support-note">
          <h2>感谢支持</h2>
          <p>
            科小喵将继续保持简洁、免费开源和无广告打扰。你的赞赏会用于测试设备、应用维护和后续校园新功能适配。捐赠完全自愿，不会影响任何功能使用。
          </p>
        </section>

        <section className="pf-card pf-qr-card" aria-label="开发者赞赏码">
          {REWARD_QR_IMAGE ? (
            <>
              <img className="pf-qr-full-img" src={REWARD_QR_IMAGE} alt="科小喵开发者微信赞赏码" />
              {supportsSaveImageToGallery() ? (
                <div className="pf-qr-action-bar">
                  <button
                    type="button"
                    className={`pf-qr-save-btn${qrSaved ? ' is-saved' : ''}`}
                    disabled={savingQr}
                    onClick={() => void saveQrToGallery()}
                  >
                    <Icon name={qrSaved ? 'check' : 'download'} />
                    <span>{savingQr ? '正在保存到相册…' : qrSaved ? '已保存到系统相册' : '保存赞赏码到相册'}</span>
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="pf-qr-stage">
              <div className="pf-qr-placeholder">
                <img className="pf-qr-placeholder-icon" src={appIconUrl} alt="科小喵" />
                <b>微信赞赏码即将上线</b>
                <small>将采用隐藏实名的微信赞赏码，安全保护双方隐私</small>
              </div>
            </div>
          )}
        </section>

        <section className="pf-card pf-support-note">
          <h2>使用方式</h2>
          <p>
            保存上方微信赞赏码到相册，打开微信「扫一扫」从相册识别即可（微信赞赏码仅展示昵称，安全透明）。谢谢你愿意支持这个小小的校园助手继续变好。
          </p>
        </section>

        {manifest.published ? (
          <section className="pf-card pf-sponsor-card" aria-label="感谢投喂">
            <div className="pf-sponsor-head-row">
              <div className="pf-sponsor-head">
                <h2>{manifest.title}</h2>
                <p>{manifest.subtitle}</p>
              </div>
              <button
                type="button"
                className="pf-sponsor-refresh"
                aria-label="刷新致谢名单"
                disabled={loading}
                onClick={() => void refreshSponsors(true)}
              >
                <Icon name="refresh" className={loading ? 'pf-spin' : undefined} />
              </button>
            </div>

            {podium.length === 3 ? (
              <div className="pf-podium" aria-label="前三名致谢">
                {podium.map((entry, idx) => {
                  const rank = idx === 1 ? 1 : idx === 0 ? 2 : 3
                  return (
                    <div key={`${entry.name}-${rank}`} className={`pf-podium-col rank-${rank}`}>
                      <span className="pf-podium-medal" aria-hidden="true">
                        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                      </span>
                      <b className="pf-podium-name">{entry.name}</b>
                      <span className="pf-podium-amt">¥{entry.amount.toFixed(2)}</span>
                      {entry.note ? (
                        <small className="pf-podium-note" title={entry.note}>“{entry.note}”</small>
                      ) : null}
                      <div className="pf-podium-pillar">{rank}</div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {rest.length > 0 ? (
              <div className="pf-sponsor-list">
                <div className="pf-sponsor-list-head">
                  <span>昵称</span>
                  <span>赞赏金额</span>
                </div>
                {rest.map((entry, idx) => {
                  const meta = [entry.note, entry.date].filter(Boolean).join(' · ')
                  const medal = podium.length === 0 ? (idx === 0 ? '🥇' : idx === 1 ? '🥈' : null) : null
                  return (
                    <div key={`${entry.name}-${idx}`} className="pf-sponsor-row">
                      <span className="pf-sponsor-person-wrap">
                        {medal ? <span className="pf-sponsor-row-medal" aria-hidden="true">{medal}</span> : null}
                        <span className="pf-sponsor-person">
                          <span className="pf-sponsor-person-name">{entry.name}</span>
                          {meta ? <small className="pf-sponsor-person-meta">{meta}</small> : null}
                        </span>
                      </span>
                      <b>¥{entry.amount.toFixed(2)}</b>
                    </div>
                  )
                })}
              </div>
            ) : podium.length === 0 ? (
              <div className="pf-sponsor-empty">
                <span>
                  {showInitialLoading
                    ? '正在同步最新致谢名单…'
                    : '虚位以待，成为第一位投喂科小喵的同学～'}
                </span>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    )
  }

  /* ── 关于应用子页 ── */
  if (page === 'about') {
    return (
      <div key="about" className={`profile-system pf-page ${pageAnimClass}`}>
        <header className="pf-subbar">
          <button
            type="button"
            className="pf-circle-back"
            aria-label="返回设置"
            onClick={() => navigate('root')}
          >
            <Icon name="left" />
          </button>
          <h1 ref={subHeading} tabIndex={-1}>关于应用</h1>
        </header>

        <section className="pf-about-hero" aria-label="应用版本">
          <div className="pf-about-orbs" aria-hidden="true">
            <span className="pf-about-orb pf-about-orb-a" />
            <span className="pf-about-orb pf-about-orb-b" />
          </div>
          <div className="pf-about-hero-copy">
            <h2>科小喵</h2>
            <span className="pf-about-hero-ver">{versionName}</span>
          </div>
          <button
            type="button"
            className="pf-about-pill"
            onClick={() => {
              haptic('light')
              props.onOpenUpdateSettings()
            }}
          >
            <span>{props.hasUpdate ? '发现新版本' : '检查更新'}</span>
            <Icon name="external" />
          </button>
        </section>

        <SettingsGroup rows={[
          {
            title: '项目仓库',
            description: repository,
            tone: 'neutral',
            external: true,
            onClick: openRepository
          },
          {
            title: '当前学期与教学周',
            description: `第 ${props.week} 教学周${props.term ? ` · ${props.term}` : ''}`,
            tone: 'blue'
          }
        ]} />

        <SettingsGroup rows={[
          { title: '隐私许可', tone: 'green', onClick: () => navigate('privacy') },
          { title: '开源许可', value: 'MIT License', tone: 'violet' },
          { title: '支持开发者', tone: 'pink', onClick: () => navigate('support') },
          { title: '软件更新与日志', tone: 'sky', onClick: props.onOpenUpdateSettings }
        ]} />

        <SettingsGroup title="项目致谢" rows={credits} />
      </div>
    )
  }

  /* ── 设置主页面（iOS Inset Grouped 风格） ── */
  return (
    <div key="root" className={`profile-system pf-page ${pageAnimClass}`}>
      <h1 className="pf-title">设置</h1>

      <div className="pf-search" role="search" aria-label="搜索设置项">
        <Icon name="search" />
        <input
          ref={searchInput}
          type="search"
          aria-label="搜索设置项"
          placeholder="搜索设置项"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className={`pf-search-clear${query ? ' visible' : ''}`}
          aria-label="清除搜索"
          tabIndex={query ? 0 : -1}
          onClick={() => {
            haptic('light')
            setQuery('')
            searchInput.current?.focus()
          }}
        >
          <Icon name="close" />
        </button>
      </div>

      {props.syncMessage ? (
        <div className="pf-sync-pill" role="status">
          <Icon name="sync" className={props.refreshing ? 'pf-spin' : undefined} />
          <span>{props.syncMessage}</span>
        </div>
      ) : null}

      {searchActive ? (
        aboutMatches || matchingRows.length ? (
          <section className="pf-card pf-search-results" aria-label="搜索结果">
            {aboutMatches ? <SettingsRow row={aboutRow} buttonRef={aboutTrigger} iosBadge /> : null}
            {matchingRows.map((row) => <SettingsRow key={row.title} row={row} iosBadge />)}
          </section>
        ) : (
          <p className="pf-empty" role="status">没有找到相关设置</p>
        )
      ) : (
        <>
          <button
            ref={aboutTrigger}
            type="button"
            className="pf-card pf-identity"
            onClick={() => navigate('about')}
          >
            <span className="pf-app-icon-img-wrap">
              <img className="pf-app-icon-img" src={appIconUrl} alt="科小喵应用图标" />
            </span>
            <span className="pf-row-copy">
              <span className="pf-app-title">科小喵</span>
              <span className="pf-row-desc">
                版本 {versionName} · {props.hasUpdate ? <strong className="pf-update-accent">发现新版本</strong> : releaseLabel}
              </span>
            </span>
            <Icon name="arrow" className="pf-chevron" />
          </button>

          {groups.map((group, idx) => (
            <SettingsGroup key={group.title || idx} title={group.title} rows={group.rows} iosBadge />
          ))}
        </>
      )}
    </div>
  )
}
