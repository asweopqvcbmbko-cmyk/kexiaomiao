/**
 * 仅在开发环境（import.meta.env.DEV）且 URL 带 ?preview=1 时加载的离线 UI 预览门面。
 * 供 PC 浏览器零登录预览首页、课表、考试倒计时、空调卡片与通知「全部已读」，绝不进入生产包。
 */
import type {
  AirconRoom,
  AuthOptions,
  AuthRequest,
  AuthResult,
  CardInfo,
  ChargerData,
  CourseTable,
  Exam,
  NoticeBody,
  NoticeItem,
  SessionStatus
} from './types'
import { buildDemoChaoxingCourses, buildDemoChaoxingDashboard } from './demoData'

const PREVIEW_CAPTCHA_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="48"><rect width="140" height="48" rx="8" fill="#1e293b"/><text x="70" y="32" text-anchor="middle" font-family="monospace" font-size="22" font-weight="700" letter-spacing="4" fill="#38bdf8">K7M4</text><path d="M12 36 Q70 8 128 28" stroke="#f59e0b" stroke-width="2" fill="none" opacity="0.65"/></svg>'
)}`
const PREVIEW_QR_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="#fff"/><g fill="#0f172a"><rect x="16" y="16" width="44" height="44" rx="6"/><rect x="24" y="24" width="28" height="28" fill="#fff"/><rect x="30" y="30" width="16" height="16"/><rect x="120" y="16" width="44" height="44" rx="6"/><rect x="128" y="24" width="28" height="28" fill="#fff"/><rect x="134" y="30" width="16" height="16"/><rect x="16" y="120" width="44" height="44" rx="6"/><rect x="24" y="128" width="28" height="28" fill="#fff"/><rect x="30" y="134" width="16" height="16"/><rect x="76" y="24" width="12" height="12"/><rect x="96" y="40" width="12" height="12"/><rect x="76" y="68" width="28" height="28" rx="4"/><rect x="116" y="76" width="16" height="16"/><rect x="144" y="84" width="16" height="16"/><rect x="76" y="112" width="16" height="16"/><rect x="104" y="120" width="24" height="24"/><rect x="140" y="128" width="20" height="20"/></g></svg>'
)}`

function previewWait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(id)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const today = new Date()
const todayWd = today.getDay() === 0 ? 7 : today.getDay()
const plusDays = (n: number) => {
  const d = new Date(today)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PREVIEW_ROOM: AirconRoom = {
  campus: '开元校区',
  areaId: '1',
  buildId: '12',
  buildName: '嘉园12号楼',
  levelId: '3',
  roomVerify: '1-12---preview',
  roomName: '318室'
}

const PREVIEW_SESSION: SessionStatus = {
  loggedIn: true,
  verified: true,
  checkedAt: today.toISOString(),
  studentName: '预览同学',
  currentWeek: 12
}

const PREVIEW_COURSES: CourseTable = {
  fetchedAt: today.toISOString(),
  term: '2026-2027学年1学期',
  courses: [
    {
      no: '01',
      code: 'MATH101',
      name: '高等数学（上）',
      teacher: '张老师',
      credits: '5.0',
      hours: '80',
      weeks: '1-16',
      attendees: '120',
      category: '公共基础',
      examType: '考试',
      slots: [
        { weeks: '1-16', weekday: todayWd, periods: [1, 2], room: '开元公教2-201' },
        { weeks: '1-16', weekday: ((todayWd + 1) % 7) + 1, periods: [3, 4], room: '开元公教2-201' }
      ]
    },
    {
      no: '02',
      code: 'CS204',
      name: '数据结构与算法',
      teacher: '李老师',
      credits: '4.0',
      hours: '64',
      weeks: '1-16',
      attendees: '90',
      category: '专业必修',
      examType: '考试',
      slots: [{ weeks: '1-16', weekday: todayWd, periods: [5, 6], room: '工科2-405' }]
    },
    {
      no: '03',
      code: 'ME108',
      name: '工程力学',
      teacher: '王老师',
      credits: '3.5',
      hours: '56',
      weeks: '1-16',
      attendees: '85',
      category: '学科基础',
      examType: '考试',
      slots: [{ weeks: '1-16', weekday: todayWd, periods: [7, 8], room: '工科1-302' }]
    }
  ],
  labs: [],
  practice: []
}

const PREVIEW_EXAMS: Exam[] = [
  {
    batch: '期末考试',
    code: 'CS204',
    name: '数据结构与算法',
    type: '闭卷',
    date: plusDays(6),
    time: '09:00-11:00',
    room: '开元公教3-305',
    seat: '18',
    status: '正常',
    note: ''
  },
  {
    batch: '期末考试',
    code: 'MATH101',
    name: '高等数学（上）',
    type: '闭卷',
    date: plusDays(18),
    time: '14:30-16:30',
    room: '开元公教2-101',
    seat: '07',
    status: '正常',
    note: ''
  }
]

const PREVIEW_NOTICES: NoticeItem[] = [
  {
    source: 'jwc',
    sourceName: '教务处',
    id: 'preview-1',
    title: '关于2026-2027学年第一学期期末考试安排的通知',
    date: plusDays(0),
    dept: '教务处',
    url: 'https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm'
  },
  {
    source: 'school',
    sourceName: '全校通知',
    id: 'preview-2',
    title: '关于冬季供暖与校园安全巡查的通知',
    date: plusDays(-1),
    dept: '校长办公室',
    url: 'https://www-haust-edu-cn-s.haust.edu.cn/'
  },
  {
    source: 'news',
    sourceName: '校园新闻',
    id: 'preview-3',
    title: '我校学子在全国大学生学科竞赛中喜获佳绩',
    date: plusDays(-2),
    dept: '党委宣传部',
    url: 'https://www-haust-edu-cn-s.haust.edu.cn/'
  },
  {
    source: 'cl',
    sourceName: '材料学院',
    id: 'preview-4',
    title: '材料科学与工程学院学术报告预告',
    date: plusDays(-3),
    dept: '材料科学与工程学院',
    url: 'https://cl.haust.edu.cn/index/tzgg.htm'
  }
]

const PREVIEW_CHARGERS: ChargerData = {
  fetchedAt: today.toISOString(),
  anchor: { name: '开元校区', lat: 34.602, lng: 112.42 },
  rows: [
    { area: '嘉园', display: '嘉园4号楼', raw: '嘉园4号楼', devices: 'D1', deviceCount: 2, points: 2, total: 20, free: 11, charging: 9, distance: 120 },
    { area: '菁园', display: '菁园1号楼', raw: '菁园1号楼', devices: 'D2', deviceCount: 2, points: 2, total: 20, free: 6, charging: 14, distance: 260 }
  ],
  byArea: { 嘉园: { points: 2, devices: 2, total: 20, free: 11 }, 菁园: { points: 2, devices: 2, total: 20, free: 6 } },
  totals: { points: 4, devices: 4, total: 40, free: 17 },
  coverageNote: '离线预览数据'
}

const PREVIEW_CARD: CardInfo = {
  fetchedAt: today.toISOString(),
  balance: '86.40'
}

export function createDevPreviewHaust(): NonNullable<Window['haust']> {
  let room: AirconRoom | null = PREVIEW_ROOM
  return {
    airconElectricity: {
      getRoom: async () => room,
      saveRoom: async (next) => {
        room = next
        return true
      },
      listRooms: async () => ({
        status: 'ok',
        options: [
          { id: '12', name: '嘉园12号楼' },
          { id: '3', name: '3层' },
          { id: '1-12---preview', name: '318室' }
        ]
      }),
      query: async () =>
        room
          ? {
              status: 'ok',
              reading: {
                room,
                balanceYuan: null,
                remainingKwh: 26.5,
                quantityUnit: '度',
                updatedAt: today.toISOString(),
                fetchedAt: today.toISOString()
              }
            }
          : { status: 'room_required' }
    },
    status: async () => PREVIEW_SESSION,
    login: async () => PREVIEW_SESSION,
    nativeAuth: async (request: AuthRequest, options: AuthOptions): Promise<AuthResult> => {
      try {
        if (request.platform === 'chaoxing' && request.mode === 'qr') {
          options.onProgress({ type: 'stage', message: '正在获取学习通登录二维码…' })
          await previewWait(400, options.signal)
          const emitWaiting = () => options.onProgress({
            type: 'qr',
            status: 'waiting',
            dataUrl: PREVIEW_QR_SVG,
            refresh: emitWaiting
          })
          emitWaiting()
          await previewWait(2600, options.signal)
          options.onProgress({ type: 'qr', status: 'scanned', dataUrl: PREVIEW_QR_SVG, refresh: emitWaiting })
          await previewWait(1600, options.signal)
          options.onProgress({ type: 'qr', status: 'confirmed', dataUrl: PREVIEW_QR_SVG, refresh: emitWaiting })
          options.onProgress({ type: 'stage', message: '正在校验学习通会话…' })
          await previewWait(600, options.signal)
          return { ok: true, platform: 'chaoxing', dashboard: buildDemoChaoxingDashboard() }
        }
        if (request.platform === 'chaoxing' && request.mode === 'sms') {
          options.onProgress({ type: 'stage', message: '正在发送短信验证码…' })
          await previewWait(650, options.signal)
          const code = await new Promise<string>((resolve, reject) => {
            if (options.signal.aborted) return reject(options.signal.reason)
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
            options.onProgress({ type: 'sms_sent', retryAt: Date.now() + 60_000, submit: resolve })
          })
          options.onProgress({ type: 'stage', message: '正在校验短信验证码…' })
          await previewWait(700, options.signal)
          if (code === '0000') return { ok: false, reason: 'sms_code', message: '短信验证码错误，请重新输入' }
          return { ok: true, platform: 'chaoxing', dashboard: buildDemoChaoxingDashboard() }
        }
        options.onProgress({
          type: 'stage',
          message: request.platform === 'school' ? '正在连接统一身份认证…' : '正在连接学习通…'
        })
        await previewWait(700, options.signal)
        if (request.password === 'wrong') {
          return { ok: false, reason: 'credentials', message: '用户名或密码错误' }
        }
        if (request.password === 'captcha') {
          const answer = await new Promise<{ text: string } | { refresh: true }>((resolve, reject) => {
            if (options.signal.aborted) return reject(options.signal.reason)
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
            options.onProgress({
              type: 'captcha',
              dataUrl: PREVIEW_CAPTCHA_SVG,
              message: '请输入图片中的验证码（预览演示）',
              respond: resolve
            })
          })
          if ('text' in answer && answer.text.toLowerCase() === 'bad') {
            return { ok: false, reason: 'captcha', message: '图形验证码错误' }
          }
        }
        options.onProgress({
          type: 'stage',
          message: request.platform === 'school' ? '正在校验教务会话…' : '正在校验学习通会话…'
        })
        await previewWait(650, options.signal)
        return request.platform === 'school'
          ? { ok: true, platform: 'school', session: PREVIEW_SESSION }
          : { ok: true, platform: 'chaoxing', dashboard: buildDemoChaoxingDashboard() }
      } catch {
        return { ok: false, reason: 'cancelled', message: '登录已取消' }
      }
    },
    saveImageToGallery: async () => ({ saved: true, message: '预览模式已模拟保存到相册' }),
    chaoxingLogin: async () => ({ loggedIn: true }),
    chaoxingDashboard: async () => buildDemoChaoxingDashboard(),
    chaoxingActivities: async () => buildDemoChaoxingCourses().activities!,
    chaoxingProgress: async () => buildDemoChaoxingCourses().progress!,
    chaoxingCourseCache: () => buildDemoChaoxingCourses(),
    refreshCourses: async () => PREVIEW_COURSES,
    refreshExams: async () => ({ fetchedAt: today.toISOString(), exams: PREVIEW_EXAMS }),
    refreshNotices: async () => ({ fetchedAt: today.toISOString(), items: PREVIEW_NOTICES }),
    refreshChargers: async () => PREVIEW_CHARGERS,
    refreshCard: async () => PREVIEW_CARD,
    noticeBody: async (item: NoticeItem): Promise<NoticeBody> => ({
      title: item.title,
      text: `【离线预览正文】\n\n这是「${item.title}」的本地预览示例正文，用于在不登录学校 CAS 的情况下调试界面排版与交互。`,
      imgs: [],
      date: item.date,
      sourceUrl: item.url
    }),
    cached: async () => ({
      courses: PREVIEW_COURSES,
      exams: { exams: PREVIEW_EXAMS, fetchedAt: today.toISOString() },
      notices: { items: PREVIEW_NOTICES, fetchedAt: today.toISOString() },
      chargers: PREVIEW_CHARGERS,
      card: PREVIEW_CARD,
      session: PREVIEW_SESSION
    }),
    openExternal: async () => true,
    openInApp: async () => true,
    launchApp: async () => ({ launched: true, installed: true }),
    credStatus: async () => ({ saved: true, username: 'preview', encryptionAvailable: true }),
    clearCred: async () => true,
    clearCache: async () => true,
    onSession: () => () => {}
  }
}
