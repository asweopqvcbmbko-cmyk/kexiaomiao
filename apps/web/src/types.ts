type ChaoxingItem = {
  title: string
  course: string
  courseId: string
  status: string
  url: string
}

export type ChaoxingWork = ChaoxingItem & {
  workId: string
  clazzId: string
  leftTime: string
  uncommitted: boolean
}

export type ChaoxingExam = ChaoxingItem & {
  examId: string
  classId: string
  timeLeft: string
  finished: boolean
  expired: boolean
}

export type ChaoxingTodo = (
  | (ChaoxingWork & { kind: 'work' })
  | (ChaoxingExam & { kind: 'exam' })
  | (ChaoxingItem & { kind: 'activity'; activeId: string })
) & {
  minutes: number | null
  urgent: boolean
}

export type ChaoxingCourse = {
  courseId: string
  clazzId: string
  cpi: string
  courseName: string
  teacherName: string
  enc?: string
  pEnc?: string
}

export type ChaoxingActivity = {
  activeId: string
  title: string
  type: string
  status: string
  courseName: string
  courseId: string
  clazzId: string
  ongoing: boolean
  finished: boolean
  endTime?: string
  url: string
}

export type ChaoxingCourseProgress = {
  courseId: string
  clazzId: string
  courseName: string
  teacherName: string
  completedTasks: number
  totalTasks: number
  percent: number | null
  url: string
}

export type ChaoxingSettings = {
  ignoredCourses: string[]
  autoLoadActivities: boolean
  autoLoadProgress: boolean
}

type ChaoxingCourseResult = {
  loggedIn: boolean
  authRequired?: boolean
  stale?: boolean
  courses: ChaoxingCourse[]
  fetchedAt: string
  error?: string
}

export type ChaoxingActivitiesResult = ChaoxingCourseResult & { activities: ChaoxingActivity[] }
export type ChaoxingProgressResult = ChaoxingCourseResult & { progress: ChaoxingCourseProgress[] }

export type ChaoxingDashboard = {
  loggedIn: boolean
  authRequired?: boolean
  stale?: boolean
  error?: 'network' | 'parse'
  works: ChaoxingWork[]
  exams: ChaoxingExam[]
  fetchedAt: string
}

export type Slot = {
  weeks: string
  weekday: number
  periods: number[]
  room: string
}

export type Course = {
  no: string
  code: string
  name: string
  teacher: string
  credits: string
  hours: string
  weeks: string
  attendees: string
  category: string
  examType: string
  slots: Slot[]
}

export type Exam = {
  batch: string
  code: string
  name: string
  type: string
  date: string
  time: string
  room: string
  seat: string
  status: string
  note: string
}

export type CourseTable = {
  fetchedAt: string
  term: string
  courses: Course[]
  labs: Array<Record<string, string>>
  practice: Array<Record<string, string>>
}

export type SchoolLogin = { username: string; password: string; remember: boolean }

export type SessionStatus = {
  credentialSaved?: boolean
  loggedIn: boolean
  checkedAt: string
  url?: string
  studentName?: string
  currentWeek?: number | null
  pending?: boolean
  verified?: boolean
  hint?: string
}

export type CacheInfo = {
  fetchedAt: string | null
}

export type NoticeItem = {
  source: 'school' | 'news' | 'jwc' | 'cl' | (string & {})
  sourceName: string
  id: string
  title: string
  date: string
  dept: string
  url: string
}

export type NoticeBody = {
  title?: string
  text: string
  imgs?: string[]
  attachments?: Array<{ name: string; url: string }>
  date?: string
  url?: string
  sourceUrl?: string
  sourceKind?: string
  mirrored?: boolean
  failure?: 'auth' | 'network' | 'parse' | 'timeout'
  pageType?: string
  diagnostics?: Array<{ domain: string; pageType: string; result: string }>
  error?: string
}

export type CardInfo = {
  fetchedAt: string
  balance: string | null
  context?: string
  stale?: boolean
}

/** 充电桩：一行 = 一个楼栋（同一栋的多个平台点位已聚合） */
export type ChargerRow = {
  area: string
  display: string
  raw: string
  devices: string
  deviceCount: number
  points: number
  total: number
  free: number
  charging: number
  distance: number
  error?: string | null
}

export type ChargerAreaStat = {
  points: number
  devices: number
  total: number
  free: number
}

export type ChargerData = {
  fetchedAt: string
  anchor: { name: string; lat: number; lng: number }
  radius?: number
  rawDevices?: number
  rows: ChargerRow[]
  byArea: Record<string, ChargerAreaStat>
  totals: ChargerAreaStat
  coverageNote: string
  stale?: boolean
  error?: string
  blocked?: boolean
}

// Compatibility for untouched components. The retired service has no data model.
export type { InactiveTaskView as TaskData } from './types/inactive-task-view'
export type { AirconRoom, AirconElectricityReading, AirconElectricityResult, AirconElectricityService } from './types/aircon-electricity'
export type AuthRequest =
  | ({ platform: 'school' } & SchoolLogin)
  | { platform: 'chaoxing'; mode: 'password'; account: string; password: string; remember?: boolean }
  | { platform: 'chaoxing'; mode: 'sms'; account: string }
  | { platform: 'chaoxing'; mode: 'qr' }

export type AuthFailure = {
  reason: 'credentials' | 'locked' | 'captcha' | 'sms_code' | 'rate_limit' | 'timeout' |
    'network' | 'verification' | 'unsupported' | 'cancelled'
  message: string
}

export type CaptchaAnswer = { text: string } | { refresh: true }

export type AuthProgressEvent =
  | { type: 'stage'; message: string }
  | { type: 'captcha'; dataUrl: string; message: string; respond: (answer: CaptchaAnswer) => void }
  | { type: 'risk'; revealed: boolean }
  | { type: 'sms_sent'; retryAt: number; submit: (code: string) => void }
  | { type: 'qr'; status: 'waiting' | 'scanned' | 'confirmed' | 'expired'; dataUrl?: string; refresh: () => void }
  | ({ type: 'failure' } & AuthFailure)

export interface AuthOptions {
  signal: AbortSignal
  onProgress: (event: AuthProgressEvent) => void
}

export type AuthResult =
  | { ok: true; platform: 'school'; session: SessionStatus }
  | { ok: true; platform: 'chaoxing'; dashboard: ChaoxingDashboard }
  | ({ ok: false } & AuthFailure)

export type GalleryResult = { saved: boolean; message?: string }

