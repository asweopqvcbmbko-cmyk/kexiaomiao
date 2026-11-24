/**
 * 云端更新源集中配置（独立 GitHub 公开分发仓库，仅放 APK 与 update-manifest.json，不公开源码）。
 *
 * 建好公开分发仓库后，把下面的 OWNER/REPO 改成你的仓库名（或通过构建环境变量 VITE_UPDATE_REPO 注入）即可生效。
 */
const ENV_REPO =
  typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_UPDATE_REPO
    ? String((import.meta as any).env.VITE_UPDATE_REPO).trim()
    : ''

export const UPDATE_GITHUB_REPO = ENV_REPO || 'asweopqvcbmbko-cmyk/kexiaomiao'
export const UPDATE_MANIFEST_BRANCH = 'main'
export const UPDATE_MANIFEST_FILE = 'update-manifest.json'

/** 国内 GitHub 加速代理前缀（按优先级依次回退，最后回退到 GitHub 直连） */
export const GITHUB_MIRROR_PREFIXES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/'
] as const

export function isUpdateRepoConfigured(repo = UPDATE_GITHUB_REPO): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && !repo.startsWith('YOUR_GITHUB_USER/')
}

/** 生成版本清单（update-manifest.json）的多路加速 + 直连候选地址（优先实时源并带防缓存参数，jsDelivr 仅作最后兜底） */
export function buildManifestUrls(
  repo = UPDATE_GITHUB_REPO,
  branch = UPDATE_MANIFEST_BRANCH,
  cacheBuster = Date.now()
): string[] {
  const rawGithub = `https://raw.githubusercontent.com/${repo}/${branch}/${UPDATE_MANIFEST_FILE}`
  const bustedRaw = `${rawGithub}?t=${cacheBuster}`
  const jsdelivr = `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${UPDATE_MANIFEST_FILE}`
  const urls: string[] = [
    ...GITHUB_MIRROR_PREFIXES.map((prefix) => `${prefix}${bustedRaw}`),
    bustedRaw,
    jsdelivr
  ]
  return [...new Set(urls)]
}

/** 为 APK 下载直链生成多路加速 + 原链回退列表 */
export function buildApkDownloadUrls(apkUrl: string, extraMirrors: string[] = []): string[] {
  const clean = (apkUrl || '').trim()
  if (!clean.startsWith('https://')) return []
  const urls: string[] = []
  for (const m of extraMirrors) {
    if (typeof m === 'string' && m.trim().startsWith('https://')) urls.push(m.trim())
  }
  const isGithub = /^https:\/\/(?:github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//i.test(clean)
  if (isGithub) {
    for (const prefix of GITHUB_MIRROR_PREFIXES) {
      urls.push(`${prefix}${clean}`)
    }
  }
  urls.push(clean)
  return [...new Set(urls)]
}
