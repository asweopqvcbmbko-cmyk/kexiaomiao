/**
 * 分发隔离用静态演示数据（Demo Mode）。
 * 不含任何个人真实学号、宿舍校验码或会话凭据，供未绑定用户零门槛体验完整界面。
 */
import type { CardInfo, ChaoxingDashboard, ChargerData, CourseTable, Exam, NoticeBody, NoticeItem, SessionStatus } from './types'
import type { AirconElectricityResult, AirconRoom } from './types/aircon-electricity'

function todayIsoDate(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayWeekday() {
  const wd = new Date().getDay()
  return wd === 0 ? 7 : wd
}

export function buildDemoBundle() {
  const now = new Date()
  const nowIso = now.toISOString()
  const wd = todayWeekday()
  const nextWd = (wd % 7) + 1

  const status: SessionStatus = {
    loggedIn: true,
    verified: false,
    checkedAt: nowIso,
    studentName: '体验同学（演示）',
    currentWeek: 12
  }

  const table: CourseTable = {
    fetchedAt: nowIso,
    term: '示例学期',
    courses: [
      {
        no: '01',
        code: 'DEMO101',
        name: '高等数学（上）',
        teacher: '张老师',
        credits: '5.0',
        hours: '80',
        weeks: '1-16',
        attendees: '120',
        category: '公共基础',
        examType: '考试',
        slots: [
          { weeks: '1-16', weekday: wd, periods: [1, 2], room: '开元公教2-201' },
          { weeks: '1-16', weekday: nextWd, periods: [3, 4], room: '开元公教2-201' }
        ]
      },
      {
        no: '02',
        code: 'DEMO204',
        name: '数据结构与算法',
        teacher: '李老师',
        credits: '4.0',
        hours: '64',
        weeks: '1-16',
        attendees: '90',
        category: '专业必修',
        examType: '考试',
        slots: [{ weeks: '1-16', weekday: wd, periods: [5, 6], room: '工科2-405' }]
      },
      {
        no: '03',
        code: 'DEMO108',
        name: '大学物理实验',
        teacher: '王老师',
        credits: '2.0',
        hours: '32',
        weeks: '1-16',
        attendees: '48',
        category: '实验实践',
        examType: '考查',
        slots: [{ weeks: '1-16', weekday: wd, periods: [7, 8], room: '物理实验楼302' }]
      }
    ],
    labs: [],
    practice: []
  }

  const exams: Exam[] = [
    {
      batch: '期末考试（示例）',
      code: 'DEMO204',
      name: '数据结构与算法',
      type: '闭卷',
      date: todayIsoDate(6),
      time: '09:00-11:00',
      room: '开元公教3-305',
      seat: '18',
      status: '正常',
      note: ''
    },
    {
      batch: '期末考试（示例）',
      code: 'DEMO101',
      name: '高等数学（上）',
      type: '闭卷',
      date: todayIsoDate(15),
      time: '14:30-16:30',
      room: '开元公教2-101',
      seat: '07',
      status: '正常',
      note: ''
    }
  ]

  const notices: NoticeItem[] = [
    {
      source: 'jwc',
      sourceName: '教务处',
      id: 'demo-jwc-1',
      title: '【示例】关于本学期期末考试日程与考场查询的通知',
      date: todayIsoDate(0),
      dept: '教务处',
      url: 'https://jwc.haust.edu.cn/tzgg.htm'
    },
    {
      source: 'school',
      sourceName: '全校通知',
      id: 'demo-school-1',
      title: '【示例】关于图书馆期末延长开放时间的通知',
      date: todayIsoDate(-1),
      dept: '图书馆',
      url: 'https://www.haust.edu.cn/'
    },
    {
      source: 'news',
      sourceName: '校园新闻',
      id: 'demo-news-1',
      title: '【示例】我校学子在全国大学生学科竞赛中斩获佳绩',
      date: todayIsoDate(-2),
      dept: '党委宣传部',
      url: 'https://www.haust.edu.cn/'
    },
    {
      source: 'cl',
      sourceName: '材料学院',
      id: 'demo-cl-1',
      title: '【示例】学术前沿系列讲座与实验室安全培训预告',
      date: todayIsoDate(-3),
      dept: '材料科学与工程学院',
      url: 'https://cl.haust.edu.cn/'
    }
  ]

  const chargers: ChargerData = {
    fetchedAt: nowIso,
    anchor: { name: '开元校区', lat: 34.602, lng: 112.42 },
    rows: [
      { area: '嘉园', display: '嘉园示例点位', raw: '嘉园示例点位', devices: 'D1', deviceCount: 2, points: 2, total: 20, free: 12, charging: 8, distance: 120 },
      { area: '菁园', display: '菁园示例点位', raw: '菁园示例点位', devices: 'D2', deviceCount: 2, points: 2, total: 20, free: 7, charging: 13, distance: 260 }
    ],
    byArea: {
      嘉园: { points: 2, devices: 2, total: 20, free: 12 },
      菁园: { points: 2, devices: 2, total: 20, free: 7 }
    },
    totals: { points: 4, devices: 4, total: 40, free: 19 },
    coverageNote: '演示模式示例数据'
  }

  const card: CardInfo = {
    fetchedAt: nowIso,
    balance: '68.50',
    context: '演示模式示例数据'
  }

  const airconRoom: AirconRoom = {
    campus: '开元校区',
    areaId: 'demo',
    buildId: 'demo',
    buildName: '示例宿舍楼',
    levelId: 'demo',
    roomVerify: 'demo-room',
    roomName: '示例房间'
  }

  const airconResult: AirconElectricityResult = {
    status: 'ok',
    reading: {
      room: airconRoom,
      remainingKwh: 42.6,
      balanceYuan: 23.4,
      quantityUnit: '度',
      updatedAt: nowIso,
      fetchedAt: nowIso
    }
  }

  return { status, table, exams, notices, chargers, card, airconRoom, airconResult }
}

export function buildDemoChaoxingDashboard(): ChaoxingDashboard {
  const workUrl = 'https://mooc1-api.chaoxing.com/work/stu-work'
  const examUrl = 'https://mooc1-api.chaoxing.com/exam-ans/exam/phone/examcode'
  return {
    loggedIn: true,
    fetchedAt: new Date().toISOString(),
    works: [
      { workId: 'demo-w1', courseId: 'demo-math', clazzId: 'demo-1', title: '第六章积分练习', course: '高等数学', leftTime: '剩余7小时30分钟', status: '待提交', uncommitted: true, url: workUrl },
      { workId: 'demo-w2', courseId: 'demo-code', clazzId: 'demo-2', title: '实验四 · 链表操作', course: '程序设计基础', leftTime: '剩余3天2小时', status: '待提交', uncommitted: true, url: workUrl },
      { workId: 'demo-w3', courseId: 'demo-english', clazzId: 'demo-3', title: 'Unit 4 Reading Journal', course: '大学英语', leftTime: '', status: '已提交', uncommitted: false, url: workUrl }
    ],
    exams: [
      { examId: 'demo-e1', courseId: 'demo-code', classId: 'demo-2', title: '数组与指针单元测验', course: '程序设计基础', timeLeft: '剩余45分钟', status: '进行中', finished: false, expired: false, url: examUrl },
      { examId: 'demo-e2', courseId: 'demo-math', classId: 'demo-1', title: '期中模拟考试', course: '高等数学', timeLeft: '剩余4天', status: '进行中', finished: false, expired: false, url: examUrl },
      { examId: 'demo-e3', courseId: 'demo-english', classId: 'demo-3', title: '词汇阶段测验', course: '大学英语', timeLeft: '', status: '已完成', finished: true, expired: false, url: examUrl },
      { examId: 'demo-e4', courseId: 'demo-math', classId: 'demo-1', title: '函数与极限随堂测验', course: '高等数学', timeLeft: '', status: '已过期', finished: false, expired: true, url: examUrl }
    ]
  }
}

export function buildDemoChaoxingCourses() {
  const courses = [
    { courseId: 'demo-math', clazzId: 'demo-1', cpi: '', courseName: '高等数学', teacherName: '张老师' },
    { courseId: 'demo-code', clazzId: 'demo-2', cpi: '', courseName: '程序设计基础', teacherName: '李老师' },
    { courseId: 'demo-english', clazzId: 'demo-3', cpi: '', courseName: '大学英语', teacherName: '王老师' }
  ]
  const common = { loggedIn: true, courses, fetchedAt: new Date().toISOString() }
  const examples = [
    { course: 0, title: '第六章课堂签到', type: '签到', ongoing: true },
    { course: 1, title: '链表随堂练习', type: '随堂测验', ongoing: true },
    { course: 2, title: 'Unit 4 阅读讨论', type: '主题讨论', ongoing: true },
    { course: 1, title: '实验课节奏反馈', type: '问卷', ongoing: false },
    { course: 0, title: '定积分概念抢答', type: '抢答', ongoing: false }
  ]
  return {
    activities: { ...common, activities: examples.map(({ course, title, type, ongoing }, index) => ({
      ...courses[course], activeId: 'demo-a' + index, title, type, ongoing, finished: !ongoing,
      status: ongoing ? '进行中' : '已结束', url: 'https://mobilelearn.chaoxing.com/'
    })) },
    progress: { ...common, progress: courses.map((course, index) => {
      const [completedTasks, totalTasks] = [[12, 16], [7, 12], [10, 10]][index]
      return { ...course, completedTasks, totalTasks, percent: Math.round(completedTasks / totalTasks * 100),
        url: 'https://stat2-ans.chaoxing.com/study-data/index' }
    }) }
  }
}

export function getDemoNoticeBody(item: NoticeItem): NoticeBody {
  const bodies: Record<string, string> = {
    'demo-jwc-1':
      '这是一条演示模式的示例教务通知正文。\n\n登录你的河科大校园账号后，科小喵会自动同步教务处、全校通知、校园新闻与学院通知，并支持点击按需拉取正文与离线缓存阅读。',
    'demo-school-1':
      '这是一条演示模式的示例全校通知。\n\n在真实模式下，支持校园网直连与校外 WebVPN 自动切换，所有已读状态和缓存内容仅保存在你的本机设备中。',
    'demo-news-1':
      '这是一条演示模式的示例校园新闻。\n\n你可以在首页顶部直接浏览最新未读通知，或在通知页按来源筛选并一键标记全部已读。',
    'demo-cl-1':
      '这是一条演示模式的示例学院通知。\n\n点击顶部「去登录」绑定你的校园账号后，即可立即退出示例模式并拉取实时数据。'
  }
  return {
    title: item.title,
    date: item.date,
    sourceUrl: item.url,
    text: bodies[item.id] || '这是演示模式的示例通知正文。登录校园账号后即可查看学校实时通知与附件。'
  }
}
