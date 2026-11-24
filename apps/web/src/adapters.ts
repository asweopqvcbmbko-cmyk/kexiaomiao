/**
 * 适配层：把主进程抓到的真实数据（教务课表 / 考试 / 通知 / 充电桩 / 校园卡 / 学习通任务）
 * 映射成科小喵原型需要的视图模型。这里不做任何"补数据"——缺什么就让它空着，由界面显示暂无。
 */
import type { CardInfo, ChargerData, Course, CourseTable, Exam, NoticeItem, TaskData } from './types'

export type Cat = 'math' | 'mech' | 'elec' | 'polit' | 'sport'

/** 一节课的"一次上"（同一天、连续节次合并后的一条） */
export type Sess = {
  id: string
  no: string
  name: string
  teacher: string
  room: string
  cat: Cat
  day: number
  start: number
  end: number
  weeks: string
  conflictIds: string[]
}

export type TaskVM = {
  id: string
  key: string
  title: string
  course: string
  kind: 'work' | 'exam' | 'message'
  state: string
  sourceCompleted?: boolean
  dueAt: string | null
  bucket: 'today' | 'soon' | 'none'
  dueLabel: string
  overdue: boolean
  url: string
  activeTypeLabel: string
  sender?: string
  publishedAt?: string | null
}

export type DoneRec = TaskVM & { at: number }

function normalizeTaskPart(value: unknown): string {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

/** Remove changing Chaoxing signatures so a refreshed assignment keeps its local completion mark. */
function stableTaskUrl(value: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (/^(enc|workenc|openc|token|sign|signature|timestamp|_t|random)$/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    return `${url.origin}${url.pathname}${url.search}`
  } catch {
    return value.split('#')[0]
  }
}

/** Stable identity used to reconcile local completion marks with refreshed task rows. */
export function taskIdentityKey(task: Pick<TaskVM, 'kind' | 'course' | 'title' | 'url'>): string {
  const course = normalizeTaskPart(task.course)
  const url = stableTaskUrl(task.url)
  const subject = url || normalizeTaskPart(task.title)
  return `${task.kind}|${course}|${subject}`
}

/**
 * 作息时间：教务课表只给「第几节」，不给钟点。这里用学校官方作息表补上。
 * 学校分两套（按日期自动切换）：
 *   第一套 夏季 05-01 ~ 09-30；第二套 冬季 10-01 ~ 04-30
 * 每套 12 节 + 一节「课间操」（id=0 / isBreak），钟点按校方公布的来。
 */
export type BellPeriod = {
  id: number
  name: string
  section: '上午' | '下午' | '晚上'
  start: string
  end: string
  isBreak?: boolean
}

export type BellTable = {
  key: 'summer' | 'winter'
  name: string
  season: string
  startDate: string
  endDate: string
  periods: BellPeriod[]
}

const period = (
  id: number,
  section: BellPeriod['section'],
  start: string,
  end: string
): BellPeriod => ({ id, name: `第${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][id - 1] || id}节`, section, start, end })

export const BELL_TABLES: Record<'summer' | 'winter', BellTable> = {
  summer: {
    key: 'summer',
    name: '第一套',
    season: '夏季',
    startDate: '05-01',
    endDate: '09-30',
    periods: [
      period(1, '上午', '08:00', '08:45'),
      period(2, '上午', '08:55', '09:40'),
      { id: 0, name: '课间操', section: '上午', start: '09:40', end: '10:00', isBreak: true },
      period(3, '上午', '10:00', '10:45'),
      period(4, '上午', '10:55', '11:40'),
      period(5, '下午', '14:30', '15:15'),
      period(6, '下午', '15:20', '16:05'),
      period(7, '下午', '16:25', '17:10'),
      period(8, '下午', '17:20', '18:05'),
      period(9, '下午', '18:10', '18:55'),
      period(10, '晚上', '19:30', '20:15'),
      period(11, '晚上', '20:20', '21:05'),
      period(12, '晚上', '21:10', '21:55')
    ]
  },
  winter: {
    key: 'winter',
    name: '第二套',
    season: '冬季',
    startDate: '10-01',
    endDate: '04-30',
    periods: [
      period(1, '上午', '08:00', '08:45'),
      period(2, '上午', '08:55', '09:40'),
      { id: 0, name: '课间操', section: '上午', start: '09:40', end: '10:00', isBreak: true },
      period(3, '上午', '10:00', '10:45'),
      period(4, '上午', '10:55', '11:40'),
      period(5, '下午', '14:00', '14:45'),
      period(6, '下午', '14:50', '15:35'),
      period(7, '下午', '15:55', '16:40'),
      period(8, '下午', '16:50', '17:35'),
      period(9, '下午', '17:40', '18:25'),
      period(10, '晚上', '19:00', '19:45'),
      period(11, '晚上', '19:50', '20:35'),
      period(12, '晚上', '20:40', '21:25')
    ]
  }
}

const md = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 今天该用哪一套：05-01 ~ 09-30 用夏季（第一套），其余用冬季（第二套） */
export function bellTable(date: Date = new Date()): BellTable {
  const t = md(date)
  return t >= '05-01' && t <= '09-30' ? BELL_TABLES.summer : BELL_TABLES.winter
}

/** 作息表名字，给页面注明用：「第二套 · 冬季 10/1–4/30」 */
export function bellTableLabel(date: Date = new Date()): string {
  const t = bellTable(date)
  return `${t.name} · ${t.season} ${t.startDate.replace('-', '/')}–${t.endDate.replace('-', '/')}`
}

/** 第 p 节的起止钟点（p 从 1 开始；找不到就退回第一节） */
export function periodTime(p: number, date: Date = new Date()): [string, string] {
  const list = bellTable(date).periods.filter((x) => !x.isBreak)
  const slot = list[Math.max(0, Math.min(list.length - 1, Math.round(p) - 1))]
  return slot ? [slot.start, slot.end] : ['--:--', '--:--']
}

/** 第 p 节属于上午/下午/晚上 */
export function periodSection(p: number, date: Date = new Date()): string {
  const list = bellTable(date).periods.filter((x) => !x.isBreak)
  const slot = list[Math.max(0, Math.min(list.length - 1, Math.round(p) - 1))]
  return slot ? slot.section : ''
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
export const weekdayName = (d: number) => `周${WEEKDAYS[Math.max(0, Math.min(6, d - 1))]}`

export function weeksInclude(weeks: string, w: number): boolean {
  if (!weeks) return true
  for (const part of String(weeks).replace(/[[\]]/g, '').split(',')) {
    const p = part.trim()
    if (!p) continue
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      if (w >= Number(m[1]) && w <= Number(m[2])) return true
      continue
    }
    if (Number(p) === w) return true
  }
  return false
}

/** 从 "6-18" / "[2-6],[8-13]" 里取最小与最大周，仅用于详情里展示起止 */
export function weekRange(weeks: string): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const part of String(weeks || '').replace(/[[\]]/g, '').split(',')) {
    const p = part.trim()
    if (!p) continue
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      min = Math.min(min, Number(m[1]))
      max = Math.max(max, Number(m[2]))
      continue
    }
    if (Number.isFinite(Number(p))) {
      min = Math.min(min, Number(p))
      max = Math.max(max, Number(p))
    }
  }
  return Number.isFinite(min) ? [min, max] : null
}

/** 课程分类色：按课名关键词归类，归不进去的按教务的 category 兜底 */
export function categoryOf(c: Course): Cat {
  const n = c.name || ''
  if (/体育|足球|篮球|排球|乒乓|羽毛|网球|游泳|田径/.test(n)) return 'sport'
  if (/电工|电子|电路|编程|程序设计|C语言|计算机|软件|算法|人工智能/.test(n)) return 'elec'
  if (/力学|图学|制图|机械|材料|工程|测量|公差/.test(n)) return 'mech'
  if (/马克思|毛泽东|思想|政治|形势|政策|历史|哲学|法治/.test(n)) return 'polit'
  if (/数学|代数|高数|英语|物理|化学|概率|统计|分析/.test(n)) return 'math'
  const cat = c.category || ''
  if (/体育/.test(cat)) return 'sport'
  if (/思政|思想/.test(cat)) return 'polit'
  if (/基础|自然/.test(cat)) return 'math'
  return 'math'
}

function runs(periods: number[]): Array<[number, number]> {
  const ps = Array.from(new Set(periods.filter((p) => Number.isFinite(p)))).sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  let start = ps[0]
  let prev = ps[0]
  for (let i = 1; i <= ps.length; i++) {
    const p = ps[i]
    if (p === prev + 1) {
      prev = p
      continue
    }
    if (start !== undefined) out.push([start, prev])
    start = p
    prev = p
  }
  return out
}

/** 某一周的课程安排（连续节次已合并），并标注同一时段的重叠冲突 */
export function sessionsForWeek(table: CourseTable | null, week: number): Sess[] {
  const list: Sess[] = []
  for (const c of table?.courses || []) {
    for (const slot of c.slots || []) {
      if (!slot.weekday || !weeksInclude(slot.weeks, week)) continue
      for (const [start, end] of runs(slot.periods || [])) {
        list.push({
          id: `${c.no}|${slot.weekday}|${start}`,
          no: c.no,
          name: c.name,
          teacher: c.teacher || '',
          room: slot.room || '',
          cat: categoryOf(c),
          day: slot.weekday,
          start,
          end,
          weeks: slot.weeks || c.weeks || '',
          conflictIds: []
        })
      }
    }
  }
  // 同一时段重叠 → 互相记冲突（同一门课的不同 slot 不算）
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (a.day !== b.day || a.name === b.name) continue
      if (a.start <= b.end && b.start <= a.end) {
        a.conflictIds.push(b.id)
        b.conflictIds.push(a.id)
      }
    }
  }
  return list.sort((a, b) => a.day - b.day || a.start - b.start)
}

/** 本周概览：真正上几门课、几组冲突（同一组重叠只算一次） */
export function weekSummary(sessions: Sess[]) {
  const names = new Set(sessions.map((s) => s.name))
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const groups = new Set<string>()
  for (const s of sessions) {
    for (const cid of s.conflictIds) {
      const o = byId.get(cid)
      if (!o) continue
      const day = s.day
      const from = Math.min(s.start, o.start)
      const to = Math.max(s.end, o.end)
      groups.add(`${day}|${from}|${to}`)
    }
  }
  return { courses: names.size, conflicts: groups.size }
}

/** 冲突分组：把互相重叠的课并成一组，供「课程冲突」弹窗使用 */
export type ConflictGroup = { day: number; start: number; end: number; items: Sess[] }

export function conflictGroups(sessions: Sess[]): ConflictGroup[] {
  const out: ConflictGroup[] = []
  for (const s of sessions) {
    if (!s.conflictIds.length) continue
    const g = out.find((x) => x.day === s.day && s.start <= x.end && x.start <= s.end)
    if (g) {
      if (!g.items.some((it) => it.id === s.id)) g.items.push(s)
      g.start = Math.min(g.start, s.start)
      g.end = Math.max(g.end, s.end)
    } else {
      out.push({ day: s.day, start: s.start, end: s.end, items: [s] })
    }
  }
  return out.filter((g) => g.items.length > 1).sort((a, b) => a.day - b.day || a.start - b.start)
}

export function tasksFrom(_data: TaskData | null): TaskVM[] {
  return []
}

export function examsSorted(exams: Exam[]): Exam[] {
  return [...exams].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
}

export function daysUntil(ex: Exam, from = Date.now()): number | null {
  if (!ex.date) return null
  const time = (ex.time || '08:00').slice(0, 5)
  const t = new Date(`${ex.date}T${time}:00`).getTime()
  if (!Number.isFinite(t)) return null
  return Math.ceil((t - from) / 86400000)
}

export function openAtLabel(ex: Exam): string {
  const d = ex.date || ''
  const md = d.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return md ? `${Number(md[1])}月${Number(md[2])}日` : d
}

export function chargerView(c: ChargerData | null) {
  if (!c) return null
  const free = c.totals?.free ?? 0
  const total = c.totals?.total ?? 0
  return {
    free,
    total,
    points: c.totals?.points ?? (c.rows?.length || 0),
    devices: c.totals?.devices ?? 0,
    rows: (c.rows || []).map((r) => ({
      name: r.display || r.area,
      free: r.free,
      total: r.total,
      charging: r.charging,
      devices: r.deviceCount,
      distance: r.distance,
      percent: r.total ? Math.round((r.free / r.total) * 100) : 0
    })),
    at: c.fetchedAt,
    stale: !!c.stale
  }
}

export function cardView(c: CardInfo | null) {
  if (!c) return null
  return { balance: c.balance, at: c.fetchedAt, stale: !!c.stale }
}

export function noticeKey(n: NoticeItem) {
  return `${n.source}:${n.id}`
}

export function noticeDate(n: NoticeItem) {
  const m = String(n.date || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${Number(m[2])}月${Number(m[3])}日`
  return n.date || ''
}
