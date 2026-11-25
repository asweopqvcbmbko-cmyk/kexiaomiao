import type {
  ChaoxingActivitiesResult, ChaoxingActivity, ChaoxingCourse, ChaoxingDashboard, ChaoxingExam,
  ChaoxingProgressResult, ChaoxingTodo, ChaoxingWork
} from '../../types'

const ORIGIN = 'https://mooc1-api.chaoxing.com'
export const CHAOXING_LOGIN_URL = 'https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com'
export const CHAOXING_WORK_URL = ORIGIN + '/work/stu-work'
export const CHAOXING_EXAM_URL = ORIGIN + '/exam-ans/exam/phone/examcode'
const EXAM_TABLE_URL = 'https://mooc1.chaoxing.com/exam-ans/exam/test/examcode/examlist?edition=1&nohead=0&fid='
const MOBILE_ORIGIN = 'https://mobilelearn.chaoxing.com'
const STATS_ORIGIN = 'https://stat2-ans.chaoxing.com'

export function mergeChaoxingExams(primary: ChaoxingExam[], secondary: ChaoxingExam[]): ChaoxingExam[] {
  const unique = new Map<string, ChaoxingExam>()
  for (const exam of [...primary, ...secondary]) {
    const key = exam.examId || exam.title
    const previous = unique.get(key)
    unique.set(key, previous ? {
      ...previous,
      course: previous.course || exam.course,
      courseId: previous.courseId || exam.courseId,
      classId: previous.classId || exam.classId,
      url: previous.url === CHAOXING_EXAM_URL ? exam.url : previous.url
    } : exam)
  }
  return [...unique.values()]
}

const normalizeCourseName = (name = '') => name.normalize('NFKC').replace(/[《》〈〉]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase()
const courseNamePrefix = (name: string) => name.replace(/\.{3,}$/, '').trim()

export function filterByIgnoredCourses<T>(
  items: T[], ignoredCourses: string[], getCourse: (item: T) => string | (string | undefined)[]
): T[] {
  const ignored = ignoredCourses.map(normalizeCourseName).filter(Boolean)
  return items.filter((item) => {
    const names = getCourse(item)
    return ![names].flat().map(normalizeCourseName).filter(Boolean).some((name) => {
      const prefix = courseNamePrefix(name)
      return ignored.some((entry) => {
        if (entry === name) return true
        const ignoredPrefix = courseNamePrefix(entry)
        return (ignoredPrefix && ignoredPrefix !== entry && name.startsWith(ignoredPrefix)) ||
          (prefix && prefix !== name && entry.startsWith(prefix))
      })
    })
  })
}

const field = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

type CourseNames = Pick<ChaoxingCourse, 'courseName'> & { fullCourseName?: string }
const getCourseNames = (course: CourseNames) => [course.courseName, course.fullCourseName]

export function filterCachedCourseRows<T extends Pick<ChaoxingCourse, 'courseId' | 'clazzId' | 'courseName'>>(
  rows: T[], courses: ChaoxingCourse[], ignoredCourses: string[]
): T[] {
  const aliases = new Map(courses.map((course: ChaoxingCourse & CourseNames) => [
    course.courseId + '_' + course.clazzId, getCourseNames(course)
  ]))
  return filterByIgnoredCourses(rows, ignoredCourses,
    (row) => [row.courseName, ...(aliases.get(row.courseId + '_' + row.clazzId) || [])])
}

export function parseCourseListJson(raw: any): (ChaoxingCourse & CourseNames)[] {
  const courses = new Map<string, ChaoxingCourse & CourseNames>()
  if (!Array.isArray(raw?.channelList)) return []
  for (const channel of raw.channelList) {
    if (channel?.cataid !== '100000002') continue
    const content = channel.content
    const list = content?.course?.data
    if (!Array.isArray(list)) continue
    const clazz = content.clazz?.data?.[0]
    const clazzId = field(clazz?.id ?? content.clazzId ?? content.id ?? channel.key)
    for (const item of list) {
      const courseId = field(item?.id ?? item?.courseId)
      const alternateName = field(item?.courseName)
      const fullCourseName = field(item?.fullCourseName)
      const courseName = field(item?.name) || alternateName || fullCourseName
      if (!courseId || !clazzId || !courseName) continue
      const key = courseId + '_' + clazzId
      const alias = [fullCourseName, alternateName].find((name) => name && name !== courseName)
      if (!courses.has(key)) courses.set(key, {
        courseId, clazzId, courseName,
        ...(alias ? { fullCourseName: alias } : {}),
        cpi: field(content.cpi ?? clazz?.cpi ?? item.cpi),
        teacherName: field(item.teacherfactor ?? item.teacherName),
        enc: field(content.enc ?? clazz?.enc ?? item.enc) || undefined,
        pEnc: field(content.pEnc ?? clazz?.pEnc ?? item.pEnc) || undefined
      })
    }
  }
  return [...courses.values()]
}

export function isChaoxingLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) && parsed.hostname === 'passport2.chaoxing.com'
  } catch {
    return false
  }
}

export function parseLeftTimeMinutes(text: string): number | null {
  const duration = text.replace(/\s+/g, '').replace(/^剩余[：:]?/, '')
  const parts = /^(?:(\d+)天)?(?:(\d+)(?:个?小时))?(?:(\d+)分钟?)?$/.exec(duration)
  if (!parts || !duration) return null
  const [, days = '0', hours = '0', minutes = '0'] = parts
  const total = Number(days) * 1440 + Number(hours) * 60 + Number(minutes)
  return Number.isSafeInteger(total) ? total : null
}

export function buildChaoxingTodos(works: ChaoxingWork[], exams: ChaoxingExam[]): ChaoxingTodo[] {
  const pending = [
    ...works.filter((work) => work.uncommitted).map((work) => ({ ...work, kind: 'work' as const })),
    ...exams.filter((exam) => !exam.finished && !exam.expired).map((exam) => ({ ...exam, kind: 'exam' as const }))
  ]
  return pending.map((item) => {
    const minutes = parseLeftTimeMinutes(item.kind === 'work' ? item.leftTime : item.timeLeft)
    return { ...item, minutes, urgent: minutes != null && minutes <= 24 * 60 }
  }).sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity))
}

type Engine = {
  load(url: string, timeoutMs?: number): Promise<string>
  run(js: string): Promise<unknown>
}

type Page<T> = {
  url: string
  title?: string
  login: boolean
  recognized: boolean
  rowCount?: number
  items: T[]
}

/** 独立自包含注入脚本（不依赖 Function.prototype.toString，避免 Vite 压缩破坏） */
function buildReadPageJs(kind: 'work' | 'exam'): string {
  return `(() => {
    const work = ${kind === 'work' ? 'true' : 'false'};
    const base = ${JSON.stringify(ORIGIN)};
    const selector = work ? 'ul.nav' : 'ul.ks_list';
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const text = (root, css) => norm(root && root.querySelector(css) ? root.querySelector(css).textContent : '');
    const listEl = document.querySelector(selector);
    const rows = listEl ? Array.from(listEl.querySelectorAll(':scope > li')) : Array.from(document.querySelectorAll(selector + ' > li'));
    const body = norm(document.body ? document.body.innerText : '');
    const hasPwd = !!document.querySelector('input[type="password"]');
    const login = /登录学习通|学习通登录|超星(?:用户)?登录|超星通行证|请先登录|登录后(?:查看|访问)|登录(?:已)?过期|请重新登录|手机号\\/超星号/.test(body)
      || (/登录/.test(document.title || '') && hasPwd)
      || /passport2\\.chaoxing\\.com/i.test(location.hostname || '');
    const empty = work
      ? /(?:暂无|没有)(?:相关)?作业|暂无数据/.test(body)
      : /(?:暂无|没有)(?:相关)?考试|暂无数据/.test(body);
    const items = [];
    for (const row of rows) {
      const raw = (row.getAttribute('data') || row.getAttribute('data-url') || '').trim();
      let href = '';
      let params = new URLSearchParams();
      if (raw) {
        try {
          const u = new URL(raw, base);
          if (/^https?:$/.test(u.protocol) && u.hostname.endsWith('.chaoxing.com') && !u.username && !u.password) {
            u.protocol = 'https:';
            href = u.href;
            params = u.searchParams;
          }
        } catch (_) {}
      }
      const courseId = params.get('courseId') || '';
      const id = params.get('taskrefId') || params.get('workId') || params.get('examId') || '';
      if (work) {
        const option = row.querySelector('div[role="option"]') || row;
        const title = text(option, 'p') || text(option, '.tit') || text(option, 'h3');
        if (!title) continue;
        const stateEl = option.querySelector('span:nth-of-type(1)');
        const status = norm(stateEl ? stateEl.textContent : '');
        const cls = String((stateEl && stateEl.className) || '');
        const uncommitted = cls.includes('status') || /未交|待提交|待完成|未完成|重做/.test(status);
        const course = text(option, 'span:nth-of-type(2)');
        const leftTime = text(option, '.fr') || text(option, '.time');
        items.push({
          title,
          courseId,
          url: href || (base + '/work/stu-work'),
          workId: id,
          clazzId: params.get('clazzId') || params.get('classId') || '',
          status: status || (uncommitted ? '待提交' : '已提交'),
          uncommitted,
          course,
          leftTime
        });
      } else {
        const title = text(row, 'dl > dt') || text(row, 'p') || text(row, '.tit');
        if (!title) continue;
        const status = text(row, 'span.ks_state') || text(row, '.status');
        const img = row.querySelector('div.ks_pic > img');
        const src = String((img && img.getAttribute('src')) || '');
        const finished = /已完成|待批阅|已提交|已批阅/.test(status);
        const expired = src.includes('ks_02') || /已过期|已结束/.test(status);
        items.push({
          title,
          courseId,
          url: href || (base + '/exam-ans/exam/phone/examcode'),
          examId: id,
          classId: params.get('classId') || params.get('clazzId') || '',
          status: status || (finished ? '已完成' : expired ? '已过期' : '进行中'),
          finished,
          expired,
          course: row.getAttribute('data-course-name') || text(row, '.course-name') || params.get('courseName') || '',
          timeLeft: text(row, 'dl > dd') || text(row, '.fr')
        });
      }
    }
    const recognized = !!listEl || rows.length > 0 || empty;
    return JSON.stringify({
      url: location.href,
      title: document.title || '',
      login,
      recognized,
      rowCount: rows.length,
      items
    });
  })()`
}

export class ChaoxingParseError extends Error {}
export class ChaoxingAuthError extends Error {}

const READ_EXAM_TABLE_JS = String.raw`(() => {
  const table = document.querySelector('table.dataTable');
  const body = document.body?.innerText || '';
  const login = /请先登录|请重新登录|登录已过期/.test(body)
    || (/登录/.test(document.title) && !!document.querySelector('input[type="password"]'));
  const rows = Array.from(table?.querySelectorAll('tr.dataTr') || []);
  const items = rows.flatMap((row) => {
    const cells = row.querySelectorAll('td');
    const title = cells[1]?.textContent?.trim();
    if (cells.length !== 9 || !title) return [];
    const examStatus = cells[4].textContent.trim();
    const answerStatus = cells[5].textContent.trim();
    const onclick = cells[8].querySelector('[onclick]')?.getAttribute('onclick') || cells[8].getAttribute('onclick') || '';
    const raw = /\bgo\(\s*(['"])(.*?)\1\s*\)/.exec(onclick)?.[2];
    let url = location.href;
    let params = new URLSearchParams();
    let refer = new URLSearchParams();
    try {
      const target = new URL(raw || url, location.origin);
      if (/^https?:$/.test(target.protocol) && target.hostname.endsWith('.chaoxing.com') && !target.username && !target.password) {
        target.protocol = 'https:';
        url = target.href;
        params = target.searchParams;
        refer = new URL(params.get('refer') || '/', location.origin).searchParams;
      }
    } catch (_) {}
    const param = (...names) => names.map((name) => refer.get(name) || params.get(name)).find(Boolean) || '';
    return [{
      title, url, examId: param('examId'), courseId: param('courseId', 'courseid', 'moocId'),
      classId: param('classId', 'clazzId', 'clazzid'),
      course: row.getAttribute('data-course-name') || param('courseName'),
      status: answerStatus || examStatus,
      timeLeft: cells[2].textContent.trim(),
      finished: /已完成|待批阅|已提交|已批阅/.test(answerStatus),
      expired: /已结束|已过期/.test(examStatus)
    }];
  });
  return JSON.stringify({ url: location.href, login, items, rowCount: rows.length,
    recognized: items.length === rows.length && (!!table || /(?:暂无|没有)(?:相关)?考试|暂无数据/.test(body)) });
})()`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchPage<T>(engine: Engine, url: string, kind: 'work' | 'exam' | 'exam-table'): Promise<T[] | null> {
  const landed = await engine.load(url, kind === 'exam-table' ? 1800 : undefined)
  if (isChaoxingLoginUrl(landed)) return null
  if (landed.startsWith('load-error:')) throw new Error('Unable to load Chaoxing')

  const js = kind === 'exam-table' ? READ_EXAM_TABLE_JS : buildReadPageJs(kind)
  let page: Page<T> | undefined
  // 最多轮询 3.5 秒等待超星页面 DOM / 异步列表就绪
  const deadline = Date.now() + (kind === 'exam-table' ? 1100 : 3500)
  while (Date.now() < deadline) {
    const result = await engine.run(js)
    try {
      page = typeof result === 'string' ? JSON.parse(result) : undefined
    } catch {
      page = undefined
    }
    if (page && (page.login || isChaoxingLoginUrl(page.url))) return null
    if (page?.recognized && (page.items.length > 0 || Date.now() + 1200 >= deadline)) break
    await sleep(350)
  }

  try {
    console.log(
      '[haust][chaoxing]',
      kind,
      'recognized=' + !!page?.recognized,
      'rows=' + (page?.rowCount ?? 0),
      'items=' + (page?.items?.length ?? 0),
      'url=' + String(page?.url || landed).slice(0, 80)
    )
  } catch (_) {}

  if (!page) throw new ChaoxingParseError('Invalid Chaoxing page data')
  if (page.login || isChaoxingLoginUrl(page.url)) return null
  if (!page.recognized || !Array.isArray(page.items)) {
    throw new ChaoxingParseError('Unexpected Chaoxing list markup')
  }
  return page.items
}

export async function fetchChaoxingDashboard(engine: Engine): Promise<ChaoxingDashboard> {
  const authRequired = (): ChaoxingDashboard => ({
    loggedIn: false, authRequired: true, works: [], exams: [], fetchedAt: new Date().toISOString()
  })

  let works: ChaoxingWork[] | null = null
  let exams: ChaoxingExam[] | null = null
  let workErr: unknown = null
  let examErr: unknown = null

  let fullCourseNames = new Map<string, string>()
  try {
    works = await fetchPage<ChaoxingWork>(engine, CHAOXING_WORK_URL, 'work')
    if (works !== null) {
      // 复用已打开的 mooc1-api 同源页顺手拿完整课程名，替换作业页服务端截断的《...》名称
      try {
        const rawCourses = await fetchCourseJson(engine, ORIGIN + '/mycourse/backclazzdata?view=json&mcode=')
        for (const c of parseCourseListJson(rawCourses)) {
          if (c.courseId && c.courseName) fullCourseNames.set(c.courseId, c.courseName)
        }
      } catch (_) {}
    }
  } catch (err) {
    workErr = err
  }
  if (works === null && !workErr) return authRequired()

  try {
    exams = await fetchPage<ChaoxingExam>(engine, CHAOXING_EXAM_URL, 'exam')
  } catch (err) {
    examErr = err
  }
  let secondary: ChaoxingExam[] | null = null
  try {
    secondary = await fetchPage<ChaoxingExam>(engine, EXAM_TABLE_URL, 'exam-table')
  } catch (err) {
    examErr ??= err
  }
  if (exams === null && secondary === null && !examErr && works === null) return authRequired()
  if (secondary) exams = mergeChaoxingExams(exams || [], secondary)
  if (works === null && exams === null) {
    throw workErr || examErr || new ChaoxingParseError('Failed to fetch Chaoxing dashboard')
  }

  const finalWorks = (works || []).map((item) => ({
    ...item,
    course: fullCourseNames.get(item.courseId) || item.course
  }))
  const finalExams = exams || []
  const courseNames = new Map<string, string>()
  for (const item of finalWorks) {
    if (item.courseId && item.course) courseNames.set(item.courseId, item.course)
  }
  for (const [id, name] of fullCourseNames) {
    courseNames.set(id, name)
  }
  return {
    loggedIn: true,
    error: exams === null && examErr ? examErr instanceof ChaoxingParseError ? 'parse' : 'network' : undefined,
    works: finalWorks,
    exams: finalExams.map((item) => ({
      ...item,
      course: fullCourseNames.get(item.courseId) || item.course || courseNames.get(item.courseId) || ''
    })),
    fetchedAt: new Date().toISOString()
  }
}

async function loadCoursePage(engine: Engine, url: string) {
  const landed = await engine.load(url, 10000)
  if (isChaoxingLoginUrl(landed)) throw new ChaoxingAuthError()
  if (landed.startsWith('load-error:') || new URL(landed).origin !== new URL(url).origin) {
    throw new Error('Unable to load Chaoxing course page')
  }
}

async function fetchCourseJson(engine: Engine, url: string): Promise<any> {
  await engine.run(`(() => {
    const result = window.__haustCourseFetch = {};
    fetch(${JSON.stringify(url)}, { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401 || /passport2\\.chaoxing\\.com/.test(response.url)) {
          result.value = { error: 'auth' };
        } else if (!response.ok) {
          result.value = { error: 'network' };
        } else {
          const body = await response.text();
          try { result.value = { data: JSON.parse(body) }; }
          catch (_) {
            result.value = { error: /请先登录|登录已过期|请重新登录|超星通行证/.test(body) ? 'auth' : 'parse' };
          }
        }
      }).catch(() => { result.value = { error: 'network' }; });
    return true;
  })()`)
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const result = await engine.run('JSON.stringify(window.__haustCourseFetch?.value ?? null)')
    if (typeof result === 'string' && result !== 'null') {
      const { data, error } = JSON.parse(result)
      if (error === 'auth' || /请先登录|登录已过期|请重新登录|未登录/.test(field(data?.msg ?? data?.message))) {
        throw new ChaoxingAuthError()
      }
      if (error === 'parse') throw new ChaoxingParseError('Expected course JSON')
      if (error) throw new Error('Chaoxing course request failed')
      return data
    }
    await sleep(150)
  }
  throw new Error('Chaoxing course request timed out')
}

export async function fetchChaoxingCourses(engine: Engine): Promise<(ChaoxingCourse & CourseNames)[]> {
  await loadCoursePage(engine, CHAOXING_WORK_URL)
  const raw = await fetchCourseJson(engine, ORIGIN + '/mycourse/backclazzdata?view=json&mcode=')
  const courses = parseCourseListJson(raw)
  if (!Array.isArray(raw?.channelList) || raw.success === false ||
      (!courses.length && raw.channelList.some((channel: any) => channel?.cataid === '100000002'))) {
    throw new ChaoxingParseError('Unexpected Chaoxing course list')
  }
  return courses
}

function courseUrl(origin: string, path: string, params: Record<string, string>) {
  return origin + path + '?' + new URLSearchParams(params)
}

const activityTypes: Record<string, string> = {
  2: '签到', 4: '抢答', 14: '问卷', 42: '随堂测验', 35: '分组任务', 5: '主题讨论'
}

export async function fetchChaoxingActivities(engine: Engine, ignoredCourses: string[] = [], delayMs = 500): Promise<ChaoxingActivitiesResult> {
  const courses = await fetchChaoxingCourses(engine)
  const selected = filterByIgnoredCourses(courses, ignoredCourses, getCourseNames)
  const activities: ChaoxingActivity[] = []
  if (selected.length) await loadCoursePage(engine, MOBILE_ORIGIN + '/')
  for (const [index, course] of selected.entries()) {
    if (index > 0) await sleep(delayMs)
    const { courseId, clazzId, courseName } = course
    const url = courseUrl(MOBILE_ORIGIN, '/v2/apis/active/student/activelist', {
      fid: '0', courseId, classId: clazzId, showNotStartedActive: '0', _: String(Date.now())
    })
    const raw = await fetchCourseJson(engine, url)
    const list = [raw?.data?.activeList, raw?.data?.list, raw?.data?.data, raw?.activeList, raw?.data, raw].find(Array.isArray)
    if (!list || raw?.result === false || raw?.success === false) {
      throw new ChaoxingParseError('Unexpected Chaoxing activity list')
    }
    for (const item of list) {
      const activeId = field(item?.id ?? item?.activeId)
      const title = field(item?.nameOne ?? item?.name ?? item?.title)
      if (!activeId || !title) throw new ChaoxingParseError('Invalid Chaoxing activity')
      const ongoing = Number(item.status) === 1
      const finished = Number(item.status) === 2
      const fallback = courseUrl(MOBILE_ORIGIN, '/v2/apis/active/student/activelist', {
        fid: '0', courseId, classId: clazzId, showNotStartedActive: '0'
      })
      let href = fallback
      try {
        const target = new URL(field(item.url), MOBILE_ORIGIN)
        if (item.url && /^https?:$/.test(target.protocol) && target.hostname.endsWith('.chaoxing.com') && !target.username && !target.password) {
          target.protocol = 'https:'
          href = target.href
        }
      } catch { /* Use the course activity list. */ }
      activities.push({
        activeId, title, courseId, clazzId, courseName, ongoing, finished,
        type: activityTypes[field(item.activeType)] || '课堂活动',
        status: ongoing ? '进行中' : finished ? '已结束' : '未开始',
        endTime: field(item.endTime ?? item.endTimeStamp) || undefined,
        url: href
      })
    }
  }
  return { loggedIn: true, courses, activities, fetchedAt: new Date().toISOString() }
}

const READ_PROGRESS_JS = String.raw`(() => {
  const text = document.body?.innerText || '';
  const counts = /(?:已完成|任务点完成数)\s*[：:]?\s*(\d+)\s*(?:个)?\s*[/／]\s*(\d+)/.exec(text);
  const pEnc = document.querySelector('#pEnc, input[name="pEnc"]')?.value || window.pEnc ||
    /\bpEnc\s*[:=]\s*['"]([^'"]+)['"]/.exec(document.documentElement.innerHTML)?.[1];
  return JSON.stringify({ counts: counts?.slice(1), pEnc,
    login: /请先登录|请重新登录|登录已过期/.test(text) });
})()`

export async function fetchChaoxingProgress(engine: Engine, ignoredCourses: string[] = [], delayMs = 500): Promise<ChaoxingProgressResult> {
  const courses = await fetchChaoxingCourses(engine)
  const selected = filterByIgnoredCourses(courses, ignoredCourses, getCourseNames)
  const progress: ChaoxingProgressResult['progress'] = []
  for (const [index, course] of selected.entries()) {
    if (index > 0) await sleep(delayMs)
    const { courseId, clazzId, cpi, courseName, teacherName } = course
    const params = { courseid: courseId, clazzid: clazzId, cpi, ut: 's' }
    const url = courseUrl(STATS_ORIGIN, '/study-data/index', params)
    await loadCoursePage(engine, course.enc ? url + '&' + new URLSearchParams({ stuenc: course.enc }) : url)
    const result = await engine.run(READ_PROGRESS_JS)
    const page = typeof result === 'string' ? JSON.parse(result) : null
    if (page?.login) throw new ChaoxingAuthError()
    let counts = page?.counts
    const pEnc = field(page?.pEnc) || course.pEnc
    if (!counts && pEnc) {
      const raw = await fetchCourseJson(engine, courseUrl(STATS_ORIGIN, '/stat2/study-data/job', { ...params, pEnc }))
      if (raw?.status && raw.data) counts = [raw.data.job, raw.data.publishJobNum]
    }
    const completedTasks = Number(field(counts?.[0]) || NaN)
    const totalTasks = Number(field(counts?.[1]) || NaN)
    if (!Number.isSafeInteger(completedTasks) || !Number.isSafeInteger(totalTasks) ||
        completedTasks < 0 || completedTasks > totalTasks) {
      throw new ChaoxingParseError('Unexpected Chaoxing task counts')
    }
    progress.push({
      courseId, clazzId, courseName, teacherName, completedTasks, totalTasks, url,
      percent: totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : null
    })
  }
  return { loggedIn: true, courses, progress, fetchedAt: new Date().toISOString() }
}
