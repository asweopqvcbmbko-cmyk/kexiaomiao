/**
 * 数据入口：所有真实数据都走主进程的 window.haust（Electron preload 注入）。
 * 浏览器里直接打开（没有 preload）时，每个方法都退化为「暂无数据」，不塞演示数据，
 * 这样界面上的空状态是诚实的。
 */
import type {
  AirconElectricityResult,
  AirconRoom,
  AuthOptions,
  AuthRequest,
  AuthResult,
  CardInfo,
  ChaoxingDashboard,
  ChargerData,
  CourseTable,
  Exam,
  GalleryResult,
  NoticeBody,
  NoticeItem,
  SchoolLogin,
  SessionStatus,
  TaskData
} from './types'
import { removeRetiredWebData } from './android/retired-study-data'
import { createAirconElectricityService } from './android/lib/aircon-electricity'
import type { AirconRoomListQuery, AirconRoomListResult } from './types/aircon-electricity'
import type { DormElectricityResult, DormRoom, DormRoomListQuery, DormRoomListResult } from './types/dorm-electricity'

try { removeRetiredWebData() } catch { /* Storage can be disabled in a browser preview. */ }

export type Haust = NonNullable<Window['haust']>

const haust = (): Partial<Haust> | undefined => (typeof window !== 'undefined' ? window.haust : undefined)
/** 有没有接上数据服务（Electron 主进程 / 安卓 WebView 注入的 androidApi） */
export const isConnected = () => !!haust()
export const supportsChaoxing = () => !!haust()?.chaoxingDashboard
export const supportsNativeAuth = () => !!haust()?.nativeAuth
export const supportsDormElectricity = () => !!haust()?.dormElectricity
export const supportsSaveImageToGallery = () => !!haust()?.saveImageToGallery

/**
 * 是不是跑在原生外壳（Capacitor）里。
 * 首次启动自动弹登录窗只在真机/模拟器上做；桌面版走自己的静默凭据登录，浏览器里没有数据层。
 */
export const isNativePlatform = () => {
  try {
    const cap = (window as any).Capacitor
    return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())
  } catch (_) {
    return false
  }
}

async function guard<T>(fn: (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (!fn) return fallback
  try {
    return await fn()
  } catch (_) {
    return fallback
  }
}

function electricityService() {
  const bridge = haust()
  if (bridge?.airconElectricity) return bridge.airconElectricity
  return bridge?.airconRequest ? createAirconElectricityService(localStorage, bridge.airconRequest) : undefined
}

export const data = {
  nativeAuth: (request: AuthRequest, options: AuthOptions): Promise<AuthResult> => {
    const authenticate = haust()?.nativeAuth
    if (!authenticate) return Promise.resolve({ ok: false, reason: 'unsupported', message: '当前客户端不支持此登录方式' })
    return guard(() => authenticate(request, options), { ok: false, reason: 'network', message: '登录服务暂不可用，请重试' })
  },
  saveImageToGallery: (dataUrl: string, filename?: string) => guard<GalleryResult>(
    () => haust()?.saveImageToGallery?.(dataUrl, filename) ?? Promise.resolve({ saved: false, message: '当前客户端不支持保存到相册' }),
    { saved: false, message: '无法保存图片到相册' }
  ),
  airconRoom: () => guard<AirconRoom | null>(() => electricityService()?.getRoom() ?? Promise.resolve(null), null),
  saveAirconRoom: (room: AirconRoom | null) => guard(() => electricityService()?.saveRoom(room) ?? Promise.resolve(false), false),
  listAirconRooms: (query: AirconRoomListQuery) => {
    const fallback: AirconRoomListResult = { status: 'error', message: '未连接电控数据服务' }
    return guard(() => electricityService()?.listRooms(query) ?? Promise.resolve(fallback), fallback)
  },
  airconElectricity: () => guard<AirconElectricityResult | null>(() => electricityService()?.query() ?? Promise.resolve(null), null),
  dormRoom: () => guard<DormRoom | null>(() => haust()?.dormElectricity?.getRoom() ?? Promise.resolve(null), null),
  saveDormRoom: (room: DormRoom | null) => guard(() => haust()?.dormElectricity?.saveRoom(room) ?? Promise.resolve(false), false),
  listDormRooms: (query: DormRoomListQuery) => {
    const fallback: DormRoomListResult = { status: 'error', message: '未连接宿舍电费服务' }
    return guard(() => haust()?.dormElectricity?.listRooms(query) ?? Promise.resolve(fallback), fallback)
  },
  dormElectricity: () => guard<DormElectricityResult | null>(() => haust()?.dormElectricity?.query() ?? Promise.resolve(null), null),
  status: () => guard<SessionStatus | null>(haust()?.status, null),
  login: (schoolLogin?: SchoolLogin) => guard<SessionStatus | null>(() => haust()?.login?.(schoolLogin) ?? Promise.resolve(null), null),
  courses: () => guard<CourseTable | null>(haust()?.refreshCourses, null),
  exams: () => guard<{ fetchedAt: string; exams: Exam[] } | null>(haust()?.refreshExams, null),
  notices: () => guard<{ fetchedAt: string; items: NoticeItem[]; stale?: boolean } | null>(haust()?.refreshNotices, null),
  chargers: () => guard<ChargerData | null>(haust()?.refreshChargers, null),
  tasks: async (_force = false): Promise<TaskData | null> => null,
  card: () => guard<CardInfo | null>(haust()?.refreshCard, null),
  noticeBody: (item: NoticeItem) => guard<NoticeBody | null>(() => (haust()?.noticeBody ? (haust() as Haust).noticeBody(item) : Promise.resolve(null)), null),
  fetchNoticeImage: (url: string, referer?: string) =>
    guard<string | null>(() => (haust()?.fetchNoticeImage ? haust()!.fetchNoticeImage!(url, referer) : Promise.resolve(null)), null),
  cached: () => guard<Record<string, unknown> | null>(haust()?.cached, null),

  markDone: async (_key: string) => false,
  unmarkDone: async (_key: string) => false,
  clearDone: async () => false,
  clearCache: () => guard<boolean>(haust()?.clearCache, false),
  clearCred: () => guard<boolean>(haust()?.clearCred, false),
  clearChaoxing: () => guard<boolean>(haust()?.clearChaoxing, false),

  chaoxingLogin: () => guard(haust()?.chaoxingLogin, { loggedIn: false }),
  chaoxingDashboard: () => guard<ChaoxingDashboard | null>(haust()?.chaoxingDashboard, null),
  chaoxingActivities: (ignoredCourses?: string[]) =>
    guard(async () => await haust()?.chaoxingActivities?.(ignoredCourses) ?? null, null),
  chaoxingProgress: (ignoredCourses?: string[]) =>
    guard(async () => await haust()?.chaoxingProgress?.(ignoredCourses) ?? null, null),
  chaoxingCourseCache: () => haust()?.chaoxingCourseCache?.(),
  credStatus: () => guard<{ saved: boolean; username: string; encryptionAvailable: boolean } | null>(haust()?.credStatus, null),

  openExternal: (url: string) => guard<boolean>(() => (haust()?.openExternal && url ? (haust() as Haust).openExternal!(url) : Promise.resolve(false)), false),
  openInApp: (url: string, title = '通知原文') => guard<boolean>(() => (haust()?.openInApp && url ? (haust() as Haust).openInApp!(url, title) : Promise.resolve(false)), false),
  launchApp: (packageName: string) =>
    guard<{ launched: boolean; installed: boolean }>(
      () => (haust()?.launchApp && packageName ? (haust() as Haust).launchApp!(packageName) : Promise.resolve({ launched: false, installed: false })),
      { launched: false, installed: false }
    )
}

export const events = {
  onSession: (cb: (st: SessionStatus) => void) => (haust()?.onSession ? (haust() as Haust).onSession(cb) : () => {})
}
