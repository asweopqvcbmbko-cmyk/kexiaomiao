/**
 * 教务系统（EAMS）适配器
 * 所有解析都在页面上下文完成，主进程只拿结构化 JSON。
 */

const COURSE_URL = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/courseTableForStd.action'
const EXAM_URL = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/stdExamTable.action'

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
      .split(/[，,]/)
      .flatMap((part) => {
        const m = part.match(/(\d+)\s*-\s*(\d+)/);
        if (m) {
          const out = [];
          for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
          return out;
        }
        const n = Number(part.trim());
        return Number.isFinite(n) && n > 0 ? [n] : [];
      });

  const parseSlots = (cells) => {
    const slots = [];
    for (let i = 0; i < cells.length; i += 3) {
      const weeks = cells[i] || '';
      const when = cells[i + 1] || '';
      const room = cells[i + 2] || '';
      const m = when.match(/星期([一二三四五六日])\s*\[([^\]]*)节\]/);
      if (!m) continue;
      slots.push({
        weeks: weeks,
        weekday: '一二三四五六日'.indexOf(m[1]) + 1,
        periods: parsePeriods(m[2]),
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
  if (tb) {
    const head = [...tb.rows[0].cells].map((c) => norm(c.innerText));
    for (const row of [...tb.rows].slice(1)) {
      const cells = [...row.cells].map((c) => norm(c.innerText));
      if (!cells.some(Boolean)) continue;
      if (cells.join('').indexOf('考试批次') >= 0) continue;
      const o = {};
      head.forEach((h, i) => {
        o[h] = cells[i] || '';
      });
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
  const termMatch = (document.body.innerText || '').match(/20\d\d-20\d\d学年\s*\d\s*学期/);
  return JSON.stringify({ term: termMatch ? termMatch[0].replace(/\s+/g, '') : '', exams: exams });
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

function isLoginUrl(url) {
  return /loginExt|cas\.haust\.edu\.cn|vpn\.haust\.edu\.cn|auth\.htm|passport/i.test(url || '')
}

function assertSession(url) {
  if (String(url).indexOf('/eams/') < 0 || isLoginUrl(url)) {
    const err = new Error('登录已失效')
    err.code = 'NO_SESSION'
    throw err
  }
}

async function fetchCourseTable(engine) {
  const url = await engine.load(COURSE_URL)
  assertSession(url)

  await engine.waitFor(WAIT_COURSE_JS, 30000)
  let data = null
  try {
    const raw = await engine.run(COURSE_JS)
    data = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (err) {
    data = { courses: [], labs: [], practice: [], term: '', error: String(err && err.message) }
  }

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
  const url = await engine.load(EXAM_URL)
  assertSession(url)

  await engine.waitFor(WAIT_EXAM_JS, 45000)
  let data = null
  try {
    const raw = await engine.run(EXAM_JS)
    data = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (err) {
    data = { exams: [], term: '', error: String(err && err.message) }
  }

  // 表还没渲染出来时再等一次
  if (!data.exams || !data.exams.length) {
    await new Promise((r) => setTimeout(r, 6000))
    try {
      const raw2 = await engine.run(EXAM_JS)
      const data2 = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2
      if (data2.exams && data2.exams.length) data = data2
    } catch (_) {}
  }

  if (!data.exams || !data.exams.length) {
    try {
      const diagRaw = await engine.run(DIAG_JS)
      data.diag = typeof diagRaw === 'string' ? JSON.parse(diagRaw) : diagRaw
    } catch (_) {}
  }

  return Object.assign({ fetchedAt: new Date().toISOString() }, data)
}

module.exports = { fetchCourseTable, fetchExams, COURSE_URL, EXAM_URL }
