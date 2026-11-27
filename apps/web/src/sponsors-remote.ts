import { Capacitor } from '@capacitor/core'
import { UPDATE_GITHUB_REPO, buildSponsorsUrls, isUpdateRepoConfigured } from './update-config.ts'
import { fetchManifestViaNative } from './updater.ts'

export type SponsorEntry = {
  name: string
  amount: number
  date?: string
  note?: string
  hidden?: boolean
}

export type SponsorsManifest = {
  schemaVersion: number
  published: boolean
  updatedAt?: string
  title: string
  subtitle: string
  entries: SponsorEntry[]
}

export type FetchSponsorsResult = {
  ok: boolean
  manifest: SponsorsManifest
  fromCache: boolean
  sourceUrl?: string
  error?: string
}

export const SPONSORS_CACHE_KEY = 'haust:sponsors_manifest_v1'

export const DEFAULT_SPONSORS_MANIFEST: SponsorsManifest = {
  schemaVersion: 1,
  published: true,
  title: '感谢你的投喂喵～',
  subtitle: '未来也会持续更新优化！',
  entries: []
}

/**
 * 校验并归一化远端或本地缓存的 sponsors.json：
 * - 过滤 hidden === true、空昵称、非正数或非法金额；
 * - 按金额降序排序，同金额严格保持原数组先后顺序；
 * - 缺失标题/副标题时回落到默认文案。
 */
export function normalizeSponsorsManifest(raw: unknown): SponsorsManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.entries)) return null

  const normalizedEntries: Array<{ entry: SponsorEntry; index: number }> = []
  obj.entries.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const rec = item as Record<string, unknown>
    if (rec.hidden === true) return
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    const amount = typeof rec.amount === 'number' ? rec.amount : Number(rec.amount)
    if (!name || !Number.isFinite(amount) || amount <= 0) return

    const date = typeof rec.date === 'string' && rec.date.trim() ? rec.date.trim() : undefined
    const note = typeof rec.note === 'string' && rec.note.trim() ? rec.note.trim() : undefined
    normalizedEntries.push({
      index,
      entry: {
        name,
        amount: Math.round(amount * 100) / 100,
        ...(date ? { date } : {}),
        ...(note ? { note } : {})
      }
    })
  })

  normalizedEntries.sort((a, b) => {
    if (b.entry.amount !== a.entry.amount) return b.entry.amount - a.entry.amount
    return a.index - b.index
  })

  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : DEFAULT_SPONSORS_MANIFEST.title
  const subtitle =
    typeof obj.subtitle === 'string' && obj.subtitle.trim()
      ? obj.subtitle.trim()
      : DEFAULT_SPONSORS_MANIFEST.subtitle
  const updatedAt =
    typeof obj.updatedAt === 'string' && obj.updatedAt.trim() ? obj.updatedAt.trim() : undefined
  const schemaVersion =
    typeof obj.schemaVersion === 'number' && Number.isFinite(obj.schemaVersion)
      ? obj.schemaVersion
      : 1

  return {
    schemaVersion,
    published: obj.published !== false,
    ...(updatedAt ? { updatedAt } : {}),
    title,
    subtitle,
    entries: normalizedEntries.map((item) => item.entry)
  }
}

export function readCachedSponsors(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null
): SponsorsManifest | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(SPONSORS_CACHE_KEY)
    if (!raw) return null
    return normalizeSponsorsManifest(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeCachedSponsors(
  manifest: SponsorsManifest,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null
): void {
  if (!storage) return
  try {
    storage.setItem(SPONSORS_CACHE_KEY, JSON.stringify(manifest))
  } catch {
    /* ignore storage quota error */
  }
}

async function fetchJsonViaBrowser(urls: string[], timeoutMs = 6000): Promise<{ body: string; url: string }> {
  let lastError = '网络请求失败'
  for (const url of urls) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const resp = await fetch(url, {
        cache: 'no-store',
        signal: controller?.signal
      })
      if (!resp.ok) {
        lastError = `HTTP ${resp.status}`
        continue
      }
      const body = await resp.text()
      return { body, url }
    } catch (err: any) {
      lastError = err?.name === 'AbortError' ? '请求超时' : String(err?.message || '网络异常')
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }
  throw new Error(lastError)
}

export async function fetchRemoteSponsors(options?: {
  repo?: string
  fallback?: SponsorsManifest
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  fetcher?: (urls: string[]) => Promise<{ body: string; url: string }>
}): Promise<FetchSponsorsResult> {
  const storage = options?.storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : options.storage
  const cached = readCachedSponsors(storage)
  const fallback = options?.fallback ?? DEFAULT_SPONSORS_MANIFEST
  const repo = options?.repo ?? UPDATE_GITHUB_REPO

  if (!isUpdateRepoConfigured(repo)) {
    return {
      ok: false,
      manifest: cached ?? fallback,
      fromCache: Boolean(cached),
      error: '未配置云端仓库'
    }
  }

  const urls = buildSponsorsUrls(repo)
  try {
    const res = options?.fetcher
      ? await options.fetcher(urls)
      : Capacitor.isNativePlatform()
        ? await fetchManifestViaNative(urls)
        : await fetchJsonViaBrowser(urls)

    const parsed = normalizeSponsorsManifest(JSON.parse(res.body))
    if (!parsed) {
      throw new Error('赞助名单格式无效')
    }
    writeCachedSponsors(parsed, storage)
    return {
      ok: true,
      manifest: parsed,
      fromCache: false,
      sourceUrl: res.url
    }
  } catch (err: any) {
    return {
      ok: false,
      manifest: cached ?? fallback,
      fromCache: Boolean(cached),
      error: err?.message || '同步失败'
    }
  }
}
