/**
 * 冷启动同步状态判定、首帧快照持久化与 SWR 数据指纹比对。
 * 保证首次安装首帧直出引导页（零闪烁），已有快照冷启动首帧直出上次界面。
 */
import type { CardInfo, ChaoxingDashboard, ChargerData, CourseTable, Exam, NoticeItem, SessionStatus } from './types'
import type { AirconElectricityResult, AirconRoom } from './types/aircon-electricity'

export type AppTab = 'home' | 'dashboard' | 'notices' | 'profile'
export type CardKey = 'focus' | 'exam' | 'notices' | 'aircon' | 'chargers' | 'card'

export const ONBOARDING_VERSION_KEY = 'haust:onboarding_v1'
export const DEMO_MODE_KEY = 'haust:demo_mode'
export const DEMO_TIP_KEY = 'haust:demo_tip_v1'
export const UI_STATE_KEY = 'haust:ui_state_v1'
export const HOME_SNAPSHOT_KEY = 'haust:home_snapshot_v1'

/** 分层静默刷新冷却：高频资源 10 分钟，低频教务资源 6 小时 */
export const SWR_FAST_TTL_MS = 10 * 60 * 1000
export const SWR_SLOW_TTL_MS = 6 * 60 * 60 * 1000

export type SyncTimes = {
  academic: number
  notices: number
  card: number
  chargers: number
  aircon: number
}

export type HomeSnapshot = {
  status: SessionStatus | null
  table: CourseTable | null
  exams: Exam[]
  notices: NoticeItem[]
  chargers: ChargerData | null
  card: CardInfo | null
  airconRoom: AirconRoom | null
  airconResult: AirconElectricityResult | null
  lastSync: string
  syncTimes: SyncTimes
}

export type BootState = {
  showOnboarding: boolean
  demoMode: boolean
  showDemoTip: boolean
  savedTab: AppTab
  snapshot: HomeSnapshot | null
}

const VALID_TABS: AppTab[] = ['home', 'dashboard', 'notices', 'profile']

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch (_) {
    return fallback
  }
}

function safeWriteJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (_) {}
}

/** 检测本机是否已有真实老用户数据（升级兼容：老用户不反复弹首次引导） */
export function hasExistingUserConfig(): boolean {
  try {
    if (localStorage.getItem('haust.aircon.room')) return true
    if (localStorage.getItem('haust-kxm-onboarded') === 'true') return true
    const cachedSession = safeReadJson<{ loggedIn?: boolean } | null>('haust.cache.v1.session', null)
    if (cachedSession?.loggedIn) return true
    const cachedCourses = safeReadJson<{ courses?: unknown[] } | null>('haust.cache.v1.courses', null)
    if (Array.isArray(cachedCourses?.courses) && cachedCourses.courses.length > 0) return true
    const snap = safeReadJson<HomeSnapshot | null>(HOME_SNAPSHOT_KEY, null)
    if (snap?.status?.loggedIn || snap?.airconRoom?.roomVerify) return true
  } catch (_) {}
  return false
}

export function readHomeSnapshot(): HomeSnapshot | null {
  const snap = safeReadJson<HomeSnapshot | null>(HOME_SNAPSHOT_KEY, null)
  if (!snap || typeof snap !== 'object') return null
  return {
    status: snap.status ?? null,
    table: snap.table ?? null,
    exams: Array.isArray(snap.exams) ? snap.exams : [],
    notices: Array.isArray(snap.notices) ? snap.notices : [],
    chargers: snap.chargers ?? null,
    card: snap.card ?? null,
    airconRoom: snap.airconRoom ?? null,
    airconResult: snap.airconResult ?? null,
    lastSync: typeof snap.lastSync === 'string' ? snap.lastSync : '',
    syncTimes: {
      academic: Number(snap.syncTimes?.academic) || 0,
      notices: Number(snap.syncTimes?.notices) || 0,
      card: Number(snap.syncTimes?.card) || 0,
      chargers: Number(snap.syncTimes?.chargers) || 0,
      aircon: Number(snap.syncTimes?.aircon) || 0
    }
  }
}

export function writeHomeSnapshot(snapshot: HomeSnapshot) {
  safeWriteJson(HOME_SNAPSHOT_KEY, snapshot)
}

export function clearHomeSnapshot() {
  try {
    localStorage.removeItem(HOME_SNAPSHOT_KEY)
  } catch (_) {}
}

export function readChaoxingSnapshot(): ChaoxingDashboard | null {
  // Android's successful fetch cache also supplies the first dashboard render.
  const snapshot = safeReadJson<ChaoxingDashboard | null>('haust.cache.v1.chaoxing', null)
  if (!snapshot?.loggedIn || !Array.isArray(snapshot.works) || !Array.isArray(snapshot.exams)) return null
  return { ...snapshot, stale: true }
}

export function readSavedTab(): AppTab {
  const ui = safeReadJson<{ tab?: string } | null>(UI_STATE_KEY, null)
  if (ui?.tab === 'schedule') return 'dashboard'
  if (ui?.tab && VALID_TABS.includes(ui.tab as AppTab)) return ui.tab as AppTab
  return 'home'
}

export function writeSavedTab(tab: AppTab) {
  safeWriteJson(UI_STATE_KEY, { tab })
}

export function markOnboardingCompleted() {
  try {
    localStorage.setItem(ONBOARDING_VERSION_KEY, '1')
  } catch (_) {}
}

export function setDemoModeFlag(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(DEMO_MODE_KEY, '1')
    else localStorage.removeItem(DEMO_MODE_KEY)
  } catch (_) {}
}

export function dismissDemoTipFlag() {
  try {
    localStorage.setItem(DEMO_TIP_KEY, '1')
  } catch (_) {}
}

/**
 * 同步读取冷启动初始状态（在 App 首个 useState 惰性初始化器中调用，杜绝首帧闪烁）。
 * 判定顺序：URL preview → hasCompletedOnboarding / hasExistingUserConfig → demoMode → snapshot。
 */
export function readBootState(): BootState {
  const isDevPreview =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('preview') === '1'
  if (isDevPreview) {
    return {
      showOnboarding: false,
      demoMode: false,
      showDemoTip: false,
      savedTab: 'home',
      snapshot: null
    }
  }

  let completed = false
  let demoMode = false
  let tipDismissed = false
  try {
    completed = localStorage.getItem(ONBOARDING_VERSION_KEY) === '1'
    demoMode = localStorage.getItem(DEMO_MODE_KEY) === '1'
    tipDismissed = localStorage.getItem(DEMO_TIP_KEY) === '1'
  } catch (_) {}

  const hasUser = hasExistingUserConfig()
  if (!completed && hasUser) {
    // 老用户升级无缝兼容：自动标记引导已完成，不打扰
    completed = true
    markOnboardingCompleted()
  }

  // 若已有真实账号/宿舍配置，不再停留在演示模式
  if (hasUser && demoMode) {
    demoMode = false
    setDemoModeFlag(false)
  }

  const showOnboarding = !completed
  const snapshot = !showOnboarding && !demoMode ? readHomeSnapshot() : null

  return {
    showOnboarding,
    demoMode: !showOnboarding && demoMode,
    showDemoTip: !showOnboarding && demoMode && !tipDismissed,
    savedTab: showOnboarding ? 'home' : readSavedTab(),
    snapshot
  }
}

/** 生成首页各卡片的数据指纹，用于 SWR 完成后判断数据是否真的发生变化 */
export function fingerprintFocus(table: CourseTable | null, loggedIn: boolean): string {
  if (!table) return loggedIn ? 'in:empty' : 'out'
  return `in:${table.term || ''}:${table.courses?.length || 0}:${(table.courses || []).map((c) => c.code || c.name).join(',')}`
}

export function fingerprintExam(exams: Exam[]): string {
  if (!exams.length) return 'empty'
  return exams.map((e) => `${e.name}|${e.date}|${e.time}|${e.room}`).join(';')
}

export function fingerprintNotices(notices: NoticeItem[]): string {
  if (!notices.length) return 'empty'
  return `${notices.length}:${notices.slice(0, 12).map((n) => `${n.source}:${n.id}`).join(',')}`
}

export function fingerprintAircon(room: AirconRoom | null, result: AirconElectricityResult | null): string {
  if (!room) return 'unbound'
  if (result?.status === 'ok') {
    const r = result.reading
    return `ok:${room.roomVerify}:${r.remainingKwh ?? ''}:${r.balanceYuan ?? ''}`
  }
  return `${result?.status || 'pending'}:${room.roomVerify}`
}

export function fingerprintChargers(chargers: ChargerData | null): string {
  if (!chargers) return 'empty'
  return `${chargers.totals?.free ?? ''}/${chargers.totals?.total ?? ''}:${chargers.rows?.length || 0}`
}

export function fingerprintCard(card: CardInfo | null): string {
  if (!card) return 'empty'
  return `${card.balance ?? ''}`
}
