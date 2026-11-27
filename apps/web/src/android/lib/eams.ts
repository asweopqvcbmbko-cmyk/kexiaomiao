// @ts-nocheck —— 从桌面端逐行移植的纯逻辑模块（解析/筛选），保持与桌面版一字不差。
// 移植方式：require → import，module.exports → export；逻辑本身没有改。

/**
 * 教务系统（EAMS）适配器
 * 所有解析都在页面上下文完成，主进程只拿结构化 JSON。
 */

const COURSE_URL = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/courseTableForStd.action'
const EXAM_URL = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/stdExamTable.action'
// 校外访问（aTrust 网关）下，页面自带的 jQuery/bg.js 有时根本没被注入，
// 页面里的 searchTable() 永远不跑，课表/考试表就不会在浏览器端渲染出来。
// 这两个地址是同一个后端直接吐「表格版」HTML 的入口（GET、只读），
// 绕开页面脚本，解析逻辑一行不用改。
const COURSE_TABLE_URL = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/courseTableForStd!courseTable.action'
const EXAM_TABLE_URL = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/stdExamTable!examTable.action'

/** 从课表页里抠出后端要的 ids（角色id）和当前学期 id */
const PAGE_INFO_JS = String.raw`(() => {
  const html = document.documentElement.outerHTML;
  const ids = (html.match(/addInput\(form,\s*"ids",\s*"(\d+)"/) || [])[1] || '';
  const ck = (document.cookie.match(/semester\.id=(\d+)/) || [])[1] || '';
  const hidden = document.querySelector('#semesterCalendar_target');
  const bar = document.querySelector('select[name="project.id"]');
  return JSON.stringify({
    ids: ids,
    semester: ck || (hidden ? hidden.value : '') || (bar ? bar.value : '')
  });
})()`

// 刚打开时只有"学期日历"两个小表（学年学期还显示 Loading…），
// 必须等真正带"任课教师"表头的课表渲染出来，否则会解析到空数据。
const WAIT_COURSE_JS = `(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const ok = [...document.querySelectorAll('table')].some((t) => {
    if (!t.rows[0]) return false;
    const head = [...t.rows[0].cells].map((c) => norm(c.innerText));
    return head.some((h) => h === '任课教师') && head.some((h) => h === '学分');
  });
  return ok;
})()`

const WAIT_EXAM_JS = `(() => [...document.querySelectorAll('table')].some((t) => (t.innerText || '').indexOf('考试批次') >= 0))()`

const COURSE_JS = String.raw`(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const tables = [...document.querySelectorAll('table')];
  const text = document.body.innerText || '';

  const termMatch = text.match(/20\d\d-20\d\d学年\s*\d\s*学期/);
  const term = termMatch ? termMatch[0].replace(/\s+/g, '') : '';

  const parsePeriods = (s) =>
    String(s || '')
      .replace(/[第节]/g, '')
      .replace(/\s*([-~～—–至])\s*/g, '$1')
      .split(/[，,、\s]+/)
      .flatMap((part) => {
        const clean = part.trim();
        if (!clean) return [];
        const m = clean.match(/^(\d+)\s*[-~～—–至]\s*(\d+)$/);
        if (m) {
          const from = Number(m[1]);
          const to = Number(m[2]);
          const out = [];
          if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to >= from && to <= 20) {
            for (let i = from; i <= to; i++) out.push(i);
          }
          return out;
        }
        const n = Number(clean);
        return Number.isFinite(n) && n > 0 && n <= 20 ? [n] : [];
      });

  const parseSlots = (cells) => {
    const slots = [];
    for (let i = 0; i < cells.length; i += 3) {
      const weeks = cells[i] || '';
      const when = cells[i + 1] || '';
      const room = cells[i + 2] || '';
      const m =
        when.match(/(?:星期|周)([一二三四五六日天])\s*[\[【(（]\s*([^\]】)）]+?)\s*节?\s*[\]】)）]/) ||
        when.match(/(?:星期|周)([一二三四五六日天])\s*(?:第\s*)?(\d+(?:\s*[-~～—–至,，、]\s*\d+)*)\s*节/);
      if (!m) continue;
      const wd = m[1] === '天' ? '日' : m[1];
      const periods = parsePeriods(m[2]);
      if (!periods.length) continue;
      slots.push({
        weeks: weeks,
        weekday: '一二三四五六日'.indexOf(wd) + 1,
        periods: periods,
        room: room
      });
    }
    return slots;
  };

  const theoryTb = tables.find((t) => {
    if (!t.rows[0]) return false;
    const head = [...t.rows[0].cells].map((c) => norm(c.innerText));
    return head.some((h) => h === '任课教师') && head.some((h) => h === '学分');
  });

  const courses = [];
  if (theoryTb) {
    let cur = null;
    const allRows = [...theoryTb.rows];
    for (const row of allRows) {
      const cells = [...row.cells].map((c) => norm(c.innerText));
      const joined = cells.join(' ');
      if (joined.indexOf('任课教师') >= 0) continue;
      if (joined.indexOf('周次') >= 0 && joined.indexOf('节次') >= 0) continue;
      // 新课程行的第一个格子是「序号」，且整行有 12 列以上；
      // 续行（第 13 周、星期四[5-8节]、教室）只有 3 个格子，开头数字是周次，不能当课程号。
      if (cells.length >= 12 && /^\d+$/.test(cells[0] || '')) {
        const nameCell = cells[1] || '';
        const codeMatch = nameCell.match(/\[([^\]]+)\]/);
        cur = {
          no: cells[0],
          code: codeMatch ? codeMatch[1] : '',
          name: nameCell.replace(/^\[[^\]]+\]/, '').trim(),
          teacher: cells[2] || '',
          credits: cells[3] || '',
          hours: [cells[4], cells[5], cells[6]].filter((x) => x && x !== '0').join('/'),
          weeks: cells[7] || '',
          attendees: cells[8] || '',
          category: cells[9] || '',
          examType: cells[10] || '',
          slots: []
        };
        courses.push(cur);
        cur.slots = parseSlots(cells.slice(11));
      } else if (cur) {
        cur.slots = cur.slots.concat(parseSlots(cells));
      }
    }
  }

  const tableByHeader = (keys) =>
    tables.find((t) => {
      if (!t.rows[0]) return false;
      const head = [...t.rows[0].cells].map((c) => norm(c.innerText));
      return keys.every((k) => head.some((h) => h.indexOf(k) >= 0));
    });

  const rowsToObjects = (tb) => {
    if (!tb) return [];
    const head = [...tb.rows[0].cells].map((c) => norm(c.innerText));
    const out = [];
    for (const row of [...tb.rows].slice(1)) {
      const cells = [...row.cells].map((c) => norm(c.innerText));
      if (!cells.some(Boolean)) continue;
      const joined = cells.join('');
      if (joined.indexOf('课程序号') >= 0 || joined.indexOf('实验项目') >= 0) continue;
      const obj = {};
      head.forEach((h, i) => {
        if (h) obj[h] = cells[i] || '';
      });
      out.push(obj);
    }
    return out;
  };

  const labTb = tableByHeader(['实验项目', '实验地点']);
  const practiceTb = tableByHeader(['课程代码', '起止周', '备注']);

  return JSON.stringify({
    term: term,
    courses: courses,
    labs: rowsToObjects(labTb),
    practice: rowsToObjects(practiceTb),
    stats: {
      tableCount: tables.length,
      theoryFound: !!theoryTb,
      theoryRows: theoryTb ? theoryTb.rows.length : 0,
      heads: tables.map((t) => (t.rows[0] ? norm(t.rows[0].innerText).slice(0, 36) : ''))
    }
  });
})()`

const EXAM_JS = String.raw`(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const tables = [...document.querySelectorAll('table')];
  const tb = tables.find((t) => {
    const head = t.rows[0] ? norm(t.rows[0].innerText) : '';
    return head.indexOf('考试批次') >= 0 && head.indexOf('课程名称') >= 0;
  });
  const exams = [];
  const emptyPattern = /(?:暂无|没有)(?:相关|任何)?考试(?:安排|数据)?|无考试安排/;
  let invalidRow = false;
  if (tb) {
    const head = [...tb.rows[0].cells].map((c) => norm(c.innerText));
    for (const row of [...tb.rows].slice(1)) {
      const cells = [...row.cells].map((c) => norm(c.innerText));
      if (!cells.some(Boolean)) continue;
      const rowText = cells.join('');
      if (rowText.indexOf('考试批次') >= 0 || /^(?:暂无数据|没有数据)$/.test(rowText) || emptyPattern.test(rowText)) continue;
      const o = {};
      head.forEach((h, i) => {
        o[h] = cells[i] || '';
      });
      if (cells.length !== head.length || !o['课程名称']) {
        invalidRow = true;
        continue;
      }
      exams.push({
        batch: o['考试批次'] || '',
        code: o['课程序号'] || '',
        name: o['课程名称'] || '',
        type: o['考试类别'] || '',
        date: o['考试日期'] || '',
        time: o['考试安排'] || '',
        room: o['考试地点'] || '',
        seat: o['考场座位号'] || '',
        status: o['考试情况'] || '',
        note: o['其它说明'] || ''
      });
    }
  }
  const text = document.body.innerText || '';
  const termMatch = text.match(/20\d\d-20\d\d学年\s*\d\s*学期/);
  return JSON.stringify({
    term: termMatch ? termMatch[0].replace(/\s+/g, '') : '',
    exams,
    recognized: tb ? !invalidRow : emptyPattern.test(text),
    login: /请(?:先|重新)登录|登录已(?:失效|过期)/.test(text)
  });
})()`

const DIAG_JS = String.raw`(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const tables = [...document.querySelectorAll('table')];
  return JSON.stringify({
    url: location.href,
    readyState: document.readyState,
    tableCount: tables.length,
    bodyLen: (document.body.innerText || '').length,
    heads: tables.map((t, i) => ({
      i: i,
      id: t.id || '',
      rows: t.rows.length,
      head: norm((t.rows[0] ? t.rows[0].innerText : '').slice(0, 80))
    }))
  });
})()`

export function classifySchoolPage(url: string): 'eams' | 'expired' | 'network' | 'timeout' | 'cancelled' | 'unexpected' {
  if (!url || /^(?:load-error:|chrome-error:|about:blank$)/i.test(url)) return 'network'
  if (url === 'load-timeout:') return 'timeout'
  if (url === 'load-cancelled:') return 'cancelled'
  try {
    const { hostname, pathname, protocol } = new URL(url)
    if (protocol !== 'https:') return 'unexpected'
    if (/^cas(?:-haust-edu-cn-s)?\.haust\.edu\.cn$/.test(hostname) && /^\/cas\/login\/?$/i.test(pathname)) return 'expired'
    if (/^(?:vpn|webvpn)\.haust\.edu\.cn$/.test(hostname) &&
        /^\/(?:auth\.htm|login(?:\.html?)?)?\/?$/i.test(pathname)) return 'expired'
    if (hostname === 'jwgl-haust-edu-cn-s.haust.edu.cn' && pathname.startsWith('/eams/')) {
      return /\/[^/]*login[^/]*\/?$/i.test(pathname) ? 'expired' : 'eams'
    }
  } catch {}
  return 'unexpected'
}

export function blocksSchoolAutoLogin(reason: string): boolean {
  return reason === 'credentials' || reason === 'locked' || reason === 'captcha' || reason === 'rate_limit'
}

function assertSession(url) {
  const page = classifySchoolPage(url)
  if (page === 'eams') return
  const err = new Error(page === 'expired' ? '教务登录已失效' : '无法载入教务页面')
  err.code = page === 'expired' ? 'NO_SESSION' : page
  throw err
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 打开页面 → 抠 ids/学期 → 直接取服务端渲染好的表格页。
 * 两次 load 之间留个间隔：教务对背靠背请求有反刷（返回「请不要过快点击」空页面）。
 */
async function loadTablePage(engine, infoUrl, tableUrl) {
  const landed = await engine.load(infoUrl)
  assertSession(landed)
  let info = { ids: '', semester: '' }
  try {
    const raw = await engine.run(PAGE_INFO_JS)
    info = (typeof raw === 'string' ? JSON.parse(raw) : raw) || info
  } catch (_) {}
  const q = []
  q.push('ignoreHead=1')
  if (info.semester) q.push('semester.id=' + encodeURIComponent(info.semester))
  if (tableUrl === COURSE_TABLE_URL) {
    q.push('setting.kind=std')
    q.push('startWeek=')
    if (info.ids) q.push('ids=' + encodeURIComponent(info.ids))
  }
  const url = tableUrl + '?' + q.join('&')
  await sleep(700)
  let landed2 = await engine.load(url)
  assertSession(landed2)
  // 撞反刷：等一下再试一次（只重试一次）
  if (await tooFast(engine)) {
    await sleep(2500)
    landed2 = await engine.load(url)
    assertSession(landed2)
  }
  return { url: landed2, info }
}

/** 当前页是不是教务的「请不要过快点击」反刷页 */
async function tooFast(engine) {
  try {
    const raw = await engine.run(`(() => ((document.body.innerText || '').indexOf('请不要过快点击') >= 0))()`)
    return raw === true || raw === 'true'
  } catch (_) {
    return false
  }
}

async function fetchCourseTable(engine) {
  const { url, info } = await loadTablePage(engine, COURSE_URL, COURSE_TABLE_URL)

  await engine.waitFor(WAIT_COURSE_JS, 30000)
  let data = null
  try {
    const raw = await engine.run(COURSE_JS)
    data = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (err) {
    data = { courses: [], labs: [], practice: [], term: '', error: String(err && err.message) }
  }
  if (data) data.pageUrl = url
  if (data) data.ids = info && info.ids

  if (!data.courses || !data.courses.length) {
    // 再等 6 秒重试一次（偶发渲染慢）
    await new Promise((r) => setTimeout(r, 6000))
    try {
      const raw2 = await engine.run(COURSE_JS)
      const data2 = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2
      if (data2.courses && data2.courses.length) data = data2
    } catch (_) {}
  }

  if (!data.courses || !data.courses.length) {
    try {
      const diagRaw = await engine.run(DIAG_JS)
      data.diag = typeof diagRaw === 'string' ? JSON.parse(diagRaw) : diagRaw
    } catch (e) {
      data.diag = { error: String(e && e.message) }
    }
  }

  return Object.assign({ fetchedAt: new Date().toISOString() }, data)
}

async function fetchExams(engine) {
  const { url } = await loadTablePage(engine, EXAM_URL, EXAM_TABLE_URL)
  const raw = await engine.waitFor(`(() => {
    const raw = ${EXAM_JS};
    const result = JSON.parse(raw);
    return result.recognized || result.login ? raw : false;
  })()`, 45000)
  let data
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (_) {}
  if (data?.login) {
    const error = new Error('教务登录已失效')
    error.code = 'NO_SESSION'
    throw error
  }

  const fetchedAt = new Date().toISOString()
  if (!data?.recognized || !Array.isArray(data.exams)) {
    let diag
    try {
      const diagRaw = await engine.run(DIAG_JS)
      diag = typeof diagRaw === 'string' ? JSON.parse(diagRaw) : diagRaw
    } catch (e) {
      diag = { error: String(e && e.message) }
    }
    return { fetchedAt, pageUrl: url, term: '', exams: [], error: '无法识别教务考试安排', diag }
  }
  return { fetchedAt, pageUrl: url, term: data.term, exams: data.exams }
}

export { fetchCourseTable, fetchExams, COURSE_URL, EXAM_URL }
