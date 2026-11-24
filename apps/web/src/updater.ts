import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  UPDATE_GITHUB_REPO,
  buildApkDownloadUrls,
  buildManifestUrls,
  isUpdateRepoConfigured
} from './update-config.ts'

export type UpdateChannel = 'stable' | 'beta'

export type ReleaseAsset = {
  versionCode: number
  versionName: string
  channel: UpdateChannel
  apkUrl: string
  sha256: string
  size?: number
  notes: string
  publishedAt?: string
  mirrors?: string[]
  minAndroidSdk?: number
}

export type UpdateManifest = {
  schemaVersion?: number
  updatedAt?: string
  stable?: ReleaseAsset | null
  beta?: ReleaseAsset | null
}

export type AppVersionInfo = {
  versionCode: number
  versionName: string
  packageName?: string
}

export type UpdateSettings = {
  autoCheck: boolean
  includeBeta: boolean
  lastAutoCheckDay: string
  ignoredVersion: string
}

export type DownloadProgress = {
  downloadedBytes: number
  totalBytes: number
  percent: number
  mirrorIndex: number
  speedBytesPerSec?: number
}

export type UpdateCheckResult =
  | { status: 'available'; current: AppVersionInfo; release: ReleaseAsset; sourceUrl?: string }
  | { status: 'up_to_date'; current: AppVersionInfo; sourceUrl?: string }
  | { status: 'unconfigured'; current: AppVersionInfo; message: string }
  | { status: 'unsupported'; current: AppVersionInfo; message: string }
  | { status: 'error'; current: AppVersionInfo; message: string }

const SETTINGS_KEY = 'haust:update_settings_v1'

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  autoCheck: true,
  includeBeta: false,
  lastAutoCheckDay: '',
  ignoredVersion: ''
}

type AppUpdaterNativePlugin = {
  getAppVersion(): Promise<AppVersionInfo>
  fetchManifest(o: { urls: string[] }): Promise<{ body: string; url: string }>
  downloadAndVerify(o: {
    urls: string[]
    sha256?: string
    filename?: string
  }): Promise<{ filePath: string; sha256: string; size: number; url: string }>
  cancelDownload(): Promise<{ cancelled: boolean }>
  canRequestPackageInstalls(): Promise<{ allowed: boolean }>
  openInstallSettings(): Promise<{ opened: boolean }>
  installApk(o: { filePath: string }): Promise<{ launched: boolean; needsPermission: boolean }>
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (data: DownloadProgress) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const AppUpdaterNative = registerPlugin<AppUpdaterNativePlugin>('AppUpdater')

/* ---------------- 纯函数：SemVer + Beta 渠道比较 ---------------- */

type ParsedSemver = {
  major: number
  minor: number
  patch: number
  pre: Array<number | string>
}

export function parseSemver(version: string): ParsedSemver | null {
  const clean = (version || '').trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(clean)
  if (!match) return null
  const pre = match[4]
    ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()))
    : []
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre
  }
}

/**
 * 标准 SemVer 比较：返回 >0 表示 a > b，<0 表示 a < b，0 表示相等。
 * 关键特性：正式版 > 同版本号的 Beta 预发布版（例如 0.2.0 > 0.2.0-beta.2 > 0.2.0-beta.1）。
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return a.localeCompare(b)
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1 // 正式版 > 同版本预发布版
  if (pb.pre.length === 0) return -1
  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const xa = pa.pre[i]
    const xb = pb.pre[i]
    if (xa === undefined) return -1
    if (xb === undefined) return 1
    if (xa === xb) continue
    if (typeof xa === 'number' && typeof xb === 'number') return xa - xb
    if (typeof xa === 'number') return -1
    if (typeof xb === 'number') return 1
    return xa < xb ? -1 : 1
  }
  return 0
}

export function isNewerRelease(candidate: Pick<ReleaseAsset, 'versionCode' | 'versionName'>, current: AppVersionInfo): boolean {
  const semverDiff = compareSemver(candidate.versionName, current.versionName)
  if (semverDiff !== 0) return semverDiff > 0
  return Number(candidate.versionCode || 0) > Number(current.versionCode || 0)
}

/**
 * 按渠道策略挑选最优可更新包：
 * - 关闭 Beta：只检查 stable
 * - 开启 Beta：在 stable 与 beta 中选版本更高的（同版本时 stable 优先于 beta）
 */
export function pickBestRelease(
  manifest: UpdateManifest | null | undefined,
  current: AppVersionInfo,
  includeBeta: boolean
): ReleaseAsset | null {
  if (!manifest) return null
  const candidates: ReleaseAsset[] = []
  if (manifest.stable && manifest.stable.apkUrl) {
    candidates.push({ ...manifest.stable, channel: 'stable' })
  }
  if (includeBeta && manifest.beta && manifest.beta.apkUrl) {
    candidates.push({ ...manifest.beta, channel: 'beta' })
  }
  const newer = candidates.filter((item) => isNewerRelease(item, current))
  if (!newer.length) return null
  newer.sort((a, b) => {
    const cmp = compareSemver(b.versionName, a.versionName)
    if (cmp !== 0) return cmp
    if (a.channel !== b.channel) return a.channel === 'stable' ? -1 : 1
    return (b.versionCode || 0) - (a.versionCode || 0)
  })
  return newer[0]
}

export function localDayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function shouldAutoCheckToday(settings: UpdateSettings, date = new Date()): boolean {
  if (!settings.autoCheck) return false
  return settings.lastAutoCheckDay !== localDayKey(date)
}

export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* ---------------- 设置持久化 ---------------- */

export function readUpdateSettings(storage: Pick<Storage, 'getItem'> = localStorage): UpdateSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_UPDATE_SETTINGS }
    const parsed = JSON.parse(raw)
    return {
      autoCheck: parsed?.autoCheck !== false,
      includeBeta: parsed?.includeBeta === true,
      lastAutoCheckDay: typeof parsed?.lastAutoCheckDay === 'string' ? parsed.lastAutoCheckDay : '',
      ignoredVersion: typeof parsed?.ignoredVersion === 'string' ? parsed.ignoredVersion : ''
    }
  } catch {
    return { ...DEFAULT_UPDATE_SETTINGS }
  }
}

export function writeUpdateSettings(
  next: UpdateSettings,
  storage: Pick<Storage, 'setItem'> = localStorage
): UpdateSettings {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    /* ignore storage error */
  }
  return next
}

/* ---------------- 运行时原生桥接与预览降级 ---------------- */

function isPreviewMode(): boolean {
  try {
    return typeof window !== 'undefined' && /\bpreview=1\b/.test(window.location.search)
  } catch {
    return false
  }
}

export function supportsAppUpdater(): boolean {
  return Capacitor.isNativePlatform() || isPreviewMode()
}

export async function getCurrentAppVersion(): Promise<AppVersionInfo> {
  if (Capacitor.isNativePlatform()) {
    try {
      return await AppUpdaterNative.getAppVersion()
    } catch {
      /* fallback */
    }
  }
  return { versionCode: 11, versionName: '0.1.10', packageName: 'cn.edu.haust.campusassistant' }
}

export async function checkForAppUpdate(options: { includeBeta: boolean; repo?: string }): Promise<UpdateCheckResult> {
  const current = await getCurrentAppVersion()

  if (isPreviewMode() && !Capacitor.isNativePlatform()) {
    await new Promise((r) => setTimeout(r, 420))
    const demoRelease: ReleaseAsset = options.includeBeta
      ? {
          versionCode: current.versionCode + 1,
          versionName: '0.2.0-beta.1',
          channel: 'beta',
          apkUrl: 'https://github.com/example/kexiaomiao-releases/releases/download/v0.2.0-beta.1/kexiaomiao.apk',
          sha256: 'preview-sha256',
          size: 4_520_000,
          publishedAt: new Date().toISOString(),
          notes: '1. 新增云端自动更新与正式版/Beta 渠道切换\n2. 修复学习通静默登录与双层认证动效\n3. 优化仪表盘视觉层次与倒计时徽章'
        }
      : {
          versionCode: current.versionCode + 1,
          versionName: '0.2.0',
          channel: 'stable',
          apkUrl: 'https://github.com/example/kexiaomiao-releases/releases/download/v0.2.0/kexiaomiao.apk',
          sha256: 'preview-sha256',
          size: 4_480_000,
          publishedAt: new Date().toISOString(),
          notes: '1. 正式版云端更新支持应用内下载与一键覆盖安装\n2. 统一原生登录体验与学习通三模式登录'
        }
    return { status: 'available', current, release: demoRelease, sourceUrl: 'preview://manifest' }
  }

  if (!Capacitor.isNativePlatform()) {
    return { status: 'unsupported', current, message: '仅 Android 客户端支持应用内自动更新' }
  }

  const repo = options.repo || UPDATE_GITHUB_REPO
  if (!isUpdateRepoConfigured(repo)) {
    return {
      status: 'unconfigured',
      current,
      message: '尚未配置云端分发仓库，请先在 update-config.ts 填入你的 GitHub 公开仓库（owner/repo）'
    }
  }

  try {
    const urls = buildManifestUrls(repo)
    const { body, url } = await AppUpdaterNative.fetchManifest({ urls })
    const manifest = JSON.parse(body) as UpdateManifest
    const best = pickBestRelease(manifest, current, options.includeBeta)
    if (!best) return { status: 'up_to_date', current, sourceUrl: url }
    return { status: 'available', current, release: best, sourceUrl: url }
  } catch (e: any) {
    return { status: 'error', current, message: e?.message || '检查更新失败，请检查网络后重试' }
  }
}

export async function downloadAndInstallRelease(
  release: ReleaseAsset,
  onProgress: (p: DownloadProgress) => void
): Promise<{ status: 'installed' | 'needs_permission' | 'cancelled'; filePath?: string }> {
  if (isPreviewMode() && !Capacitor.isNativePlatform()) {
    const total = release.size || 4_500_000
    for (let pct = 10; pct <= 100; pct += 15) {
      await new Promise((r) => setTimeout(r, 140))
      onProgress({ downloadedBytes: Math.round((total * Math.min(pct, 100)) / 100), totalBytes: total, percent: Math.min(pct, 100), mirrorIndex: 0 })
    }
    return { status: 'installed', filePath: 'preview://update.apk' }
  }

  const urls = buildApkDownloadUrls(release.apkUrl, release.mirrors)
  const listener = await AppUpdaterNative.addListener('downloadProgress', onProgress)
  try {
    const filename = `kexiaomiao-${release.versionName}.apk`
    const downloaded = await AppUpdaterNative.downloadAndVerify({
      urls,
      sha256: release.sha256,
      filename
    })
    const installRes = await AppUpdaterNative.installApk({ filePath: downloaded.filePath })
    if (installRes.needsPermission) {
      return { status: 'needs_permission', filePath: downloaded.filePath }
    }
    return { status: 'installed', filePath: downloaded.filePath }
  } catch (e: any) {
    if (String(e?.message || '').includes('CANCELLED')) {
      return { status: 'cancelled' }
    }
    throw e
  } finally {
    await listener.remove().catch(() => {})
  }
}

export async function cancelActiveDownload(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await AppUpdaterNative.cancelDownload().catch(() => {})
}

export async function openUnknownSourcesSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await AppUpdaterNative.openInstallSettings().catch(() => {})
}

export async function retryInstallApk(filePath: string): Promise<{ launched: boolean; needsPermission: boolean }> {
  if (!Capacitor.isNativePlatform()) return { launched: true, needsPermission: false }
  return AppUpdaterNative.installApk({ filePath })
}
