/**
 * 通知模块纯端侧 IndexedDB 持久化存储层 + 双网 ID 归一化 + 第 1 页增量截断逻辑。
 * - 按设备持久化（切换账号/登出不清空），保留最近 300 条元数据及对应按需缓存的正文。
 * - 剥离校园网直连与 WebVPN 代理域名差异，生成稳定主键（如 jwc:1024_5678）。
 */
import type { NoticeBody, NoticeItem } from './types'

export const NOTICE_DB_NAME = 'haust_notices_v1'
export const NOTICE_DB_VERSION = 1
export const NOTICE_MAX_ITEMS = 300

export class WebVpnAuthError extends Error {
  readonly code = 'WEBVPN_AUTH_REQUIRED'
  constructor(message = '校园网认证已过期，当前显示离线缓存') {
    super(message)
    this.name = 'WebVpnAuthError'
  }
}

const WEBVPN_HOST_RE = /^([a-z0-9-]+)-haust-edu-cn-s\.haust\.edu\.cn$/i

/** 将 WebVPN 代理 URL 还原为校园网规范直连 URL（仅用于稳定主键提取） */
export function stripWebVpnPrefix(rawUrl: string): string {
  const input = String(rawUrl || '').trim()
  if (!input) return ''
  try {
    const u = new URL(input)
    const m = WEBVPN_HOST_RE.exec(u.hostname.toLowerCase())
    if (m) {
      u.hostname = `${m[1].replace(/-/g, '.')}.haust.edu.cn`
    }
    u.protocol = 'https:'
    u.hash = ''
    return u.toString()
  } catch (_) {
    return input
  }
}

function stableHash(str: string): string {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/**
 * 双网 ID 归一化：剥离校内直连与 WebVPN 代理前缀，提取稳定主键。
 * 例：
 *  - jwc + https://jwc-haust-edu-cn-s.haust.edu.cn/info/1024/5678.htm → jwc:1024_5678
 *  - jwc + https://jwc.haust.edu.cn/content.jsp?wbtreeid=1024&wbnewsid=5678 → jwc:1024_5678
 *  - cl  + https://cl.haust.edu.cn/info/1204/9012.htm → cl:1204_9012
 *  - school / news + id=88421 → school:88421
 */
export function normalizeNoticeKey(item: Pick<NoticeItem, 'source' | 'id' | 'url' | 'title'>): string {
  const source = String(item.source || 'school').toLowerCase()
  const canonicalUrl = stripWebVpnPrefix(item.url || '')

  if (canonicalUrl) {
    // 1) CMS 静态路径：/info/<treeId>/<newsId>.htm
    const infoMatch = /\/info\/(\d+)\/(\d+)\.htm/i.exec(canonicalUrl)
    if (infoMatch) {
      return `${source}:${infoMatch[1]}_${infoMatch[2]}`
    }
    // 2) 动态参数：wbtreeid + wbnewsid
    try {
      const u = new URL(canonicalUrl)
      const treeId = u.searchParams.get('wbtreeid') || ''
      const newsId = u.searchParams.get('wbnewsid') || ''
      if (treeId && newsId) return `${source}:${treeId}_${newsId}`
      if (newsId) return `${source}:${newsId}`
    } catch (_) {}
  }

  const rawId = String(item.id || '').trim()
  if (rawId) {
    const cleanId = rawId.replace(/^https?:\/\/[^/]+/i, '').replace(/[^\w-]/g, '')
    if (cleanId) return `${source}:${cleanId}`
  }

  if (canonicalUrl) {
    try {
      const u = new URL(canonicalUrl)
      return `${source}:u_${stableHash(`${u.hostname}${u.pathname}${u.search}`)}`
    } catch (_) {
      return `${source}:u_${stableHash(canonicalUrl)}`
    }
  }

  return `${source}:t_${stableHash(String(item.title || ''))}`
}

/** 归一化后的 id（不含 source: 前缀，兼容界面 `${n.source}:${n.id}` 拼接键） */
export function normalizeNoticeId(item: Pick<NoticeItem, 'source' | 'id' | 'url' | 'title'>): string {
  const full = normalizeNoticeKey(item)
  const prefix = `${String(item.source || 'school').toLowerCase()}:`
  return full.startsWith(prefix) ? full.slice(prefix.length) : full
}

export function normalizeNoticeItem<T extends NoticeItem>(item: T): T {
  return {
    ...item,
    id: normalizeNoticeId(item)
  }
}

export type IncrementalPlanResult<T extends NoticeItem> = {
  newItems: T[]
  hitExisting: boolean
  pagesProcessed: number
}

/**
 * 纯函数增量截断合并器（供抓取器与离线单测共用）：
 * - 首次建库（existingKeys 为空）：最多处理前 maxInitialPages（默认 3）页。
 * - 日常刷新（existingKeys 非空）：仅处理第 1 页；遍历完整页用内存 Set 过滤（防止顶部历史置顶导致误截断），
 *   只要本页命中任意已缓存主键即标记 hitExisting 并停止翻页。
 */
export function collectIncrementalPages<T extends NoticeItem>(
  pages: T[][],
  existingKeys: Set<string>,
  maxInitialPages = 3
): IncrementalPlanResult<T> {
  const isInitial = existingKeys.size === 0
  const limit = isInitial ? Math.max(1, maxInitialPages) : 1
  const seen = new Set<string>(existingKeys)
  const newItems: T[] = []
  let hitExisting = false
  let pagesProcessed = 0

  for (let i = 0; i < Math.min(pages.length, limit); i++) {
    const page = pages[i] || []
    pagesProcessed += 1
    let pageHit = false
    for (const raw of page) {
      const item = normalizeNoticeItem(raw)
      const key = `${item.source}:${item.id}`
      if (existingKeys.has(key)) {
        pageHit = true
        continue
      }
      if (seen.has(key)) continue
      seen.add(key)
      newItems.push(item)
    }
    if (pageHit) {
      hitExisting = true
      break
    }
  }

  return { newItems, hitExisting, pagesProcessed }
}

type StoredNotice = NoticeItem & {
  key: string
  mirrorUrl?: string
  cachedAt: number
}

type StoredBody = {
  key: string
  body: NoticeBody
  cachedAt: number
}

// ── IndexedDB 封装（带无 IDB 环境的内存降级） ─────────────────────────────

const memNotices = new Map<string, StoredNotice>()
const memBodies = new Map<string, StoredBody>()
let dbPromise: Promise<IDBDatabase | null> | null = null

function openNoticeDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(NOTICE_DB_NAME, NOTICE_DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('notices')) {
          const store = db.createObjectStore('notices', { keyPath: 'key' })
          store.createIndex('date', 'date', { unique: false })
        }
        if (!db.objectStoreNames.contains('bodies')) {
          db.createObjectStore('bodies', { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch (_) {
      resolve(null)
    }
  })
  return dbPromise
}

function sortNoticesDesc<T extends { date?: string; cachedAt?: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const cmp = String(b.date || '').localeCompare(String(a.date || ''))
    if (cmp !== 0) return cmp
    return (b.cachedAt || 0) - (a.cachedAt || 0)
  })
}

export async function getAllNotices(): Promise<NoticeItem[]> {
  const db = await openNoticeDb()
  if (!db) {
    return sortNoticesDesc(Array.from(memNotices.values()))
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('notices', 'readonly')
      const req = tx.objectStore('notices').getAll()
      req.onsuccess = () => resolve(sortNoticesDesc((req.result as StoredNotice[]) || []))
      req.onerror = () => resolve([])
    } catch (_) {
      resolve([])
    }
  })
}

export async function getAllNoticeKeys(): Promise<Set<string>> {
  const items = await getAllNotices()
  return new Set(items.map((n) => `${n.source}:${n.id}`))
}

export async function upsertNotices(items: NoticeItem[], maxItems = NOTICE_MAX_ITEMS): Promise<NoticeItem[]> {
  const now = Date.now()
  const normalized: StoredNotice[] = items.map((raw) => {
    const item = normalizeNoticeItem(raw)
    return {
      ...item,
      key: `${item.source}:${item.id}`,
      cachedAt: now
    }
  })

  const db = await openNoticeDb()
  if (!db) {
    for (const row of normalized) {
      const prev = memNotices.get(row.key)
      memNotices.set(row.key, prev ? { ...prev, ...row, cachedAt: prev.cachedAt || now } : row)
    }
    const sorted = sortNoticesDesc(Array.from(memNotices.values()))
    if (sorted.length > maxItems) {
      for (const dropped of sorted.slice(maxItems)) {
        memNotices.delete(dropped.key)
        memBodies.delete(dropped.key)
      }
    }
    return sorted.slice(0, maxItems)
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(['notices', 'bodies'], 'readwrite')
      const noticeStore = tx.objectStore('notices')
      const bodyStore = tx.objectStore('bodies')

      for (const row of normalized) {
        noticeStore.put(row)
      }

      const getAllReq = noticeStore.getAll()
      getAllReq.onsuccess = () => {
        const all = sortNoticesDesc((getAllReq.result as StoredNotice[]) || [])
        if (all.length > maxItems) {
          for (const dropped of all.slice(maxItems)) {
            noticeStore.delete(dropped.key)
            bodyStore.delete(dropped.key)
          }
        }
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch (_) {
      resolve()
    }
  })

  return getAllNotices()
}

export async function getCachedNoticeBody(item: Pick<NoticeItem, 'source' | 'id' | 'url' | 'title'>): Promise<NoticeBody | null> {
  const key = normalizeNoticeKey(item)
  const db = await openNoticeDb()
  if (!db) {
    return memBodies.get(key)?.body ?? null
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('bodies', 'readonly')
      const req = tx.objectStore('bodies').get(key)
      req.onsuccess = () => resolve((req.result as StoredBody | undefined)?.body ?? null)
      req.onerror = () => resolve(null)
    } catch (_) {
      resolve(null)
    }
  })
}

export async function saveNoticeBody(
  item: Pick<NoticeItem, 'source' | 'id' | 'url' | 'title'>,
  body: NoticeBody
): Promise<void> {
  if (!body || body.failure || (!body.text && !body.imgs?.length && !body.attachments?.length)) return
  const key = normalizeNoticeKey(item)
  const record: StoredBody = { key, body, cachedAt: Date.now() }
  const db = await openNoticeDb()
  if (!db) {
    memBodies.set(key, record)
    return
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction('bodies', 'readwrite')
      tx.objectStore('bodies').put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch (_) {
      resolve()
    }
  })
}

export async function getCachedBodyKeys(): Promise<Set<string>> {
  const db = await openNoticeDb()
  if (!db) return new Set(memBodies.keys())
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('bodies', 'readonly')
      const req = tx.objectStore('bodies').getAllKeys()
      req.onsuccess = () => resolve(new Set((req.result as string[]) || []))
      req.onerror = () => resolve(new Set())
    } catch (_) {
      resolve(new Set())
    }
  })
}
