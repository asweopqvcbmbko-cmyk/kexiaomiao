import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Icon } from '../icons'
import { haptic } from '../haptics'
import appIconUrl from '../assets/app-icon.png'
import {
  cancelActiveDownload,
  downloadAndInstallRelease,
  formatBytes,
  openUnknownSourcesSettings,
  retryInstallApk,
  type AppVersionInfo,
  type DownloadProgress,
  type ReleaseAsset,
  type UpdateSettings
} from '../updater'

export type ImmersiveUpdateStep = 'overview' | 'notes' | 'settings'

export function ImmersiveUpdateView({
  open,
  initialStep = 'overview',
  settings,
  currentVersion,
  release,
  checking,
  statusHint,
  onChangeSettings,
  onCheckNow,
  onIgnore,
  onOpenExternal,
  onClose,
  backHandlerRef
}: {
  open: boolean
  initialStep?: ImmersiveUpdateStep
  settings: UpdateSettings
  currentVersion: AppVersionInfo
  release: ReleaseAsset | null
  checking: boolean
  statusHint: string
  onChangeSettings: (next: UpdateSettings) => void
  onCheckNow: () => void
  onIgnore: (versionName: string) => void
  onOpenExternal?: (url: string) => void
  onClose: () => void
  backHandlerRef?: MutableRefObject<(() => boolean) | null>
}) {
  const [step, setStep] = useState<ImmersiveUpdateStep>(initialStep)
  const [stepDir, setStepDir] = useState<'forward' | 'back'>('forward')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notesExpanded, setNotesExpanded] = useState(true)
  const [closing, setClosing] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'needs_permission' | 'error'>('idle')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [downloadedPath, setDownloadedPath] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const closeTimerRef = useRef<number | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  useEffect(() => {
    if (!open) {
      clearCloseTimer()
      return
    }
    clearCloseTimer()
    setStep(initialStep)
    setStepDir('forward')
    setMenuOpen(false)
    setNotesExpanded(true)
    setClosing(false)
    setErrMsg('')
  }, [open, initialStep, clearCloseTimer])

  const goStep = useCallback((next: ImmersiveUpdateStep, dir: 'forward' | 'back') => {
    haptic('light')
    setMenuOpen(false)
    setStepDir(dir)
    setStep(next)
  }, [])

  const handleBack = useCallback(() => {
    if (closing) return true
    haptic('light')
    if (menuOpen) {
      setMenuOpen(false)
      return true
    }
    if (step !== 'overview') {
      goStep('overview', 'back')
      return true
    }
    if (phase === 'downloading') {
      void cancelActiveDownload()
      setPhase('idle')
      setProgress(null)
    }
    setClosing(true)
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      onClose()
    }, 220)
    return true
  }, [closing, menuOpen, step, goStep, phase, clearCloseTimer, onClose])

  useEffect(() => {
    if (!backHandlerRef) return
    backHandlerRef.current = open ? handleBack : null
    return () => {
      if (backHandlerRef.current === handleBack) backHandlerRef.current = null
    }
  }, [backHandlerRef, open, handleBack])

  if (!open) return null

  const hasUpdate = !!release
  const displayVersion = release ? release.versionName : currentVersion.versionName
  const notes = (release?.notes || '包含体验优化、性能提升与已知问题修复')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)

  async function startDownload() {
    if (!release) return
    haptic('medium')
    setErrMsg('')
    setProgress({ downloadedBytes: 0, totalBytes: release.size || 0, percent: 0, mirrorIndex: 0 })
    setPhase('downloading')
    try {
      const res = await downloadAndInstallRelease(release, (p) => setProgress(p))
      if (res.status === 'cancelled') {
        setPhase('idle')
        setProgress(null)
        return
      }
      if (res.status === 'needs_permission') {
        setDownloadedPath(res.filePath || '')
        setPhase('needs_permission')
        return
      }
      setPhase('idle')
      onClose()
    } catch (e: any) {
      setErrMsg(e?.message || '下载失败，请稍后重试')
      setPhase('error')
    }
  }

  async function handleCancelDownload() {
    haptic('light')
    await cancelActiveDownload()
    setPhase('idle')
    setProgress(null)
  }

  async function handleRetryInstall() {
    if (!downloadedPath) return
    try {
      const res = await retryInstallApk(downloadedPath)
      if (!res.needsPermission) onClose()
    } catch (e: any) {
      setErrMsg(e?.message || '调起安装失败')
      setPhase('error')
    }
  }

  const pct = progress?.percent != null && progress.percent >= 0 ? progress.percent : 0
  const topTitle = step === 'notes' ? '更新说明' : step === 'settings' ? '自动更新设置' : '软件更新'

  const renderPrimaryAction = () => {
    if (phase === 'downloading') {
      return (
        <div className="pf-upd-progress-wrap" role="status" aria-live="polite">
          <div className="pf-upd-progress-meta">
            <span>正在下载并校验安装包…</span>
            <b>{progress?.percent != null && progress.percent >= 0 ? `${pct}%` : '下载中'}</b>
          </div>
          <div className="pf-upd-progress-track">
            <i style={{ width: `${Math.max(5, pct)}%` }} />
          </div>
          <div className="pf-upd-progress-foot">
            <span>
              {progress && progress.totalBytes > 0
                ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                : '正在连接云端镜像…'}
              {progress?.speedBytesPerSec ? ` · ${formatBytes(progress.speedBytesPerSec)}/s` : ''}
            </span>
            <button type="button" className="pf-upd-cancel-link" onClick={() => void handleCancelDownload()}>
              取消
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'needs_permission') {
      return (
        <div className="pf-upd-perm-actions">
          <button type="button" className="pf-upd-cta-white" onClick={() => void openUnknownSourcesSettings()}>
            去开启安装权限
          </button>
          <button type="button" className="pf-upd-cta-glass" onClick={() => void handleRetryInstall()}>
            我已开启，继续安装
          </button>
        </div>
      )
    }

    if (hasUpdate) {
      return (
        <button type="button" className="pf-upd-cta-white" onClick={() => void startDownload()}>
          {phase === 'error' ? '重新下载并安装' : '下载并安装'}
        </button>
      )
    }

    return (
      <button
        type="button"
        className="pf-upd-cta-white"
        disabled={checking}
        onClick={() => {
          haptic('light')
          onCheckNow()
        }}
      >
        {checking ? '正在检查云端版本…' : '立即检查更新'}
      </button>
    )
  }

  return (
    <div
      className={`pf-upd-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={topTitle}
    >
      <div className="pf-upd-backdrop" aria-hidden="true">
        <span className="pf-upd-orb pf-upd-orb-1" />
        <span className="pf-upd-orb pf-upd-orb-2" />
        <span className="pf-upd-orb pf-upd-orb-3" />
      </div>

      <header className="pf-upd-topbar">
        <button type="button" className="pf-glass-circle" aria-label="返回" onClick={handleBack}>
          <Icon name="left" />
        </button>
        <h1 key={topTitle} className="pf-upd-topbar-title">{topTitle}</h1>
        <div className="pf-upd-menu-anchor">
          <button
            type="button"
            className="pf-glass-circle"
            aria-label="更多选项"
            aria-expanded={menuOpen}
            onClick={() => {
              haptic('light')
              setMenuOpen((v) => !v)
            }}
          >
            <span className="pf-dots-vertical" aria-hidden="true"><i /><i /><i /></span>
          </button>
          {menuOpen && (
            <>
              <div className="pf-upd-menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="pf-upd-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => goStep('settings', 'forward')}
                >
                  自动更新设置
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    haptic('light')
                    onCheckNow()
                  }}
                >
                  {checking ? '正在检查更新…' : '立即检查更新'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    const url = 'https://github.com/asweopqvcbmbko-cmyk/kexiaomiao/releases'
                    if (onOpenExternal) onOpenExternal(url)
                    else window.open(url, '_blank', 'noopener,noreferrer')
                  }}
                >
                  历史发布日志
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div key={step} className={`pf-upd-stage dir-${stepDir}`}>
        {step === 'overview' && (
          <div className="pf-upd-overview">
            <div className="pf-upd-brand">
              <div className={`pf-upd-icon-stage${checking ? ' is-checking' : ''}`} aria-hidden="true">
                <span className="pf-upd-ring pf-upd-ring-outer" />
                <span className="pf-upd-ring pf-upd-ring-inner" />
                {checking ? (
                  <>
                    <span className="pf-upd-radar pf-upd-radar-1" />
                    <span className="pf-upd-radar pf-upd-radar-2" />
                  </>
                ) : null}
                <img className="pf-upd-app-icon" src={appIconUrl} alt="" />
              </div>
              <span className="pf-upd-ver">{displayVersion}</span>
              <h2>科小喵</h2>
              <p>
                {hasUpdate
                  ? `${release.channel === 'beta' ? 'Beta 测试版' : '正式版'}${release.size ? ` · ${formatBytes(release.size)}` : ''}`
                  : `当前 v${currentVersion.versionName} (${currentVersion.versionCode})`}
              </p>
            </div>

            <div className="pf-upd-bottom">
              <div className="pf-upd-glass-card">
                <div className="pf-upd-glass-head">
                  <b>{hasUpdate ? '发现新版本' : checking ? '正在检查云端版本…' : '已是最新版本'}</b>
                  {!hasUpdate && !checking && statusHint ? (
                    <span key={statusHint} className={`pf-upd-status-pill${/失败|异常|超时|无法/.test(statusHint) ? ' is-warn' : ''}`}>
                      <Icon name={/失败|异常|超时|无法/.test(statusHint) ? 'warning' : 'check'} />
                      <span>{statusHint}</span>
                    </span>
                  ) : (
                    <small>
                      {hasUpdate
                        ? `v${release.versionName}`
                        : checking
                          ? '正在连接云端发布清单…'
                          : `当前版本 v${currentVersion.versionName}`}
                    </small>
                  )}
                </div>
                {hasUpdate ? (
                  <button
                    type="button"
                    className="pf-upd-cta-glass"
                    onClick={() => goStep('notes', 'forward')}
                  >
                    查看更新说明
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pf-upd-cta-glass"
                    onClick={() => goStep('settings', 'forward')}
                  >
                    更新通道：{settings.includeBeta ? '正式版 + Beta' : '仅正式版'}
                  </button>
                )}
              </div>

              {errMsg ? <p className="pf-upd-error" role="alert">{errMsg}</p> : null}
              {renderPrimaryAction()}
              {hasUpdate && phase === 'idle' ? (
                <button
                  type="button"
                  className="pf-upd-ignore"
                  onClick={() => {
                    haptic('light')
                    onIgnore(release.versionName)
                    onClose()
                  }}
                >
                  忽略此版本提醒
                </button>
              ) : null}
            </div>
          </div>
        )}

        {step === 'notes' && (
          <div className="pf-upd-notes-wrap">
            <div className="pf-upd-notes-card">
              <div className="pf-upd-notes-ver">
                <span>软件版本</span>
                <b>v{displayVersion}</b>
              </div>
              <div className="pf-upd-notes-divider" />
              <button
                type="button"
                className="pf-upd-notes-toggle"
                aria-expanded={notesExpanded}
                onClick={() => {
                  haptic('light')
                  setNotesExpanded((v) => !v)
                }}
              >
                <span>更新说明</span>
                <span className={`pf-upd-notes-arrow${notesExpanded ? ' open' : ''}`} aria-hidden="true">
                  <Icon name="left" />
                </span>
              </button>
              <div className={`pf-upd-notes-collapse${notesExpanded ? ' open' : ''}`}>
                <div className="pf-upd-notes-inner">
                  <ul className="pf-upd-notes-list">
                    {notes.map((line, idx) => (
                      <li key={idx}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="pf-upd-notes-footer">
              {errMsg ? <p className="pf-upd-error" role="alert">{errMsg}</p> : null}
              {renderPrimaryAction()}
            </div>
          </div>
        )}

        {step === 'settings' && (
          <div className="pf-upd-settings-wrap">
            <div className="pf-upd-notes-card">
              <label className="pf-upd-switch-row">
                <span>
                  <b>自动检查更新</b>
                  <small>每天首次打开应用时静默检查云端新版本</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="update-switch"
                  checked={settings.autoCheck}
                  onChange={(e) => {
                    haptic('light')
                    onChangeSettings({ ...settings, autoCheck: e.target.checked })
                  }}
                />
              </label>
              <div className="pf-upd-notes-divider" />
              <label className="pf-upd-switch-row">
                <span>
                  <b>接收 Beta 版更新</b>
                  <small>抢先体验新功能；同版本正式版发布后也会自动提示</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="update-switch"
                  checked={settings.includeBeta}
                  onChange={(e) => {
                    haptic('light')
                    onChangeSettings({ ...settings, includeBeta: e.target.checked, ignoredVersion: '' })
                  }}
                />
              </label>
              <div className="pf-upd-notes-divider" />
              <div className="pf-upd-meta-row">
                <span>当前版本</span>
                <b>v{currentVersion.versionName} ({currentVersion.versionCode})</b>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
