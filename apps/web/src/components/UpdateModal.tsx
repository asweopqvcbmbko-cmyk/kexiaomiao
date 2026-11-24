import { useState } from 'react'
import { Modal } from './ui'
import { haptic } from '../haptics'
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

export function UpdateSettingsModal({
  settings,
  currentVersion,
  checking,
  statusHint,
  hasUpdate,
  onChange,
  onCheckNow,
  onOpenAvailable,
  onClose
}: {
  settings: UpdateSettings
  currentVersion: AppVersionInfo
  checking: boolean
  statusHint: string
  hasUpdate: boolean
  onChange: (next: UpdateSettings) => void
  onCheckNow: () => void
  onOpenAvailable: () => void
  onClose: () => void
}) {
  return (
    <Modal title="自动更新设置" onClose={onClose} label="自动更新设置">
      <div className="update-card">
        <label className="update-switch-row">
          <span className="update-switch-copy">
            <b>自动检查更新</b>
            <small>每天首次打开应用时检查云端新版本</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="update-switch"
            checked={settings.autoCheck}
            onChange={(e) => {
              haptic('light')
              onChange({ ...settings, autoCheck: e.target.checked })
            }}
          />
        </label>

        <label className="update-switch-row">
          <span className="update-switch-copy">
            <b>接收 Beta 版更新</b>
            <small>更新渠道：正式版与 Beta 版；同版本正式版发布后也会提示</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="update-switch"
            checked={settings.includeBeta}
            onChange={(e) => {
              haptic('light')
              onChange({ ...settings, includeBeta: e.target.checked, ignoredVersion: '' })
            }}
          />
        </label>
      </div>

      <div className="update-meta">
        <span>当前版本</span>
        <b>
          v{currentVersion.versionName} ({currentVersion.versionCode})
        </b>
      </div>

      {statusHint ? <p className="update-status-hint" role="status">{statusHint}</p> : null}

      <div className="update-actions">
        {hasUpdate ? (
          <button className="primary" type="button" onClick={onOpenAvailable}>
            查看可用新版本
          </button>
        ) : (
          <button className="primary" type="button" disabled={checking} onClick={onCheckNow}>
            {checking ? '正在检查云端版本…' : '立即检查更新'}
          </button>
        )}
      </div>
    </Modal>
  )
}

export function UpdateAvailableModal({
  currentVersion,
  release,
  onIgnore,
  onClose
}: {
  currentVersion: AppVersionInfo
  release: ReleaseAsset
  onIgnore: (versionName: string) => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'needs_permission' | 'error'>('idle')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [downloadedPath, setDownloadedPath] = useState('')
  const [errMsg, setErrMsg] = useState('')

  const notes = (release.notes || '包含体验优化与问题修复')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  async function startDownload() {
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

  async function handleCancel() {
    if (phase === 'downloading') {
      await cancelActiveDownload()
      setPhase('idle')
      setProgress(null)
    } else {
      onClose()
    }
  }

  async function handleOpenSettings() {
    await openUnknownSourcesSettings()
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

  return (
    <Modal title="发现新版本" onClose={phase === 'downloading' ? handleCancel : onClose} label="发现新版本">
      <div className="update-release-head">
        <span className={`update-channel-pill ${release.channel}`}>
          {release.channel === 'beta' ? 'Beta 测试版' : '正式版'}
        </span>
        <h3>v{release.versionName}</h3>
        <small>
          当前 v{currentVersion.versionName}
          {release.size ? ` · ${formatBytes(release.size)}` : ''}
        </small>
      </div>

      <div className="update-notes">
        {notes.map((line, idx) => (
          <p key={idx}>{line}</p>
        ))}
      </div>

      {phase === 'downloading' && (
        <div className="update-progress" role="status" aria-live="polite">
          <div className="update-progress-row">
            <span>正在下载安装包并校验签名摘要…</span>
            <b>{progress?.percent != null && progress.percent >= 0 ? `${pct}%` : '下载中'}</b>
          </div>
          <div className="update-progress-track">
            <i style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          {progress && progress.totalBytes > 0 ? (
            <small>
              {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
              {progress.mirrorIndex > 0 ? ` · 加速节点 #${progress.mirrorIndex + 1}` : ''}
            </small>
          ) : null}
        </div>
      )}

      {phase === 'needs_permission' && (
        <div className="update-perm-box">
          <p>安装包已下载并校验通过。首次应用内更新需要在系统设置中允许「科小喵」安装未知应用。</p>
          <div className="update-actions">
            <button className="primary" type="button" onClick={() => void handleOpenSettings()}>
              去开启安装权限
            </button>
            <button className="softbtn" type="button" onClick={() => void handleRetryInstall()}>
              我已开启，继续安装
            </button>
          </div>
        </div>
      )}

      {errMsg ? <p className="native-login-error" role="alert">{errMsg}</p> : null}

      {phase !== 'needs_permission' && (
        <div className="update-actions">
          {phase === 'downloading' ? (
            <button className="softbtn" type="button" onClick={() => void handleCancel()}>
              取消下载
            </button>
          ) : (
            <>
              <button className="primary" type="button" onClick={() => void startDownload()}>
                {phase === 'error' ? '重新下载安装' : '立即更新'}
              </button>
              <div className="update-sub-actions">
                <button className="softbtn" type="button" onClick={onClose}>
                  稍后提醒
                </button>
                <button
                  className="softbtn"
                  type="button"
                  onClick={() => {
                    onIgnore(release.versionName)
                    onClose()
                  }}
                >
                  忽略此版本
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
