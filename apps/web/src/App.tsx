import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { AboutModal, ConflictModal, CourseModal, ThemeModal } from './components/InfoModals'
import { Empty, Modal, PageHeader } from './components/ui'
import { NativeLogin } from './components/NativeLogin'
import { PullToRefresh } from './components/PullToRefresh'
import { UpdateAvailableModal, UpdateSettingsModal } from './components/UpdateModal'
import { haptic } from './haptics'
import {
  checkForAppUpdate,
  getCurrentAppVersion,
  localDayKey,
  readUpdateSettings,
  shouldAutoCheckToday,
  supportsAppUpdater,
  writeUpdateSettings,
  type AppVersionInfo,
  type ReleaseAsset,
  type UpdateSettings
} from './updater'
import { useAndroidBack, useToast } from './hooks'
import { Home } from './pages/Home'
import { DormBinding } from './components/DormBinding'
import { DormElecBinding } from './components/DormElecBinding'
import { ImmersiveUpdateView } from './components/ImmersiveUpdateView'
import { Onboarding } from './components/Onboarding'
import { Dashboard, useChaoxingCourseData } from './pages/Dashboard'
import { Schedule } from './pages/Schedule'
import { Profile, type ProfileSubPage } from './pages/Profile'
import { CardPage, ChargersPage, ExamPage, NoticesPage } from './pages/Subs'
import { data, events, isConnected, isNativePlatform, supportsChaoxing, supportsDormElectricity, supportsNativeAuth } from './api'
import {
  COLLEGES, MAX_SUBSCRIBED_COLLEGES, isCollegeSource, readSubscribedColleges, writeSubscribedColleges
} from './college-notices'
import { buildDemoBundle, buildDemoChaoxingDashboard, getDemoNoticeBody } from './demoData'
import {
  SWR_FAST_TTL_MS,
  SWR_SLOW_TTL_MS,
  clearHomeSnapshot,
  dismissDemoTipFlag,
  fingerprintAircon,
  fingerprintDorm,
  fingerprintCard,
  fingerprintChargers,
  fingerprintExam,
  fingerprintFocus,
  fingerprintNotices,
  markOnboardingCompleted,
  readBootState,
  readChaoxingSnapshot,
  setDemoModeFlag,
  writeHomeSnapshot,
  writeSavedTab,
  type AppTab,
  type CardKey,
  type SyncTimes
} from './snapshot'
import {
  bellTableLabel,
  cardView,
  chargerView,
  conflictGroups,
  daysUntil,
  examsSorted,
  periodTime,
  sessionsForWeek,
  weekdayName,
  type ConflictGroup,
} from './adapters'
import { applyTheme, readTheme, watchSystemTheme, type Theme } from './theme'
import type { AuthOptions, AuthRequest, CardInfo, ChaoxingDashboard, ChargerData, CourseTable, Exam, NoticeBody, NoticeItem, SchoolLogin, SessionStatus } from './types'
import type { AirconRoom, AirconElectricityResult } from './types/aircon-electricity'
import type { DormRoom, DormElectricityResult } from './types/dorm-electricity'

type Tab = AppTab
type Sub = null | 'schedule' | 'chargers' | 'card' | 'exam'

const READ_KEY = 'haust-kxm-read-v1'
const WEEK_KEY = 'haust-kxm-week'
const VIEW_KEY = 'haust-kxm-sched-view'
const ANCHOR_KEY = 'haust-kxm-anchor'

const NAV: Array<[Tab, string, string]> = [
  ['home', '首页', 'home'],
  ['dashboard', '仪表盘', 'grid'],
  ['notices', '通知', 'bell'],
  ['profile', '设置', 'settings']
]

function lsGet<T>(key: string, dflt: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? dflt : (JSON.parse(raw) as T)
  } catch (_) {
    return dflt
  }
}
function lsSet(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch (_) {}
}
const clock = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const todayWeekday = () => {
  const d = new Date().getDay()
  return d === 0 ? 7 : d
}
function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const wd = x.getDay() === 0 ? 7 : x.getDay()
  x.setDate(x.getDate() - (wd - 1))
  return x
}
function loadAnchor(): { week: number; monday: string } {
  const saved = lsGet<{ week: number; monday: string } | null>(ANCHOR_KEY, null)
  if (saved && Number(saved.week) >= 1 && saved.monday) return saved
  return { week: 10, monday: '2026-11-02' }
}

function NoticeImage({ src, alt, referer }: { src: string; alt: string; referer?: string }) {
  const isVpn = /-haust-edu-cn-s\.haust\.edu\.cn/i.test(src)
  const [resolved, setResolved] = useState<string | null>(() => (isVpn ? null : src))
  const [failed, setFailed] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const retriedRef = useRef(false)
  const gestureRef = useRef<{
    mode: 'none' | 'pan' | 'pinch'
    startX: number
    startY: number
    baseX: number
    baseY: number
    startDist: number
    baseScale: number
    lastTap: number
  }>({ mode: 'none', startX: 0, startY: 0, baseX: 0, baseY: 0, startDist: 0, baseScale: 1, lastTap: 0 })

  useEffect(() => {
    let alive = true
    retriedRef.current = false
    setFailed(false)
    if (!isVpn) {
      setResolved(src)
      return () => { alive = false }
    }
    setResolved(null)
    void data.fetchNoticeImage(src, referer).then((dataUrl) => {
      if (!alive) return
      if (dataUrl) {
        setResolved(dataUrl)
      } else {
        retriedRef.current = true
        setResolved(src)
      }
    })
    return () => { alive = false }
  }, [src, referer, isVpn])

  const openLightbox = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setLightbox(true)
  }

  const closeLightbox = () => {
    setLightbox(false)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const handleError = () => {
    if (!retriedRef.current) {
      retriedRef.current = true
      void data.fetchNoticeImage(src, referer).then((dataUrl) => {
        if (dataUrl) setResolved(dataUrl)
        else setFailed(true)
      })
      return
    }
    setFailed(true)
  }

  if (failed) {
    return (
      <div
        style={{
          margin: '10px 0',
          padding: '10px 12px',
          borderRadius: 10,
          background: 'var(--bg-soft, rgba(128,128,128,0.08))',
          color: 'var(--muted)',
          fontSize: 12,
          textAlign: 'center'
        }}
      >
        图片加载失败，可点击下方「打开原文」查看
      </div>
    )
  }

  if (!resolved) {
    return (
      <div
        aria-label="正在加载正文图片"
        style={{
          margin: '12px auto',
          height: 140,
          borderRadius: 10,
          background: 'var(--bg-soft, rgba(128,128,128,0.1))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontSize: 12
        }}
      >
        正在加载图片…
      </div>
    )
  }

  return (
    <>
      <img
        src={resolved}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={handleError}
        onClick={openLightbox}
        style={{ display: 'block', maxWidth: '100%', height: 'auto', margin: '12px auto', borderRadius: 8, cursor: 'zoom-in' }}
      />
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="图片全屏预览"
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox() }}
          onTouchStart={(e) => {
            const g = gestureRef.current
            if (e.touches.length === 2) {
              const dx = e.touches[0].clientX - e.touches[1].clientX
              const dy = e.touches[0].clientY - e.touches[1].clientY
              g.mode = 'pinch'
              g.startDist = Math.hypot(dx, dy) || 1
              g.baseScale = scale
            } else if (e.touches.length === 1) {
              const now = Date.now()
              if (now - g.lastTap < 280) {
                g.lastTap = 0
                if (scale > 1.1) {
                  setScale(1)
                  setOffset({ x: 0, y: 0 })
                } else {
                  setScale(2.2)
                }
                g.mode = 'none'
                return
              }
              g.lastTap = now
              if (scale > 1) {
                g.mode = 'pan'
                g.startX = e.touches[0].clientX
                g.startY = e.touches[0].clientY
                g.baseX = offset.x
                g.baseY = offset.y
              } else {
                g.mode = 'none'
              }
            }
          }}
          onTouchMove={(e) => {
            const g = gestureRef.current
            if (g.mode === 'pinch' && e.touches.length === 2) {
              e.preventDefault()
              const dx = e.touches[0].clientX - e.touches[1].clientX
              const dy = e.touches[0].clientY - e.touches[1].clientY
              const next = Math.max(1, Math.min(4, g.baseScale * (Math.hypot(dx, dy) / g.startDist)))
              setScale(next)
              if (next <= 1.02) setOffset({ x: 0, y: 0 })
            } else if (g.mode === 'pan' && e.touches.length === 1 && scale > 1) {
              e.preventDefault()
              setOffset({
                x: g.baseX + (e.touches[0].clientX - g.startX),
                y: g.baseY + (e.touches[0].clientY - g.startY)
              })
            }
          }}
          onTouchEnd={() => {
            gestureRef.current.mode = 'none'
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(6, 10, 18, 0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            touchAction: 'none'
          }}
        >
          <button
            type="button"
            aria-label="关闭预览"
            onClick={closeLightbox}
            style={{
              position: 'fixed',
              top: 'calc(env(safe-area-inset-top, 16px) + 14px)',
              right: 16,
              zIndex: 10000,
              width: 36,
              height: 36,
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.22)',
              background: 'rgba(255,255,255,0.14)',
              color: '#fff',
              fontSize: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
          <img
            src={resolved}
            alt={alt}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '96vw',
              maxHeight: '86vh',
              objectFit: 'contain',
              borderRadius: 6,
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              transition: gestureRef.current.mode === 'none' ? 'transform 160ms ease-out' : 'none',
              userSelect: 'none'
            }}
          />
          <div
            style={{
              position: 'fixed',
              bottom: 'calc(env(safe-area-inset-bottom, 12px) + 16px)',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '5px 12px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12,
              pointerEvents: 'none'
            }}
          >
            双指捏合或双击放大 · 点击空白处关闭
          </div>
        </div>
      )}
    </>
  )
}

export default function App() {
  /* ---------------- 冷启动同步状态判定（杜绝首帧闪烁） ---------------- */
  const [boot] = useState(() => readBootState())
  const [initialDemo] = useState(() => (boot.demoMode ? buildDemoBundle() : null))
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(boot.showOnboarding)
  const [onboardingStep, setOnboardingStep] = useState<number>(0)
  const [onboardingReplay, setOnboardingReplay] = useState<boolean>(boot.onboardingReplay)
  const [demoMode, setDemoMode] = useState<boolean>(boot.demoMode)
  const [showDemoTip, setShowDemoTip] = useState<boolean>(boot.showDemoTip)

  /* ---------------- 基础状态（恢复退出前 Tab 与快照） ---------------- */
  const [tab, setTab] = useState<Tab>(boot.savedTab)
  const [sub, setSub] = useState<Sub>(null)
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const [refreshing, setRefreshing] = useState(false)
  const [syncStage, setSyncStage] = useState<'' | 'logging_in' | 'academic' | 'notices' | 'services'>('')
  const [lastSync, setLastSync] = useState<string>(() => boot.snapshot?.lastSync || '')

  /* ---------------- 真实数据 / 首帧快照 / 演示数据 ---------------- */
  const [status, setStatus] = useState<SessionStatus | null>(() => initialDemo?.status ?? boot.snapshot?.status ?? null)
  const [table, setTable] = useState<CourseTable | null>(() => initialDemo?.table ?? boot.snapshot?.table ?? null)
  const [exams, setExams] = useState<Exam[]>(() => initialDemo?.exams ?? boot.snapshot?.exams ?? [])
  const [notices, setNotices] = useState<NoticeItem[]>(() => initialDemo?.notices ?? boot.snapshot?.notices ?? [])
  const [subscribedColleges, setSubscribedColleges] = useState<string[]>(() => readSubscribedColleges())
  const noticeSubscriptionRevision = useRef(0)
  const [noticesStale, setNoticesStale] = useState(false)
  const [noticesAuthRequired, setNoticesAuthRequired] = useState(false)
  const [chargers, setChargers] = useState<ChargerData | null>(() => initialDemo?.chargers ?? boot.snapshot?.chargers ?? null)
  const [card, setCard] = useState<CardInfo | null>(() => initialDemo?.card ?? boot.snapshot?.card ?? null)
  const [chaoxingDash, setChaoxingDash] = useState<ChaoxingDashboard | null>(
    () => (boot.demoMode ? buildDemoChaoxingDashboard() : readChaoxingSnapshot())
  )
  const [chaoxingLoading, setChaoxingLoading] = useState(false)
  const [chaoxingReady, setChaoxingReady] = useState(false)
  const chaoxingFetchedAtRef = useRef(0)
  const chaoxingSession = useRef(0)
  const chaoxingSigningIn = useRef(false)
  const chaoxingCourseData = useChaoxingCourseData()
  const { reset: resetChaoxingCourses } = chaoxingCourseData

  /* ---------------- SWR 进度条与波纹更新状态 ---------------- */
  const [swrCards, setSwrCards] = useState<Partial<Record<CardKey, boolean>>>({})
  const [ripples, setRipples] = useState<Partial<Record<CardKey, number>>>({})
  const rippleTimers = useRef<Partial<Record<CardKey, number>>>({})
  const syncTimesRef = useRef<SyncTimes>(
    boot.snapshot?.syncTimes ?? { academic: 0, notices: 0, card: 0, chargers: 0, aircon: 0 }
  )
  const fpRef = useRef<Partial<Record<CardKey, string>>>({
    focus: boot.snapshot ? fingerprintFocus(boot.snapshot.table, !!boot.snapshot.status?.loggedIn) : undefined,
    exam: boot.snapshot?.exams?.length ? fingerprintExam(boot.snapshot.exams) : undefined,
    notices: boot.snapshot?.notices?.length ? fingerprintNotices(boot.snapshot.notices) : undefined,
    aircon: boot.snapshot?.airconRoom ? fingerprintAircon(boot.snapshot.airconRoom, boot.snapshot.airconResult) : undefined,
    chargers: boot.snapshot?.chargers ? fingerprintChargers(boot.snapshot.chargers) : undefined,
    card: boot.snapshot?.card ? fingerprintCard(boot.snapshot.card) : undefined
  })

  const triggerRipple = useCallback((key: CardKey) => {
    setRipples((prev) => ({ ...prev, [key]: Date.now() }))
    const oldTimer = rippleTimers.current[key]
    if (oldTimer) window.clearTimeout(oldTimer)
    rippleTimers.current[key] = window.setTimeout(() => {
      setRipples((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    }, 950)
  }, [])

  const updateFingerprint = useCallback(
    (key: CardKey, nextFp: string, allowRipple: boolean) => {
      const prevFp = fpRef.current[key]
      fpRef.current[key] = nextFp
      if (allowRipple && prevFp && prevFp !== nextFp) {
        triggerRipple(key)
      }
    },
    [triggerRipple]
  )

  useEffect(() => {
    return () => {
      for (const t of Object.values(rippleTimers.current)) {
        if (t) window.clearTimeout(t)
      }
    }
  }, [])

  /* ---------------- 交互状态 ---------------- */
  const [week, setWeek] = useState(() => Number(lsGet(WEEK_KEY, 10)) || 10)
  const [view, setView] = useState<'day' | 'week'>(() => (lsGet<string>(VIEW_KEY, 'day') === 'week' ? 'week' : 'day'))
  const [day, setDay] = useState(todayWeekday)
  const [anchor, setAnchor] = useState(loadAnchor)
  const [readIds, setReadIds] = useState<string[]>(() => lsGet(READ_KEY, [] as string[]))

  const [modal, setModal] = useState<
    | null
    | { kind: 'course'; id: string }
    | { kind: 'conflict'; id?: string }
    | { kind: 'notice'; item: NoticeItem }
    | { kind: 'collegeSubscriptions'; draft: string[] }
    | { kind: 'theme' }
    | { kind: 'aircon' }
    | { kind: 'dorm' }
    | { kind: 'about' }
    | { kind: 'updateSettings' }
    | { kind: 'updateAvailable' }
    | { kind: 'schoolLogin'; returnToNotice?: NoticeItem }
    | { kind: 'chaoxingLogin' }
    | { kind: 'logoutChaoxing' }
  >(null)
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings>(() => readUpdateSettings())
  const [appVersion, setAppVersion] = useState<AppVersionInfo>({ versionCode: 11, versionName: '0.1.10' })
  const [availableUpdate, setAvailableUpdate] = useState<ReleaseAsset | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateStatusHint, setUpdateStatusHint] = useState('')
  const [profileSubPage, setProfileSubPage] = useState<ProfileSubPage>('root')
  const [immersiveUpdateOpen, setImmersiveUpdateOpen] = useState(false)
  const immersiveUpdateOpenRef = useRef(immersiveUpdateOpen)
  immersiveUpdateOpenRef.current = immersiveUpdateOpen
  const immersiveUpdateBackRef = useRef<(() => boolean) | null>(null)
  const autoCheckedRef = useRef(false)
  const [noticeBodyState, setNoticeBodyState] = useState<{ loading: boolean; body: NoticeBody | null }>({
    loading: false,
    body: null
  })
  const noticeRequestId = useRef(0)

  const { message: toastMsg, toast } = useToast()

  /* ---------------- 主题 ---------------- */
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  useEffect(() => watchSystemTheme(), [])

  /* ---------------- 云端自动更新（每日首次静默检查） ---------------- */
  useEffect(() => {
    void getCurrentAppVersion().then(setAppVersion)
  }, [])

  const runUpdateCheck = useCallback(async (opts?: { silent?: boolean; settingsOverride?: UpdateSettings }) => {
    const activeSettings = opts?.settingsOverride ?? updateSettings
    if (!opts?.silent) {
      setUpdateChecking(true)
      setUpdateStatusHint('')
    }
    try {
      const res = await checkForAppUpdate({ includeBeta: activeSettings.includeBeta })
      setAppVersion(res.current)
      if (opts?.silent) {
        const stamped = writeUpdateSettings({ ...activeSettings, lastAutoCheckDay: localDayKey() })
        setUpdateSettings(stamped)
      }
      if (res.status === 'available') {
        setAvailableUpdate(res.release)
        if (!opts?.silent) {
          setUpdateStatusHint(`发现新版本 v${res.release.versionName}`)
          if (!immersiveUpdateOpenRef.current) setModal({ kind: 'updateAvailable' })
        } else if (res.release.versionName !== activeSettings.ignoredVersion) {
          if (!immersiveUpdateOpenRef.current) setModal((prev) => prev ?? { kind: 'updateAvailable' })
        }
      } else if (!opts?.silent) {
        setAvailableUpdate(null)
        if (res.status === 'up_to_date') {
          const msg = `当前 v${res.current.versionName} 已是最新版本`
          setUpdateStatusHint(msg)
          toast(msg)
        } else {
          setUpdateStatusHint(res.message)
          toast(res.message)
        }
      }
    } finally {
      if (!opts?.silent) setUpdateChecking(false)
    }
  }, [toast, updateSettings])

  useEffect(() => {
    if (onboardingOpen || autoCheckedRef.current || !supportsAppUpdater()) return
    autoCheckedRef.current = true
    if (!shouldAutoCheckToday(updateSettings)) return
    const timer = window.setTimeout(() => {
      void runUpdateCheck({ silent: true })
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [onboardingOpen, runUpdateCheck, updateSettings])

  /* ---------------- 退出状态保留：持久化当前激活 Tab ---------------- */
  useEffect(() => {
    if (!onboardingOpen) writeSavedTab(tab)
  }, [tab, onboardingOpen])

  const [airconRoom, setAirconRoom] = useState<AirconRoom | null>(
    () => initialDemo?.airconRoom ?? boot.snapshot?.airconRoom ?? null
  )
  const [airconResult, setAirconResult] = useState<AirconElectricityResult | null>(
    () => initialDemo?.airconResult ?? boot.snapshot?.airconResult ?? null
  )
  const airconRequest = useRef(0)
  const [dormRoom, setDormRoom] = useState<DormRoom | null>(
    () => (boot.demoMode ? null : boot.snapshot?.dormRoom ?? null)
  )
  const [dormResult, setDormResult] = useState<DormElectricityResult | null>(
    () => (boot.demoMode ? null : boot.snapshot?.dormResult ?? null)
  )
  const dormRequest = useRef(0)
  const demoModeRef = useRef(demoMode)
  demoModeRef.current = demoMode
  const onboardingOpenRef = useRef(onboardingOpen)
  onboardingOpenRef.current = onboardingOpen

  const refreshAircon = useCallback(async (opts?: { silent?: boolean }) => {
    if (demoModeRef.current || onboardingOpenRef.current) return
    const request = ++airconRequest.current
    setSwrCards((prev) => ({ ...prev, aircon: true }))
    try {
      const [room, result] = await Promise.all([data.airconRoom(), data.airconElectricity()])
      if (request === airconRequest.current && !demoModeRef.current) {
        const nextRoom = result?.status === 'ok' ? result.reading.room : room
        setAirconRoom(nextRoom)
        const isTransientFailure = result?.status === 'query_failed'
        setAirconResult((prev) => {
          if (isTransientFailure && prev?.status === 'ok') return prev
          return result
        })
        if (!isTransientFailure) {
          syncTimesRef.current.aircon = Date.now()
          updateFingerprint('aircon', fingerprintAircon(nextRoom, result), !!opts?.silent || !!fpRef.current.aircon)
        }
      }
    } finally {
      if (request === airconRequest.current) {
        setSwrCards((prev) => ({ ...prev, aircon: false }))
      }
    }
  }, [updateFingerprint])

  const saveAirconBinding = async (room: AirconRoom) => {
    if (!await data.saveAirconRoom(room)) return false
    setAirconRoom(room)
    setAirconResult(null)
    setModal((current) => current?.kind === 'aircon' ? null : current)
    void refreshAircon()
    return true
  }

  const refreshDorm = useCallback(async (opts?: { silent?: boolean }) => {
    if (demoModeRef.current || onboardingOpenRef.current) return
    const request = ++dormRequest.current
    setSwrCards((prev) => ({ ...prev, dorm: true }))
    try {
      const [room, result] = await Promise.all([data.dormRoom(), data.dormElectricity()])
      if (request === dormRequest.current && !demoModeRef.current) {
        const nextRoom = result?.status === 'ok' ? result.reading.room : room
        setDormRoom(nextRoom)
        const isTransientFailure =
          result?.status === 'query_failed' || result?.status === 'auth_required'
        setDormResult((prev) => {
          if (isTransientFailure && prev?.status === 'ok') return prev
          return result
        })
        if (!isTransientFailure) {
          syncTimesRef.current.dorm = Date.now()
          updateFingerprint('dorm', fingerprintDorm(nextRoom, result), !!opts?.silent || !!fpRef.current.dorm)
        }
      }
    } finally {
      if (request === dormRequest.current) {
        setSwrCards((prev) => ({ ...prev, dorm: false }))
      }
    }
  }, [updateFingerprint])

  const saveDormBinding = async (room: DormRoom) => {
    const session = schoolSession.current
    const request = ++dormRequest.current
    if (!await data.saveDormRoom(room)) return false
    if (session !== schoolSession.current || request !== dormRequest.current || demoModeRef.current) return false
    setDormRoom(room)
    setDormResult(null)
    setModal((current) => current?.kind === 'dorm' ? null : current)
    void refreshDorm()
    return true
  }

  /* ---------------- 持久化首帧快照（仅真实模式） ---------------- */
  useEffect(() => {
    if (onboardingOpen || demoMode) return
    const hasAny = !!(status?.loggedIn || table?.courses?.length || notices.length || chargers || card || airconRoom || dormRoom)
    if (!hasAny) return
    writeHomeSnapshot({
      status,
      table,
      exams,
      notices,
      chargers,
      card,
      airconRoom,
      airconResult,
      dormRoom,
      dormResult,
      lastSync,
      syncTimes: { ...syncTimesRef.current }
    })
  }, [onboardingOpen, demoMode, status, table, exams, notices, chargers, card, airconRoom, airconResult, dormRoom, dormResult, lastSync])

  /* ---------------- 加载真实数据 ---------------- */
  const applyCached = useCallback((c: Record<string, unknown> | null) => {
    if (!c || demoModeRef.current) return
    const anyC = c as Record<string, any>
    if (anyC.courses?.courses?.length) {
      setTable(anyC.courses as CourseTable)
      updateFingerprint('focus', fingerprintFocus(anyC.courses as CourseTable, !!anyC.session?.loggedIn), false)
    }
    if (anyC.exams?.exams?.length) {
      setExams(anyC.exams.exams as Exam[])
      updateFingerprint('exam', fingerprintExam(anyC.exams.exams as Exam[]), false)
    }
    if (anyC.notices?.items?.length) {
      setNotices(anyC.notices.items as NoticeItem[])
      updateFingerprint('notices', fingerprintNotices(anyC.notices.items as NoticeItem[]), false)
    }
    if (anyC.chargers?.rows?.length) {
      setChargers(anyC.chargers as ChargerData)
      updateFingerprint('chargers', fingerprintChargers(anyC.chargers as ChargerData), false)
    }
    if (anyC.card) {
      setCard(anyC.card as CardInfo)
      updateFingerprint('card', fingerprintCard(anyC.card as CardInfo), false)
    }
    if (anyC.session?.loggedIn) setStatus(anyC.session as SessionStatus)
  }, [updateFingerprint])

  /* ---------------- 分层静默刷新（SWR）：不重叠 + 指纹波纹 ---------------- */
  const refreshingRef = useRef<Promise<void> | null>(null)
  const schoolSession = useRef(0)
  const pendingRefreshOptsRef = useRef<{ force: boolean; knownStatus?: SessionStatus } | null>(null)
  /** 课表/考试没拉到时的原因（空串 = 正常），给空状态提示用 */
  const [courseError, setCourseError] = useState('')

  /** 按分层 TTL 拉取：高频（通知/校园卡/充电桩 ≥10min），低频（课表/考试 ≥6h）；force=true 强制全量 */
  const runRefreshOnce = useCallback(async (force: boolean, knownStatus?: SessionStatus) => {
    if (demoModeRef.current || onboardingOpenRef.current) return
    const now = Date.now()
    const times = syncTimesRef.current
    const session = schoolSession.current
    const needAcademic = force || !times.academic || now - times.academic >= SWR_SLOW_TTL_MS
    const needNotices = force || !times.notices || now - times.notices >= SWR_FAST_TTL_MS
    const needCard = force || !times.card || now - times.card >= SWR_FAST_TTL_MS
    const needChargers = force || !times.chargers || now - times.chargers >= SWR_FAST_TTL_MS

    if (!needAcademic && !needNotices && !needCard && !needChargers) return

    let didAny = false
    // 充电桩走独立 HTTP（不占隐藏 WebView 锁），与教务并行拉取缩短首屏等待
    let chargersPromise: Promise<void> | null = null
    if (needChargers) {
      setSwrCards((prev) => ({ ...prev, chargers: true }))
      chargersPromise = (async () => {
        try {
          const ch = await data.chargers()
          if (demoModeRef.current) return
          if (ch) {
            setChargers(ch)
            times.chargers = Date.now()
            updateFingerprint('chargers', fingerprintChargers(ch), true)
          }
          didAny = true
        } finally {
          setSwrCards((prev) => ({ ...prev, chargers: false }))
        }
      })()
    }

    if (needAcademic) {
      if (force) setSyncStage('academic')
      setSwrCards((prev) => ({ ...prev, focus: true, exam: true }))
      try {
        // 刚登录成功传入 knownStatus 时直接跳过冗余的 data.status()，立刻拉课表与考试
        const st = knownStatus?.loggedIn ? knownStatus : await data.status()
        if (demoModeRef.current || session !== schoolSession.current) return
        if (st) setStatus(st)
        let tableOk = false
        if (st?.loggedIn) {
          const [t, e] = await Promise.all([data.courses(), data.exams()])
          if (demoModeRef.current || session !== schoolSession.current) return
          if (t) {
            setTable(t)
            updateFingerprint('focus', fingerprintFocus(t, true), !force || !!fpRef.current.focus)
          }
          if (e) {
            const nextExams = e.exams || []
            setExams(nextExams)
            updateFingerprint('exam', fingerprintExam(nextExams), !force || !!fpRef.current.exam)
          }
          tableOk = !!(t && t.courses && t.courses.length)
          setCourseError(tableOk ? '' : String((t as any)?.error || (e as any)?.error || '课程/考试没拉下来'))
          if (tableOk) times.academic = Date.now()
          if (!tableOk && force) toast('教务数据没拉下来，点刷新重试')
        }
        didAny = true
      } finally {
        setSwrCards((prev) => ({ ...prev, focus: false, exam: false }))
      }
    }

    if (needNotices) {
      if (force) setSyncStage('notices')
      setSwrCards((prev) => ({ ...prev, notices: true }))
      const subscriptionRevision = noticeSubscriptionRevision.current
      try {
        const nt = await data.notices()
        if (demoModeRef.current || session !== schoolSession.current) return
        if (nt) {
          const items = nt.items || []
          setNotices(items)
          setNoticesStale(!!nt.stale)
          setNoticesAuthRequired(!!((nt as any).authRequired || (nt as any).portalAuthRequired))
          // 订阅保存后，旧请求完成时须保留待刷新的状态。
          if (subscriptionRevision === noticeSubscriptionRevision.current) times.notices = Date.now()
          updateFingerprint('notices', fingerprintNotices(items), true)
        }
        didAny = true
      } finally {
        setSwrCards((prev) => ({ ...prev, notices: false }))
      }
    }

    if (needCard) {
      if (force) setSyncStage('services')
      setSwrCards((prev) => ({ ...prev, card: true }))
      try {
        const cd = await data.card()
        if (demoModeRef.current || session !== schoolSession.current) return
        if (cd) {
          setCard(cd)
          times.card = Date.now()
          updateFingerprint('card', fingerprintCard(cd), true)
        }
        didAny = true
      } finally {
        setSwrCards((prev) => ({ ...prev, card: false }))
      }
    }

    if (chargersPromise) await chargersPromise
    if (didAny) setLastSync(clock())
  }, [toast, updateFingerprint])

  /**
   * 外部统一入口：正在刷新时不叠加，只记一笔「跑完再补一遍」。
   */
  const refreshAll = useCallback((opts?: { force?: boolean; knownStatus?: SessionStatus }) => {
    const force = opts?.force ?? true
    if (demoModeRef.current || onboardingOpenRef.current) return Promise.resolve()
    if (refreshingRef.current) {
      pendingRefreshOptsRef.current = {
        force: Boolean(pendingRefreshOptsRef.current?.force || force),
        knownStatus: opts?.knownStatus || pendingRefreshOptsRef.current?.knownStatus
      }
      return refreshingRef.current
    }
    setRefreshing(true)
    const run = (async () => {
      try {
        await runRefreshOnce(force, opts?.knownStatus)
        while (pendingRefreshOptsRef.current !== null) {
          const next = pendingRefreshOptsRef.current
          pendingRefreshOptsRef.current = null
          await runRefreshOnce(next.force, next.knownStatus)
        }
      } finally {
        refreshingRef.current = null
        setRefreshing(false)
        setSyncStage((cur) => (cur === 'logging_in' ? cur : ''))
      }
    })()
    refreshingRef.current = run
    return run
  }, [runRefreshOnce])

  const handleChangeSubscribedColleges = (nextIds: string[]) => {
    setSubscribedColleges(writeSubscribedColleges(nextIds))
    if (demoModeRef.current) return
    noticeSubscriptionRevision.current += 1
    syncTimesRef.current.notices = 0
    void refreshAll({ force: false })
  }

  const manualRefresh = () => {
    if (demoMode) {
      toast('当前为演示模式，登录校园账号后可同步实时数据')
      return
    }
    void refreshAll({ force: true })
    void refreshAircon({ silent: true })
    void refreshDorm({ silent: true })
  }

  /* ---------------- Android 返回键拦截栈（引导页最高优先级） ---------------- */
  useAndroidBack(() => {
    if (onboardingOpen) {
      if (onboardingStep > 0) {
        setOnboardingStep((s) => Math.max(0, s - 1))
        return true
      }
      if (onboardingReplay) {
        setOnboardingOpen(false)
        setOnboardingReplay(false)
        return true
      }
      // 冷启动引导第 1 屏按返回键：交给系统退出应用，严禁绕过引导进入主页
      return false
    }
    if (immersiveUpdateOpen) {
      if (immersiveUpdateBackRef.current) {
        return immersiveUpdateBackRef.current()
      }
      setImmersiveUpdateOpen(false)
      return true
    }
    if (modal) {
      setModal(modal.kind === 'schoolLogin' && modal.returnToNotice ? { kind: 'notice', item: modal.returnToNotice } : null)
      return true
    }
    if (sub) {
      setSub(null)
      window.scrollTo({ top: 0 })
      return true
    }
    if (tab === 'profile' && profileSubPage !== 'root') {
      setProfileSubPage(profileSubPage === 'about' ? 'root' : 'about')
      window.scrollTo({ top: 0 })
      return true
    }
    if (tab !== 'home') {
      setTab('home')
      window.scrollTo({ top: 0 })
      return true
    }
    return false
  })

  /* 切换 tab / 进出子页时回到顶部 */
  useEffect(() => {
    window.scrollTo({ top: 0 })
    const el = document.getElementById('content')
    if (el) el.scrollTop = 0
  }, [tab, sub])

  /* ---------------- 真实模式冷启动初始化与会话监听 ---------------- */
  const didInitReal = useRef(false)
  useEffect(() => {
    if (onboardingOpen || demoMode) return
    if (didInitReal.current) return
    didInitReal.current = true
    let alive = true
    ;(async () => {
      const cached = await Promise.race([data.cached(), new Promise<null>((r) => setTimeout(() => r(null), 1200))])
      if (!alive || demoModeRef.current) return
      applyCached(cached)
      const now = Date.now()
      // 有本地快照时仅按分层 TTL 静默重验证；空调/宿舍电费仅在已绑定或未拉取过房间配置时检查
      void refreshAircon({ silent: true })
      void refreshDorm({ silent: true })
      const times = syncTimesRef.current
      const hasWarm = !!(boot.snapshot?.status?.loggedIn || (cached as any)?.session?.loggedIn)
      if (hasWarm) {
        if (now - times.notices >= SWR_FAST_TTL_MS || now - times.academic >= SWR_SLOW_TTL_MS) {
          void refreshAll({ force: false })
        }
        return
      }
      await refreshAll({ force: true })
    })()
    const offSession = events.onSession((st) => {
      if (demoModeRef.current) return
      if (!st.loggedIn && loginRunning.current) {
        schoolSession.current += 1
        dormRequest.current += 1
        setTable(null)
        setExams([])
        setCard(null)
        setDormResult(null)
        syncTimesRef.current.dorm = 0
        setCourseError('')
        clearHomeSnapshot()
      }
      setStatus((prev) => {
        if (prev?.studentName && st.studentName && prev.studentName !== st.studentName) {
          dormRequest.current += 1
          setTable(null)
          setExams([])
          setCard(null)
          setDormResult(null)
          syncTimesRef.current.dorm = 0
          setCourseError('')
        }
        return st
      })
      if (st.loggedIn && !loginRunning.current && !refreshingRef.current) {
        void refreshAll({ force: true })
      }
    })
    return () => {
      alive = false
      offSession()
    }
  }, [onboardingOpen, demoMode, applyCached, refreshAll, refreshAircon, boot.snapshot])

  /* 切回前台 & 断网恢复联网：按分层 SWR 静默重验证（不遮挡旧数据，1.5s 防抖避免瞬时双刷） */
  const resumeTimerRef = useRef<number | null>(null)
  const tabRef = useRef(tab)
  tabRef.current = tab
  const chaoxingDashRef = useRef(chaoxingDash)
  chaoxingDashRef.current = chaoxingDash
  const refreshChaoxingRef = useRef<((opts?: { force?: boolean }) => Promise<void>) | null>(null)

  useEffect(() => {
    const triggerResumeSync = (fromOnline: boolean) => {
      if (onboardingOpenRef.current || demoModeRef.current) return
      if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = window.setTimeout(() => {
        resumeTimerRef.current = null
        if (onboardingOpenRef.current || demoModeRef.current) return
        void refreshAll({ force: false })
        if (fromOnline || Date.now() - syncTimesRef.current.aircon >= SWR_FAST_TTL_MS) {
          void refreshAircon({ silent: true })
        }
        if (fromOnline || Date.now() - (syncTimesRef.current.dorm ?? 0) >= SWR_FAST_TTL_MS) {
          void refreshDorm({ silent: true })
        }
        const curDash = chaoxingDashRef.current
        const needChaoxing =
          tabRef.current === 'dashboard' ||
          Boolean(curDash?.error) ||
          curDash?.recovery?.state === 'retryable' ||
          (fromOnline && Boolean(curDash?.authRequired))
        if (needChaoxing) {
          void refreshChaoxingRef.current?.({ force: fromOnline })
        }
      }, fromOnline ? 1200 : 300)
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') triggerResumeSync(false)
    }
    const onOnline = () => {
      if (document.visibilityState === 'visible') triggerResumeSync(true)
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current)
        resumeTimerRef.current = null
      }
    }
  }, [refreshAll, refreshAircon, refreshDorm])

  /* 周次锚点：拿到教务当前周就刷新；日期按「锚点周 + 偏移」推算 */
  useEffect(() => {
    const cw = status?.currentWeek
    if (!cw) return
    const monday = mondayOf(new Date())
    const localMonday = [monday.getFullYear(), monday.getMonth() + 1, monday.getDate()]
      .map((part) => String(part).padStart(2, '0')).join('-')
    const next = { week: cw, monday: localMonday }
    setAnchor((prev) => (prev.week === next.week && prev.monday === next.monday ? prev : next))
    setWeek((w) => {
      if (w === 10 && cw !== 10) return cw
      return w
    })
  }, [status?.currentWeek])

  useEffect(() => {
    lsSet(ANCHOR_KEY, anchor)
  }, [anchor])
  useEffect(() => {
    lsSet(WEEK_KEY, week)
  }, [week])

  /* ---------------- 派生数据 ---------------- */
  /** 课表到底有没有拉到（区分「真没课」和「没登录/没拉下来」） */
  const hasTable = !!table && Array.isArray(table.courses) && table.courses.length > 0
  const sessions = useMemo(() => sessionsForWeek(table, week), [table, week])
  const conflicts = useMemo(() => conflictGroups(sessions), [sessions])
  const todayWd = todayWeekday()
  const currentMonday = mondayOf(new Date())
  const anchorMonday = new Date(`${anchor.monday}T00:00:00`)
  const weeksFromAnchor = Math.round((currentMonday.getTime() - anchorMonday.getTime()) / 604_800_000)
  const currentWeek = status?.currentWeek ?? Math.max(1, Math.min(20, anchor.week + weeksFromAnchor))
  const todaySessions = useMemo(
    () => sessionsForWeek(table, currentWeek).filter((s) => s.day === todayWd).sort((a, b) => a.start - b.start),
    [table, currentWeek, todayWd]
  )

  const examList = useMemo(() => examsSorted(exams), [exams])
  const nextExam = (() => {
    const now = new Date()
    for (const ex of examList) {
      const time = /^\d{1,2}:\d{2}/.exec(ex.time || '')?.[0]
      const startsAt = time ? Date.parse(`${ex.date}T${time.padStart(5, '0')}:00`) : NaN
      if (Number.isFinite(startsAt) && startsAt < +now) continue
      const days = daysUntil(ex, +now)
      if (days == null || days < 0) continue
      const today = new Date(startsAt).toDateString() === now.toDateString()
      return { ex, days: today ? 0 : days }
    }
    return null
  })()

  const chView = useMemo(() => chargerView(chargers), [chargers])
  const cdView = useMemo(() => cardView(card), [card])
  const visibleNotices = useMemo(
    () => demoMode ? notices : notices.filter((n) => !isCollegeSource(n.source) || subscribedColleges.includes(n.source)),
    [demoMode, notices, subscribedColleges]
  )
  const unread = useMemo(() => visibleNotices.filter((n) => !readIds.includes(`${n.source}:${n.id}`)).length, [visibleNotices, readIds])


  const unreadNotices = useMemo(
    () =>
      visibleNotices
        .filter((n) => !readIds.includes(`${n.source}:${n.id}`))
        .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
        .slice(0, 3),
    [visibleNotices, readIds]
  )

  const latestNoticeTitles = useMemo(() => [...visibleNotices]
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, 2).map((item) => item.title), [visibleNotices])

  /* ---------------- 日期 ---------------- */
  const dateFor = useCallback(
    (d: number) => {
      const base = new Date(`${anchor.monday}T00:00:00`)
      base.setDate(base.getDate() + (week - anchor.week) * 7 + (d - 1))
      return base
    },
    [anchor, week]
  )
  const dateLabel = useCallback((d: number) => {
    const x = dateFor(d)
    return `${x.getMonth() + 1}/${x.getDate()}`
  }, [dateFor])
  const dateFull = useCallback((d: number) => {
    const x = dateFor(d)
    return `${x.getMonth() + 1} 月 ${x.getDate()} 日`
  }, [dateFor])
  const now = new Date()
  const dateText = `${now.getMonth() + 1}月${now.getDate()}日`
  const dayText = weekdayName(todayWd)

  /* ---------------- 通知已读 ---------------- */
  const openNotice = useCallback(
    async (n: NoticeItem) => {
      const requestId = ++noticeRequestId.current
      const key = `${n.source}:${n.id}`
      if (!readIds.includes(key)) {
        const next = [...readIds, key]
        setReadIds(next)
        lsSet(READ_KEY, next)
      }
      setModal({ kind: 'notice', item: n })
      if (demoModeRef.current) {
        setNoticeBodyState({ loading: false, body: getDemoNoticeBody(n) })
        return
      }
      setNoticeBodyState({ loading: true, body: null })
      const body = await data.noticeBody(n).catch(() => null)
      if (requestId !== noticeRequestId.current) return
      if (body?.diagnostics?.length) {
        // 只记录域名、页面类型和结果，不记录 Cookie、完整 URL 或个人信息。
        console.info('[notice-diagnostic]', JSON.stringify(body.diagnostics))
      }
      setNoticeBodyState({
        loading: false,
        body: body || { text: '', failure: 'network', error: '网络连接失败，请重新加载。', sourceUrl: n.url }
      })
    },
    [readIds]
  )

  const markAllNoticesRead = useCallback(() => {
    if (!visibleNotices.length) return
    const next = Array.from(new Set([...readIds, ...visibleNotices.map((n) => `${n.source}:${n.id}`)]))
    setReadIds(next)
    lsSet(READ_KEY, next)
    toast('已将全部通知标为已读')
  }, [visibleNotices, readIds, toast])

  useEffect(() => {
    if (modal?.kind !== 'notice') noticeRequestId.current += 1
  }, [modal])

  const go = (t: Tab) => {
    setSub(null)
    setTab(t)
    window.scrollTo({ top: 0 })
  }

  /* ---------------- 演示模式与首次引导分流 ---------------- */
  const applyDemoBundle = useCallback(() => {
    const demo = buildDemoBundle()
    setStatus(demo.status)
    setTable(demo.table)
    setExams(demo.exams)
    setNotices(demo.notices)
    setNoticesStale(false)
    setNoticesAuthRequired(false)
    setChargers(demo.chargers)
    setCard(demo.card)
    setAirconRoom(demo.airconRoom)
    setAirconResult(demo.airconResult)
    setChaoxingDash(buildDemoChaoxingDashboard())
    setCourseError('')
  }, [])

  const exitDemoState = useCallback(() => {
    demoModeRef.current = false
    setDemoMode(false)
    setDemoModeFlag(false)
    setShowDemoTip(false)
    setTable(null)
    setExams([])
    setNotices([])
    setChargers(null)
    setCard(null)
    setAirconRoom(null)
    setAirconResult(null)
    dormRequest.current += 1
    setDormRoom(null)
    setDormResult(null)
    setChaoxingDash(readChaoxingSnapshot())
    setStatus(null)
    setCourseError('')
    fpRef.current = {}
    syncTimesRef.current = { academic: 0, notices: 0, card: 0, chargers: 0, aircon: 0, dorm: 0 }
  }, [])

  /* ---------------- 学习通仪表盘 ---------------- */
  const refreshChaoxing = useCallback(async (opts?: { force?: boolean }) => {
    if (demoModeRef.current) {
      if (opts?.force) toast('当前为演示模式，登录学习通后可同步真实任务')
      return
    }
    if (!supportsChaoxing() || chaoxingSigningIn.current) return
    if (!opts?.force && chaoxingFetchedAtRef.current && Date.now() - chaoxingFetchedAtRef.current < SWR_FAST_TTL_MS) {
      return
    }
    const session = chaoxingSession.current
    setChaoxingLoading(true)
    try {
      const res = await data.chaoxingDashboard()
      if (session === chaoxingSession.current && !demoModeRef.current && res) {
        setChaoxingDash(res)
        if (res.loggedIn && !res.stale && !res.error) chaoxingFetchedAtRef.current = Date.now()
      }
    } finally {
      if (session === chaoxingSession.current) {
        setChaoxingReady(true)
        setChaoxingLoading(false)
      }
    }
  }, [toast])
  refreshChaoxingRef.current = refreshChaoxing

  const loginChaoxing = useCallback(async (opts?: { manual?: boolean }) => {
    if (!opts?.manual && supportsNativeAuth()) {
      setModal({ kind: 'chaoxingLogin' })
      return
    }
    if (!supportsChaoxing()) {
      toast('仅 Android 客户端支持内嵌登录学习通')
      return
    }
    // 从原生登录页切换至手动网页登录时，可能上一轮刚 abort 的 nativeAuth 尚未落完 finally，此处强制接管
    if (chaoxingSigningIn.current && !opts?.manual) return
    chaoxingSigningIn.current = true
    const session = ++chaoxingSession.current
    chaoxingFetchedAtRef.current = 0
    resetChaoxingCourses()
    if (!demoModeRef.current) setChaoxingDash(null)
    setChaoxingLoading(true)
    toast('请在弹出窗口中登录超星学习通')
    try {
      const res = await data.chaoxingLogin()
      if (session !== chaoxingSession.current) return
      if (res?.loggedIn) {
        if (demoModeRef.current) {
          exitDemoState()
        }
        toast('学习通已登录，正在汇总作业与考试')
        chaoxingFetchedAtRef.current = 0
        const dash = await data.chaoxingDashboard()
        if (dash && session === chaoxingSession.current) {
          setChaoxingDash(dash)
          if (dash.loggedIn && !dash.stale && !dash.error) chaoxingFetchedAtRef.current = Date.now()
        }
      } else {
        toast('未完成学习通登录')
      }
    } catch (e: any) {
      toast(`学习通登录异常：${e?.message || '请重试'}`)
    } finally {
      chaoxingSigningIn.current = false
      if (session === chaoxingSession.current) {
        setChaoxingReady(true)
        setChaoxingLoading(false)
      }
    }
  }, [exitDemoState, resetChaoxingCourses, toast])

  function clearChaoxingState() {
    chaoxingSession.current += 1
    chaoxingFetchedAtRef.current = 0
    setChaoxingLoading(false)
    setChaoxingReady(false)
    resetChaoxingCourses()
    if (!demoModeRef.current) setChaoxingDash(null)
  }

  const openChaoxingItem = useCallback((url: string, title: string) => {
    if (demoModeRef.current) {
      toast('演示模式示例条目，登录学习通后可直接打开原任务页')
      return
    }
    if (!url) return
    void data.openInApp(url, title || '学习通任务')
  }, [toast])

  const launchChaoxingApp = useCallback(async () => {
    const res = await data.launchApp('com.chaoxing.mobile')
    if (!res.launched) {
      toast('未检测到「学习通」App，请先安装后再试')
    }
  }, [toast])

  useEffect(() => {
    if (onboardingOpen || demoMode || sub || tab !== 'dashboard') return
    void refreshChaoxing({ force: false })
  }, [onboardingOpen, demoMode, sub, tab, refreshChaoxing])

  const dismissDemoTip = useCallback(() => {
    setShowDemoTip(false)
    dismissDemoTipFlag()
  }, [])

  /* ---------------- 登录（首页提示条 / 课表空状态 / 我的页共用同一套） ---------------- */
  const loginRunning = useRef(false)
  const nativeAttempt = useRef<AbortSignal | null>(null)
  const loginSchool = useCallback(async (options?: SchoolLogin) => {
    if (loginRunning.current) return undefined
    loginRunning.current = true
    setSyncStage('logging_in')
    const wasDemo = demoModeRef.current
    const prevName = wasDemo ? '' : (status?.studentName || '')
    toast('正在验证登录，完成后会自动同步')
    try {
      const st = await data.login(options)
      if (st?.loggedIn) {
        if (wasDemo) {
          exitDemoState()
        } else if (options?.username || (prevName && st.studentName && prevName !== st.studentName)) {
          dormRequest.current += 1
          setTable(null)
          setExams([])
          setCard(null)
          setDormResult(null)
          syncTimesRef.current.dorm = 0
          setCourseError('')
        }
        setStatus(st)
        setSyncStage('academic')
        toast(options?.remember && !st.credentialSaved ? '已登录，凭据未保存，正在同步' : '已登录，正在同步课表与通知')
        void refreshAll({ force: true, knownStatus: st })
        void refreshAircon({ silent: true })
        void refreshDorm({ silent: true })
        return st
      }
      setSyncStage('')
      if (st && !wasDemo) setStatus(st)
      const where = (/url=(\S+)/.exec(st?.hint || '') || [])[1] || ''
      const host = where ? where.replace(/^https?:\/\//, '').split(/[/?#]/)[0] : ''
      toast(host ? `还没登录成功（停在 ${host}），请再试一次` : '登录未完成或已取消，请再试一次')
      return st || undefined
    } catch (e: any) {
      setSyncStage('')
      toast(`登录异常：${e?.message || '请稍后重试'}`)
      return undefined
    } finally {
      loginRunning.current = false
    }
  }, [exitDemoState, refreshAircon, refreshAll, status?.studentName, toast])

  const onLoginTap = useCallback(() => {
    if (loginRunning.current) return
    if (supportsNativeAuth()) setModal({ kind: 'schoolLogin' })
    else void loginSchool()
  }, [loginSchool])

  const authenticate = useCallback(async (request: AuthRequest, options: AuthOptions) => {
    const school = request.platform === 'school'
    const signingIn = school ? loginRunning : chaoxingSigningIn
    nativeAttempt.current = options.signal
    signingIn.current = true
    if (school) {
      schoolSession.current += 1
      pendingRefreshOptsRef.current = null
    } else {
      chaoxingSession.current += 1
      chaoxingFetchedAtRef.current = 0
      resetChaoxingCourses()
      if (!demoModeRef.current) setChaoxingDash(null)
      setChaoxingLoading(true)
    }
    try {
      const result = await data.nativeAuth(request, options)
      if (options.signal.aborted || !result.ok) return result
      if (demoModeRef.current) exitDemoState()
      if (result.platform === 'school') {
        dormRequest.current += 1
        setDormResult(null)
        syncTimesRef.current.dorm = 0
        setStatus(result.session)
        setCourseError('')
        void refreshAll({ force: true, knownStatus: result.session })
        void refreshAircon({ silent: true })
        void refreshDorm({ silent: true })
        if (school && request.remember && !result.session.credentialSaved) toast('已登录，凭据未保存')
      } else {
        setChaoxingDash(result.dashboard)
        chaoxingFetchedAtRef.current = Date.now()
      }
      return result
    } finally {
      if (nativeAttempt.current === options.signal) {
        if (!school) {
          setChaoxingReady(true)
          setChaoxingLoading(false)
        }
        signingIn.current = false
      }
    }
  }, [exitDemoState, refreshAll, refreshAircon, resetChaoxingCourses, toast])

  const handleOnboardingBind = useCallback(() => {
    markOnboardingCompleted()
    const isReplay = onboardingReplay
    setOnboardingOpen(false)
    setOnboardingReplay(false)
    if (!isReplay) {
      demoModeRef.current = false
      setDemoMode(false)
      setDemoModeFlag(false)
      setShowDemoTip(false)
    }
    setTab('home')
    setSub(null)
    onLoginTap()
  }, [onboardingReplay, onLoginTap])

  const handleOnboardingDemo = useCallback(() => {
    markOnboardingCompleted()
    const isReplay = onboardingReplay
    setOnboardingOpen(false)
    setOnboardingReplay(false)
    if (isReplay) return
    demoModeRef.current = true
    setDemoMode(true)
    setDemoModeFlag(true)
    setShowDemoTip(true)
    applyDemoBundle()
    setTab('home')
    setSub(null)
  }, [onboardingReplay, applyDemoBundle])

  const handleOnboardingSkip = useCallback(() => {
    if (onboardingReplay) {
      markOnboardingCompleted()
      setOnboardingOpen(false)
      setOnboardingReplay(false)
      return
    }
    handleOnboardingDemo()
  }, [onboardingReplay, handleOnboardingDemo])

  const replayOnboarding = useCallback(() => {
    setOnboardingStep(0)
    setOnboardingReplay(true)
    setOnboardingOpen(true)
  }, [])

  /* ---------------- 弹窗内容 ---------------- */
  const courseSess = modal?.kind === 'course'
    ? ((!sub && tab === 'home' ? todaySessions : sessions).find((s) => s.id === modal.id) ??
        sessions.find((s) => s.id === modal.id) ??
        null)
    : null
  const conflictItems =
    modal?.kind === 'conflict' && modal.id
      ? sessions.filter((s) => s.id === modal.id || s.conflictIds.includes(modal.id as string))
      : null

  const renderModal = () => {
    if (!modal) return null
    if (modal.kind === 'collegeSubscriptions') {
      const { draft } = modal
      const colleges = isNativePlatform() || demoMode
        ? COLLEGES
        : COLLEGES.filter(({ id }) => id === 'cl' || subscribedColleges.includes(id))
      return (
        <Modal title="学院通知订阅" onClose={() => setModal(null)}>
          <p>已选 {draft.length} / {MAX_SUBSCRIBED_COLLEGES}</p>
          <div className="filterbar" style={{ flexWrap: 'wrap' }}>
            {colleges.map(({ id, shortName, fullName }) => {
              const selected = draft.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`chip${selected ? ' selected' : ''}`}
                  title={fullName}
                  aria-pressed={selected}
                  disabled={!selected && draft.length >= MAX_SUBSCRIBED_COLLEGES}
                  onClick={() => setModal({
                    kind: 'collegeSubscriptions',
                    draft: selected ? draft.filter((item) => item !== id) : [...draft, id]
                  })}
                >
                  {shortName}
                </button>
              )
            })}
          </div>
          <button type="button" className="mark-all-btn" onClick={() => {
            if (draft.join(',') !== subscribedColleges.join(',')) handleChangeSubscribedColleges(draft)
            setModal(null)
          }}>
            保存订阅
          </button>
        </Modal>
      )
    }
    if (modal.kind === 'aircon') {
      const openWoIHaust = async () => {
        const res = await data.launchApp('com.lantu.MobileCampus.haust')
        if (res.launched) {
          setModal(null)
        } else {
          toast('未检测到「我i科大」App，请先安装后再打开')
        }
      }
      return (
        <Modal title={airconRoom ? '更改绑定宿舍' : '绑定宿舍'} onClose={() => setModal(null)}>
          <DormBinding room={airconRoom} onSave={saveAirconBinding} />
          {isNativePlatform() ? (
            <button
              className="softbtn"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => void openWoIHaust()}
            >
              打开「我i科大」充值电费
            </button>
          ) : null}
        </Modal>
      )
    }
    if (modal.kind === 'dorm') {
      const openWoIHaust = async () => {
        const res = await data.launchApp('com.lantu.MobileCampus.haust')
        if (res.launched) {
          setModal(null)
        } else {
          toast('未检测到「我i科大」App，请先安装后再打开')
        }
      }
      return (
        <Modal title={dormRoom ? '更改宿舍电费房间' : '绑定宿舍电费房间'} onClose={() => setModal(null)}>
          <DormElecBinding
            room={dormRoom}
            onSave={saveDormBinding}
            onLogin={() => {
              setModal(null)
              onLoginTap()
            }}
          />
          {isNativePlatform() ? (
            <button
              className="softbtn"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => void openWoIHaust()}
            >
              打开「我i科大」充值宿舍电费
            </button>
          ) : null}
        </Modal>
      )
    }
    if (modal.kind === 'schoolLogin' || modal.kind === 'chaoxingLogin') {
      const school = modal.kind === 'schoolLogin'
      const notice = modal.kind === 'schoolLogin' ? modal.returnToNotice : undefined
      const close = () => setModal(notice ? { kind: 'notice', item: notice } : null)
      return (
        <NativeLogin
          key={modal.kind}
          platform={school ? 'school' : 'chaoxing'}
          authenticate={authenticate}
          onClose={close}
          onSuccess={() => {
            if (notice) void openNotice(notice)
            else close()
          }}
          onManualLogin={school ? () => {
            close()
            void loginSchool().then((session) => { if (notice && session?.loggedIn) void openNotice(notice) })
          } : () => {
            close()
            void loginChaoxing({ manual: true })
          }}
        />
      )
    }
    if (modal.kind === 'course') {
      if (!courseSess) return null
      const c = courseSess
      return (
        <CourseModal
          course={c}
          week={week}
          conflictsOf={sessions.filter((s) => s.id !== c.id && c.conflictIds.includes(s.id))}
          onClose={() => setModal(null)}
          onConflict={() => setModal({ kind: 'conflict', id: c.id })}
        />
      )
    }
    if (modal.kind === 'conflict') {
      const groups: ConflictGroup[] =
        modal.id && conflictItems && conflictItems.length
          ? [{ day: conflictItems[0].day, start: Math.min(...conflictItems.map((s) => s.start)), end: Math.max(...conflictItems.map((s) => s.end)), items: conflictItems }]
          : conflicts
      return <ConflictModal groups={groups} onClose={() => setModal(null)} onPick={(id) => setModal({ kind: 'course', id })} />
    }
    if (modal.kind === 'notice') {
      const n = modal.item
      const body = noticeBodyState.body
      const openOriginalInApp = () => {
        const url = body?.sourceUrl || n.url
        if (url) void data.openInApp(url, '教务处通知原文')
      }
      return (
        <Modal title="通知正文" onClose={() => { noticeRequestId.current += 1; setModal(null) }}>
          <span className="pill">{n.sourceName}</span>
          <h3>{n.title}</h3>
          <small>
            {n.date ? `${n.date} · 已读` : '已读'}
          </small>
          {body?.mirrored ? <p className="prototype">正文来自校园通知转载，标题已核对；原文来源：教务处。</p> : null}
          {noticeBodyState.loading ? (
            <p className="bodycopy" style={{ marginTop: 22 }}>
              正在读取正文…
            </p>
          ) : body?.error ? (
            <p className="bodycopy" style={{ marginTop: 22 }}>
              {body.error}
            </p>
          ) : (
            <p className="bodycopy" style={{ marginTop: 22 }}>
              {body?.text || (body?.imgs?.length ? '正文以图片形式发布。' : '这条通知没有返回可显示的正文。')}
            </p>
          )}
          {body?.imgs?.map((src, index) => (
            <NoticeImage
              key={`${src}-${index}`}
              src={src}
              alt={`${n.title} 正文图片 ${index + 1}`}
              referer={body?.sourceUrl || n.url}
            />
          ))}
          {body?.attachments?.length ? (
            <div className="detailrows" style={{ marginTop: 14 }}>
              {body.attachments.map((att, index) => (
                <p key={`${att.url}-${index}`}>
                  <span>附件 {index + 1}</span>
                  <button
                    className="link"
                    style={{ textAlign: 'right' }}
                    onClick={() => void (n.source === 'jwc' ? data.openInApp(att.url, att.name || '附件') : data.openExternal(att.url))}
                  >
                    {att.name || '下载附件'}
                  </button>
                </p>
              ))}
            </div>
          ) : null}
          {body?.failure === 'auth' ? (
            <>
              <button className="primary" onClick={() => {
                if (supportsNativeAuth()) setModal({ kind: 'schoolLogin', returnToNotice: n })
                else void loginSchool().then((session) => { if (session?.loggedIn) void openNotice(n) })
              }}>登录科大 VPN 后重试</button>
              <button className="softbtn" onClick={() => void openNotice(n)}>重新加载</button>
            </>
          ) : body?.failure === 'network' ? (
            <button className="primary" onClick={() => void openNotice(n)}>重新加载</button>
          ) : body?.failure === 'parse' ? (
            <button className="primary" onClick={n.source === 'jwc' ? openOriginalInApp : () => { if (n.url) void data.openExternal(n.url) }}>
              {n.source === 'jwc' ? '在应用内打开原文' : '打开原文'}
            </button>
          ) : (
            <button className="primary" onClick={() => { if (n.url) void data.openExternal(n.url) }}>打开原文</button>
          )}
        </Modal>
      )
    }
    if (modal.kind === 'theme') return <ThemeModal theme={theme} onChange={setTheme} onClose={() => setModal(null)} />
    if (modal.kind === 'about') return <AboutModal connected={isConnected()} onClose={() => setModal(null)} />
    if (modal.kind === 'logoutChaoxing') {
      return (
        <Modal title="退出学习通" onClose={() => setModal(null)}>
          <p className="bodycopy">
            退出后将仅清除学习通的登录会话、Cookie、已保存凭据和本地任务缓存，避免考试期间触发多端检测。
          </p>
          <p className="bodycopy" style={{ marginTop: 6, color: 'var(--muted)' }}>
            教务课表、考试安排、空调/宿舍电费和校园卡的登录态将完整保留。
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="button" className="softbtn" style={{ flex: 1 }} onClick={() => setModal(null)}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              style={{ flex: 1, background: 'var(--danger)' }}
              onClick={async () => {
                setModal(null)
                const ok = await data.clearChaoxing()
                clearChaoxingState()
                if (ok) toast('已退出学习通，教务与电费登录态已保留')
                else toast('已清理本地学习通缓存，部分 Cookie 清理失败请重试')
              }}
            >
              确认退出
            </button>
          </div>
        </Modal>
      )
    }
    if (modal.kind === 'updateSettings') {
      return (
        <UpdateSettingsModal
          settings={updateSettings}
          currentVersion={appVersion}
          checking={updateChecking}
          statusHint={updateStatusHint}
          hasUpdate={!!availableUpdate}
          onChange={(next) => {
            const saved = writeUpdateSettings(next)
            setUpdateSettings(saved)
            setUpdateStatusHint('')
          }}
          onCheckNow={() => void runUpdateCheck({ silent: false })}
          onOpenAvailable={() => setModal({ kind: 'updateAvailable' })}
          onClose={() => setModal(null)}
        />
      )
    }
    if (modal.kind === 'updateAvailable' && availableUpdate) {
      return (
        <UpdateAvailableModal
          currentVersion={appVersion}
          release={availableUpdate}
          onIgnore={(versionName) => {
            const saved = writeUpdateSettings({ ...updateSettings, ignoredVersion: versionName })
            setUpdateSettings(saved)
            toast(`已忽略 v${versionName} 的提醒`)
          }}
          onClose={() => setModal(null)}
        />
      )
    }
    return null
  }

  /* ---------------- 渲染 ---------------- */
  const navButtons = NAV.map(([t, label, icon]) => (
    <button
      key={t}
      className={!sub && tab === t ? 'active' : ''}
      onClick={() => {
        if (tab !== t || sub) haptic('light')
        go(t)
      }}
      aria-current={!sub && tab === t ? 'page' : undefined}
    >
      <span className="navicon">
        <Icon name={icon} />
      </span>
      {label}
    </button>
  ))

  const body = (() => {
    if (tab === 'notices' && !sub)
      return (
        <NoticesPage
          items={visibleNotices}
          readIds={readIds}
          stale={noticesStale}
          authRequired={noticesAuthRequired && !demoMode}
          refreshing={refreshing}
          subscribedColleges={subscribedColleges}
          onChangeSubscribedColleges={handleChangeSubscribedColleges}
          onRefresh={manualRefresh}
          onBack={() => go('home')}
          onOpen={openNotice}
          onMarkAllRead={markAllNoticesRead}
          onLogin={onLoginTap}
        />
      )
    if (sub === 'chargers')
      return chView ? (
        <ChargersPage view={chView} refreshing={refreshing} onRefresh={manualRefresh} onBack={() => setSub(null)} />
      ) : (
        <>
          <PageHeader
            title="充电桩"
            sub="暂无数据"
            eyebrow="CHARGING PILES"
            refreshing={refreshing}
            onRefresh={manualRefresh}
            onBack={() => setSub(null)}
          />
          <Empty title="暂无充电桩数据" sub="请检查网络连接后点击刷新重试。" icon="bolt">
            <button className="softbtn" style={{ marginTop: 14 }} onClick={manualRefresh} disabled={refreshing}>
              <Icon name="refresh" /> {refreshing ? '刷新中…' : '立即刷新'}
            </button>
          </Empty>
        </>
      )
    if (sub === 'card')
      return <CardPage view={cdView} refreshing={refreshing} onRefresh={manualRefresh} onBack={() => setSub(null)} />
    if (sub === 'exam')
      return <ExamPage exams={examList} refreshing={refreshing} onRefresh={manualRefresh} onBack={() => setSub(null)} />
    if (sub === 'schedule')
      return (
        <Schedule
          week={week}
          view={view}
          day={day}
          todayWeekday={todayWd}
          isCurrentWeek={week === currentWeek}
          dateLabel={dateLabel}
          dateFull={dateFull}
          sessions={sessions}
          conflicts={conflicts}
          refreshing={refreshing}
          onRefresh={manualRefresh}
          onBack={() => setSub(null)}
          onWeek={(d) => setWeek((w) => Math.min(20, Math.max(1, w + d)))}
          onSelectWeek={(w) => setWeek(Math.min(20, Math.max(1, w)))}
          onReset={() => {
            setWeek(currentWeek)
            setDay(todayWd)
          }}
          onView={(v) => {
            setView(v)
            lsSet(VIEW_KEY, v)
          }}
          onDay={setDay}
          onCourse={(id) => setModal({ kind: 'course', id })}
          onConflict={() => setModal({ kind: 'conflict' })}
          loggedIn={!!status?.loggedIn}
          hasTable={hasTable}
          courseError={courseError}
          onLogin={onLoginTap}
        />
      )

    const initialSkeleton =
      !demoMode && !syncStage && refreshing && !status?.loggedIn && !table && !notices.length && !chargers && !card && !airconRoom

    const syncBannerText =
      syncStage === 'logging_in'
        ? '正在验证校园账号登录…'
        : syncStage === 'academic'
          ? `已登录${status?.studentName ? `（${status.studentName}）` : ''} · 正在同步课表与考试…`
          : syncStage === 'notices'
            ? '已登录 · 正在同步校园通知…'
            : syncStage === 'services'
              ? '已登录 · 正在同步校园卡与充电桩…'
              : ''

    if (tab === 'home')
      return (
        <Home
          dateText={dateText}
          dayText={dayText}
          week={currentWeek}
          todaySessions={todaySessions}
          exam={nextExam}
          refreshing={refreshing || !!syncStage}
          syncMessage={syncBannerText}
          initialSkeleton={initialSkeleton}
          demoMode={demoMode}
          showDemoTip={showDemoTip}
          onDismissDemoTip={dismissDemoTip}
          swrCards={swrCards}
          ripples={ripples}
          onRefresh={manualRefresh}
          onOpenNotices={() => go('notices')}
          onOpenNotice={openNotice}
          unreadNotices={unreadNotices}
          noticeTitles={latestNoticeTitles}
          chargers={chView}
          card={cdView}
          room={airconRoom}
          electricity={airconResult}
          dormRoom={dormRoom}
          dormElectricity={dormResult}
          onOpenChargers={() => setSub('chargers')}
          onOpenCard={() => setSub('card')}
          onBindRoom={() => {
            if (demoMode) {
              toast('请先登录校园账号，再绑定你的真实宿舍')
              onLoginTap()
              return
            }
            setModal({ kind: 'aircon' })
          }}
          onBindDormRoom={supportsDormElectricity() ? () => {
            if (demoMode) {
              toast('请先登录校园账号，再绑定你的真实宿舍')
              onLoginTap()
              return
            }
            setModal({ kind: 'dorm' })
          } : undefined}
          noticeUnread={unread}
          onOpenSchedule={() => setSub('schedule')}
          onExam={() => setSub('exam')}
          loggedIn={!!status?.loggedIn}
          hasTable={hasTable}
          courseError={courseError}
          onLogin={onLoginTap}
        />
      )
    if (tab === 'dashboard')
      return (
        <Dashboard
          dashboard={chaoxingDash}
          loading={chaoxingLoading || (!demoMode && supportsChaoxing() && !chaoxingReady)}
          courseData={chaoxingCourseData}
          demoMode={demoMode}
          supported={supportsChaoxing()}
          onRefresh={() => void refreshChaoxing({ force: true })}
          onLogin={() => void loginChaoxing()}
          onLogout={() => setModal({ kind: 'logoutChaoxing' })}
          onOpenItem={openChaoxingItem}
          onLaunchApp={() => void launchChaoxingApp()}
        />
      )
    return (
      <Profile
        status={status}
        week={week}
        term={table?.term || ''}
        theme={theme}
        lastSync={lastSync}
        refreshing={refreshing || !!syncStage}
        syncMessage={syncBannerText}
        demoMode={demoMode}
        onRefresh={manualRefresh}
        onLogin={onLoginTap}
        onReplayOnboarding={replayOnboarding}
        chaoxingSupported={supportsChaoxing()}
        chaoxingLoggedIn={!!chaoxingDash?.loggedIn && !demoMode}
        onLogoutChaoxing={() => setModal({ kind: 'logoutChaoxing' })}
        onOpenExternal={(url) => void data.openExternal(url)}
        onClearCache={async () => {
          await data.clearCache()
          clearChaoxingState()
          clearHomeSnapshot()
          if (!demoMode) {
            setTable(null)
            setExams([])
            setNotices([])
            setChargers(null)
            setCard(null)
            setCourseError('')
          }
          toast('已清除本地业务缓存')
        }}
        onClearCred={async () => {
          if (!(await data.clearCred())) {
            toast('清除登录凭据失败，请重试')
            return
          }
          schoolSession.current += 1
          dormRequest.current += 1
          await data.clearCache()
          clearChaoxingState()
          clearHomeSnapshot()
          setTable(null)
          setExams([])
          setCard(null)
          setDormResult(null)
          syncTimesRef.current.dorm = 0
          setCourseError('')
          setStatus(null)
          toast('已清除登录凭据与账号缓存')
        }}
        onOpenTheme={() => setModal({ kind: 'theme' })}
        onChangeTheme={(t) => {
          setTheme(t)
          toast(`已切换到${{ light: '浅色', dark: '深色', system: '跟随系统' }[t]}模式`)
        }}
        onOpenAbout={() => setModal({ kind: 'about' })}
        onOpenUpdateSettings={() => {
          setUpdateStatusHint('')
          setImmersiveUpdateOpen(true)
        }}
        onToast={toast}
        subPage={profileSubPage}
        onSubPageChange={setProfileSubPage}
        appVersionName={appVersion.versionName}
        hasUpdate={!!availableUpdate}
      />
    )
  })()

  if (onboardingOpen) {
    return (
      <>
        <Onboarding
          step={onboardingStep}
          replayMode={onboardingReplay}
          theme={theme}
          onChangeTheme={setTheme}
          subscribedColleges={subscribedColleges}
          onChangeSubscribedColleges={(ids) => setSubscribedColleges(writeSubscribedColleges(ids))}
          onStepChange={setOnboardingStep}
          onBindAccount={handleOnboardingBind}
          onStartDemo={handleOnboardingDemo}
          onSkip={handleOnboardingSkip}
        />
        {toastMsg ? <div className="toast" role="status" aria-live="polite">{toastMsg}</div> : null}
      </>
    )
  }

  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="cat">
              <Icon name="cat" />
            </div>
            <div>
              <b>科小喵</b>
              <small>CAMPUS COMPANION</small>
            </div>
          </div>
          <nav>{navButtons}</nav>
          <div className="sidefoot">
            河南科技大学 · 校园助手
            <br />
            让每一天，井然有序。
            <br />
            <br />
            {isConnected() ? '已连接本机数据服务' : '未连接数据服务'}
          </div>
        </aside>
        <main className={`content${sub === 'schedule' ? ' schedule-page' : ''}`} id="content">
          <PullToRefresh
            disabled={!!modal || !!sub || tab === 'profile'}
            refreshing={tab === 'dashboard' ? chaoxingLoading : refreshing}
            onRefresh={() => (tab === 'dashboard' ? refreshChaoxing({ force: true }) : manualRefresh())}
          >
            <div className="page" key={`${sub || tab}-${week}-${view}-${day}`}>
              {body}
            </div>
          </PullToRefresh>
        </main>
      </div>
      <nav className={`mobile-nav${sub || (tab === 'profile' && profileSubPage !== 'root') ? ' in-sub' : ''}`} aria-label="主导航">
        <span
          className="mobile-nav-pill"
          aria-hidden="true"
          style={{
            transform: `translate3d(${Math.max(0, NAV.findIndex(([t]) => t === tab)) * 100}%, 0, 0)`
          }}
        />
        {navButtons}
      </nav>
      {renderModal()}
      <ImmersiveUpdateView
        open={immersiveUpdateOpen}
        settings={updateSettings}
        currentVersion={appVersion}
        release={availableUpdate}
        checking={updateChecking}
        statusHint={updateStatusHint}
        onChangeSettings={(next) => {
          const saved = writeUpdateSettings(next)
          setUpdateSettings(saved)
          setUpdateStatusHint('')
        }}
        onCheckNow={() => void runUpdateCheck({ silent: false })}
        onIgnore={(versionName) => {
          const saved = writeUpdateSettings({ ...updateSettings, ignoredVersion: versionName })
          setUpdateSettings(saved)
          toast(`已忽略 v${versionName} 的提醒`)
        }}
        onOpenExternal={(url) => void data.openExternal(url)}
        onClose={() => setImmersiveUpdateOpen(false)}
        backHandlerRef={immersiveUpdateBackRef}
      />
      {toastMsg ? <div className="toast" role="status" aria-live="polite">{toastMsg}</div> : null}
    </>
  )
}
