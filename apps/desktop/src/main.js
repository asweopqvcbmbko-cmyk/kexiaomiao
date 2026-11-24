const { app, BrowserWindow, ipcMain, session: electronSession, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// 打包后没有控制台，启动即退这类问题靠不到 stderr；
// 设 HAUST_BOOTLOG=<文件路径> 就会把启动步骤逐条落盘（默认不写任何东西）。
const BOOTLOG = process.env.HAUST_BOOTLOG
function boot(m) {
  if (!BOOTLOG) return
  try {
    fs.appendFileSync(BOOTLOG, new Date().toISOString() + ' ' + m + '\n')
  } catch (_) {}
}
boot('electron 已进入主进程 packaged=' + app.isPackaged + ' electron=' + process.versions.electron)

const { Engine } = require('./lib/engine')
const session = require('./lib/session')
const eams = require('./lib/adapters/eams')
const notices = require('./lib/adapters/notices')
const card = require('./lib/adapters/card')
const chargers = require('./lib/chargers')
const { Store } = require('./lib/store')
const credentials = require('./lib/credentials')
boot('依赖模块全部加载完成')

const VERIFY = process.env.HAUST_VERIFY === '1'
const OFFLINE = process.env.HAUST_OFFLINE === '1'
const ROOT = path.resolve(__dirname, '..', '..', '..')
const WEB_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'web', 'index.html')
  : path.join(ROOT, 'apps', 'web', 'dist', 'index.html')
const VERIFY_DIR = path.join(ROOT, 'build', 'verify')
boot('WEB_DIST=' + WEB_DIST + ' 存在=' + fs.existsSync(WEB_DIST))

let engine = null
let store = null
let mainWin = null
let sessionState = { loggedIn: false, url: '', checkedAt: '', studentName: '' }
let sessionPromise = null
// 充电桩采集不占用浏览器窗口，但连续点刷新时要避免并发打两遍接口
let chargerPromise = null
/**
 * 所有取数都共用同一个浏览器窗口，必须串行执行：
 * 并发调用会互相抢窗口导航，结果谁都拿不到（"点了刷新没反应"就是这么来的）。
 */
let engineChain = Promise.resolve()
function withEngine(fn) {
  const run = engineChain.then(() => fn())
  engineChain = run.catch(() => {})
  return run
}

function log(line) {
  const stamp = `[${new Date().toISOString()}] ${line}\n`
  // 调试模式下写 build/verify，正式运行时写 userData/data/app.log（方便事后排查）
  try {
    if (VERIFY) {
      fs.mkdirSync(VERIFY_DIR, { recursive: true })
      fs.appendFileSync(path.join(VERIFY_DIR, 'm0.log'), stamp, 'utf8')
    }
    const dir = path.join(app.getPath('userData'), 'data')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'app.log'), stamp, 'utf8')
  } catch (_) {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function broadcast() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('haust:session', sessionState)
  }
}

/**
 * 教务侧明确返回「登录已失效」时，把本地会话状态改掉并通知界面。
 * 不这么做的话，界面会一直显示"已登录"，而课表/考试每次都静默失败，
 * 用户只看到「失败：考试」却不知道该点登录。
 */
function markSessionLost(where) {
  if (!sessionState.loggedIn) return
  log('session lost (detected by ' + where + ')')
  sessionState = {
    loggedIn: false,
    checkedAt: new Date().toISOString(),
    url: sessionState.url || '',
    studentName: sessionState.studentName || ''
  }
  store.write('session', sessionState)
  broadcast()
}

function ensureSession(interactive = true) {
  if (sessionPromise) return sessionPromise
  sessionPromise = withEngine(() => session.ensure(engine, { interactive }))
    .then((st) => {
      sessionState = st
      sessionPromise = null
      if (st.loggedIn) store.write('session', st)
      log('session ' + JSON.stringify(st))
      broadcast()
      return st
    })
    .catch((err) => {
      sessionPromise = null
      throw err
    })
  return sessionPromise
}

async function createMainWindow() {
  boot('createMainWindow 开始')
  mainWin = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: '#0f1115',
    title: '河科大校园助手',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  await mainWin.loadFile(WEB_DIST)
  boot('createMainWindow 页面已加载')
  return mainWin
}

let airconSession

function getAirconSession() {
  airconSession ??= import('./lib/aircon-session.mjs').then(({ createCloudPaymentSession }) =>
    createCloudPaymentSession(async (url, headers) => {
      const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(12_000) })
      return {
        status: response.status, data: await response.text(),
        location: response.headers.get('location'), setCookies: response.headers.getSetCookie()
      }
    }, require('./lib/aircon-browser.cjs').bootstrapCloudPayment)
  )
  return airconSession
}

function registerIpc() {
  ipcMain.handle('haust:airconRequest', async (_event, input) => {
    if (typeof input !== 'string' || input.length > 800) throw new Error('Invalid electricity query')
    const url = new URL(input)
    const origin = 'https://h5cloud.17wanxiao.com:18443'
    const directory = url.pathname === '/CloudPayment/user/getRoom.do'
    const reading = url.pathname === '/CloudPayment/user/getRoomState.do'
    const p = url.searchParams
    const names = directory ? ['optype', 'areaid', 'buildid', 'unitid', 'levelid'] : ['roomverify']
    if (url.origin !== origin || url.username || url.password || url.hash || (!directory && !reading) ||
        p.size !== names.length + 3 || p.get('payProId') !== '4620' || p.get('schoolcode') !== '1007' ||
        p.get('businesstype') !== '2' || !names.every(name => /^[a-z0-9-]{1,100}$/i.test(p.get(name) || '')) ||
        (directory && (!['2', '3', '4'].includes(p.get('optype')) || p.get('unitid') !== '0'))) {
      throw new Error('Invalid electricity query')
    }
    const request = await getAirconSession()
    return request(url)
  })

  ipcMain.handle('haust:status', async () => {
    // 验证模式下由 runVerify 自己决定要不要登录，别让渲染进程顺手拉起登录探活
    if (!VERIFY && !sessionState.checkedAt && !sessionPromise) {
      ensureSession(true).catch((err) => log('ensure failed: ' + (err && err.message)))
    }
    return Object.assign({}, sessionState, { pending: !!sessionPromise })
  })

  ipcMain.handle('haust:login', async () => {
    sessionState = { loggedIn: false, url: '', checkedAt: '', studentName: '' }
    return await ensureSession(true)
  })

  ipcMain.handle('haust:refreshCourses', async () => {
    const t0 = Date.now()
    if (OFFLINE) {
      const c = store.read('courses')
      if (c) return c
      throw new Error('offline')
    }
    try {
      const data = await withEngine(() => eams.fetchCourseTable(engine))
      if (data && data.courses && data.courses.length) {
        store.write('courses', data)
        log(`courses ok ${Date.now() - t0}ms n=${data.courses.length}`)
        return data
      }
      const cached = store.read('courses')
      if (cached && cached.courses && cached.courses.length) {
        log(`courses empty -> cached n=${cached.courses.length}`)
        return { ...cached, stale: true }
      }
      log('courses empty, no cache')
      return data
    } catch (err) {
      log(`courses FAIL ${err.code || ''} ${err.message}`)
      if (err && err.code === 'NO_SESSION') markSessionLost('courses')
      const cached = store.read('courses')
      if (cached && cached.courses && cached.courses.length) return { ...cached, stale: true }
      throw err
    }
  })

  ipcMain.handle('haust:refreshExams', async () => {
    const t0 = Date.now()
    if (OFFLINE) {
      const c = store.read('exams')
      if (c) return c
      throw new Error('offline')
    }
    try {
      const data = await withEngine(() => eams.fetchExams(engine))
      if (data && data.exams && data.exams.length) {
        store.write('exams', data)
        log(`exams ok ${Date.now() - t0}ms n=${data.exams.length}`)
        return data
      }
      const cached = store.read('exams')
      if (cached && cached.exams && cached.exams.length) {
        log(`exams empty -> cached n=${cached.exams.length} diag=${JSON.stringify(data.diag || {}).slice(0, 200)}`)
        return { ...cached, stale: true }
      }
      log(`exams empty, no cache. diag=${JSON.stringify(data.diag || {}).slice(0, 300)}`)
      return data
    } catch (err) {
      log(`exams FAIL ${err.code || ''} ${err.message}`)
      if (err && err.code === 'NO_SESSION') markSessionLost('exams')
      const cached = store.read('exams')
      if (cached && cached.exams && cached.exams.length) return { ...cached, stale: true }
      throw err
    }
  })

  ipcMain.handle('haust:refreshNotices', async () => {
    if (OFFLINE) {
      const c = store.read('notices')
      if (c) return c
      throw new Error('offline')
    }
    try {
      const data = await withEngine(() => notices.fetchList(engine))
      store.write('notices', data)
      return data
    } catch (err) {
      const cached = store.read('notices')
      if (cached) return { ...cached, stale: true, error: String(err && err.message) }
      throw err
    }
  })

  ipcMain.handle('haust:noticeBody', async (_e, item) => {
    return await withEngine(() => notices.fetchBody(engine, item))
  })

  /**
   * 充电桩：公开接口，不依赖登录态，所以不走 withEngine（不能和课表抢那个串行队列，
   * 否则一次充电桩刷新会把课表刷新堵在后面）。
   */
  ipcMain.handle('haust:refreshChargers', async () => {
    const t0 = Date.now()
    if (OFFLINE) {
      const c = store.read('chargers')
      if (c) return c
      throw new Error('offline')
    }
    if (chargerPromise) {
      log('chargers join in-flight')
      return chargerPromise
    }
    chargerPromise = (async () => {
      try {
        const data = await chargers.collect()
        if (data && data.rows && data.rows.length) {
          store.write('chargers', data)
          log(
            `chargers ok ${Date.now() - t0}ms rows=${data.rows.length} points=${data.totals.points} ` +
              `devices=${data.totals.devices} free=${data.totals.free}/${data.totals.total}`
          )
          return data
        }
        const cached = store.read('chargers')
        if (cached && cached.rows && cached.rows.length) {
          log('chargers empty -> cached')
          return { ...cached, stale: true }
        }
        return data
      } catch (err) {
        log(`chargers FAIL ${err.code || ''} ${err.message}`)
        const cached = store.read('chargers')
        if (cached && cached.rows && cached.rows.length) return { ...cached, stale: true }
        throw err
      }
    })()
    try {
      return await chargerPromise
    } finally {
      chargerPromise = null
    }
  })

  ipcMain.handle('haust:refreshCard', async () => {
    if (OFFLINE) {
      const c = store.read('card')
      if (c) return c
      throw new Error('offline')
    }
    try {
      const data = await withEngine(() => card.fetchCard(engine))
      store.write('card', data)
      return data
    } catch (err) {
      const cached = store.read('card')
      if (cached) return { ...cached, stale: true }
      throw err
    }
  })

  // ---------- 学习通 ----------

  ipcMain.handle('haust:credStatus', async () => {
    const c = credentials.load()
    return {
      saved: !!(c && c.username),
      username: c && c.username ? String(c.username) : '',
      encryptionAvailable: credentials.available()
    }
  })

  ipcMain.handle('haust:clearCred', async () => {
    return credentials.clear()
  })

  ipcMain.handle('haust:clearCache', async () => {
    store.clear()
    return true
  })

  ipcMain.handle('haust:openExternal', async (_e, url) => {
    if (url && /^https?:\/\//.test(url)) {
      shell.openExternal(url)
      return true
    }
    return false
  })

  ipcMain.handle('haust:cached', async () => {
    const c = {
      courses: store.read('courses'),
      exams: store.read('exams'),
      notices: store.read('notices'),
      chargers: store.read('chargers'),
      card: store.read('card'),
      session: store.read('session')
    }
    log(
      'cached called: courses=' +
        (c.courses && c.courses.courses ? c.courses.courses.length : 'null') +
        ' notices=' +
        (c.notices && c.notices.items ? c.notices.items.length : 'null')
    )
    return c
  })
}

async function runVerify() {
  log('verify start')

  if (process.env.HAUST_ONLY === 'exam') {
    const st = await ensureSession(true)
    log('session ' + JSON.stringify(st).slice(0, 200))
    const data = await withEngine(() => eams.fetchExams(engine)).catch((e) => ({ error: e.message }))
    fs.mkdirSync(VERIFY_DIR, { recursive: true })
    fs.writeFileSync(path.join(VERIFY_DIR, 'exams.json'), JSON.stringify(data, null, 2))
    await engine.captureTo(path.join(VERIFY_DIR, 'exam-page.png'))
    log('exams=' + (data && data.exams ? data.exams.length : JSON.stringify(data).slice(0, 400)))
    app.quit()
    return
  }

  if (process.env.HAUST_ONLY === 'charger') {
    // 充电桩采集不依赖学校登录态（公开接口），所以这里故意不调 ensureSession
    const t0 = Date.now()
    const data = await chargers.collect().catch((e) => ({ error: e.message }))
    fs.mkdirSync(VERIFY_DIR, { recursive: true })
    fs.writeFileSync(path.join(VERIFY_DIR, 'chargers.json'), JSON.stringify(data, null, 2))
    if (data && data.rows) {
      log(
        `chargers ok ${Date.now() - t0}ms rows=${data.rows.length} points=${data.totals.points} ` +
          `devices=${data.totals.devices} free=${data.totals.free}/${data.totals.total}`
      )
      log('areas ' + JSON.stringify(data.byArea))
      for (const r of data.rows) {
        log(`  ${r.area} | ${r.display} | ${r.free}/${r.total} | points=${r.points} dev=${r.deviceCount} ${r.distance}m`)
      }
    } else {
      log('chargers FAIL ' + JSON.stringify(data).slice(0, 300))
    }
    if (data && data.rows) store.write('chargers', data)

    // HAUST_SHOT=1 时顺便开主窗口截一张「充电桩」页，用于前端人工核对（不需要学校登录）
    if (process.env.HAUST_SHOT === '1') {
      const win = await createMainWindow()
      await sleep(4000)
      await win.webContents
        .executeJavaScript(
          `(() => { const b = [...document.querySelectorAll('.nav-item')].find(x => (x.textContent||'').includes('充电桩')); if (b) { b.click(); return true } return false })()`,
          true
        )
        .catch(() => false)
      for (let i = 0; i < 30; i++) {
        const n = await win.webContents
          .executeJavaScript(`document.querySelectorAll('.chg-list .charger-card').length`, true)
          .catch(() => 0)
        if (n > 0) break
        await sleep(500)
      }
      await sleep(800)
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(VERIFY_DIR, 'tab-charger.png'), img.toPNG())
      log('charger screenshot saved')
    }

    app.quit()
    return
  }

  if (process.env.HAUST_OFFLINE === '1') {
    // 纯界面自检：不碰网络，只用本地缓存渲染；顺带把新界面的宽度/主题/勾选动画跑一遍
    const win = await createMainWindow()
    const evalJs = async (js) => {
      try {
        return await win.webContents.executeJavaScript(js, true)
      } catch (e) {
        return 'ERR:' + (e && e.message)
      }
    }
    const shot = async (name) => {
      try {
        if (typeof win.webContents.invalidate === 'function') win.webContents.invalidate()
      } catch (_) {}
      await sleep(220)
      try {
        const img = await win.webContents.capturePage()
        fs.writeFileSync(path.join(VERIFY_DIR, name), img.toPNG())
      } catch (e) {
        log('shot FAIL ' + name + ' ' + (e && e.message))
      }
    }
    const clickText = (sel, text) =>
      evalJs(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
          .find(x => (x.textContent || '').includes(${JSON.stringify(text)}))
        if (!el) return 'none'
        el.click()
        return 'ok'
      })()`)
    const h1 = () => evalJs(`(document.querySelector('.topbar h1') || {}).textContent || ''`)
    const goTab = async (label) => {
      for (let i = 0; i < 8; i++) {
        await clickText('.mobile-nav button, .sidebar nav button', label)
        await sleep(360)
        const t = String(await h1()).trim()
        if (t === label || (label === '今天' && t === '校园')) return true
      }
      return false
    }
    const overflow = () =>
      evalJs(`(() => {
        const d = document.documentElement
        return d.scrollWidth > d.clientWidth ? d.scrollWidth + '>' + d.clientWidth : 'none'
      })()`)
    const report = {}
    try {
      await sleep(4500)
      win.setMinimumSize(320, 400)
      await evalJs(`localStorage.setItem('haust-theme', '"dark"'); 1`)
      win.webContents.reload()
      await sleep(2800)

    /* 1. 三个手机宽度 + 桌面宽度：首页截图 + 横向溢出检查 */
    for (const w of [360, 393, 430]) {
      log('ui step width ' + w)
      win.setContentSize(w, 860)
      await sleep(600)
      await goTab('今天')
      await sleep(400)
      await shot('ui-' + w + '-home.png')
      report['home@' + w] = { overflow: await overflow() }
    }
    win.setContentSize(360, 860)
    await sleep(500)
    await goTab('课表')
    await shot('ui-360-schedule-day.png')
    report['schedule@360'] = { overflow: await overflow(), h1: await h1() }
    await clickText('.segment button', '周视图')
    await sleep(500)
    await shot('ui-360-schedule-week.png')
    report['scheduleWeek@360'] = {
      overflow: await overflow(),
      gridScrollable: await evalJs(`(() => { const g = document.querySelector('.gridwrap'); return g ? g.scrollWidth > g.clientWidth : 'no-grid' })()`),
      blocks: await evalJs(`document.querySelectorAll('.courseblock').length`)
    }

    /* 安卓返回键会调 window.__haustBack()：断言它按 弹窗 → 子页 → 首页 逐级返回 */
    log('ui step back hook')
    report.backHook = await evalJs(`(async () => {
      const out = { hasHook: typeof window.__haustBack === 'function' }
      const block = document.querySelector('.courseblock')
      if (!block) return Object.assign(out, { err: 'no-block' })
      block.click()
      await new Promise((r) => setTimeout(r, 380))
      out.modalBefore = !!document.querySelector('.dialog')
      out.ret1 = window.__haustBack()
      await new Promise((r) => setTimeout(r, 380))
      out.modalAfter = !!document.querySelector('.dialog')
      out.h1After = (document.querySelector('.topbar h1') || {}).textContent || ''
      out.ret2 = window.__haustBack()
      await new Promise((r) => setTimeout(r, 380))
      out.h1Back = (document.querySelector('.topbar h1') || {}).textContent || ''
      return out
    })()`)

    await clickText('.segment button', '日视图')
    await sleep(400)

    win.setContentSize(393, 860)
    await sleep(500)
    log('ui step theme')
    /* 5. 主题：浅色 → 重载后仍在 → 回到深色 */
    await goTab('我的')
    await sleep(300)
    await shot('ui-393-profile.png')
    await clickText('.iconbtn', '')
    await evalJs(`(() => { const b = [...document.querySelectorAll('.themechoice')].find(x => x.textContent.includes('浅色')); if (b) b.click(); return 1 })()`)
    await sleep(400)
    report.themeLight = await evalJs(`document.documentElement.dataset.theme`)
    await shot('ui-393-light.png')
    win.webContents.reload()
    await sleep(2600)
    report.themeAfterReload = await evalJs(`document.documentElement.dataset.theme`)
    await shot('ui-393-light-reload.png')
    await sleep(600)
    await goTab('我的')
    await sleep(400)
    await evalJs(`(() => { const b = [...document.querySelectorAll('.themechoice')].find(x => x.textContent.includes('深色')); if (b) b.click(); return 1 })()`)
    await sleep(500)
    report.themeBack = await evalJs(`document.documentElement.dataset.theme`)

    log('ui step subs')
    /* 6. 通知 / 充电桩 子页 */
    win.setContentSize(393, 860)
    await sleep(400)
    await goTab('今天')
    await clickText('.campus-tile', '通知')
    await sleep(600)
    await shot('ui-393-notices.png')
    report.notices = { h1: await h1(), rows: await evalJs(`document.querySelectorAll('.notice').length`) }
    await clickText('.softbtn', '')
    await sleep(300)
    await goTab('今天')
    await clickText('.campus-tile', '充电桩')
    await sleep(600)
    await shot('ui-393-chargers.png')
    report.chargers = { h1: await h1(), rows: await evalJs(`document.querySelectorAll('.taskrow').length`) }

    log('ui step desktop')
    /* 7. 桌面宽度 */
    win.setContentSize(1240, 900)
    await sleep(700)
    await goTab('今天')
    await shot('ui-desktop-home.png')
    report.desktop = { overflow: await overflow(), sidebar: await evalJs(`!!document.querySelector('.sidebar')`) }

    } catch (err) {
      report.error = String((err && err.message) || err)
      log('ui check ERROR ' + report.error)
    }

    fs.writeFileSync(path.join(VERIFY_DIR, 'ui-report.json'), JSON.stringify(report, null, 2))
    for (const k of Object.keys(report)) log('ui ' + k + ' = ' + JSON.stringify(report[k]))
    log('ui check done')
    app.quit()
    return
  }

  const st = await ensureSession(true)
  log('session result ' + JSON.stringify(st))
  log('autoSteps ' + JSON.stringify(st.autoSteps || []))

  if (!st.loggedIn) {
    await engine.captureTo(path.join(VERIFY_DIR, 'login.png'))
    fs.writeFileSync(path.join(VERIFY_DIR, 'session.json'), JSON.stringify(st, null, 2))
    app.quit()
    return
  }

  const courses = await eams.fetchCourseTable(engine).catch((e) => ({ error: e.message }))
  const exams = await eams.fetchExams(engine).catch((e) => ({ error: e.message }))
  const noti = await notices.fetchList(engine).catch((e) => ({ error: e.message }))
  const chargerData = await chargers.collect().catch((e) => ({ error: e.message }))
  const cardInfo = await card.fetchCard(engine).catch((e) => ({ error: e.message }))
  if (courses && courses.courses && courses.courses.length) store.write('courses', courses)
  if (exams && exams.exams && exams.exams.length) store.write('exams', exams)
  if (noti && noti.items) store.write('notices', noti)
  if (chargerData && chargerData.rows) store.write('chargers', chargerData)
  if (cardInfo && cardInfo.balance) store.write('card', cardInfo)

  let bodySamples = []
  if (noti && noti.items && noti.items.length) {
    for (const src of ['school', 'news', 'jwc', 'cl']) {
      const item = noti.items.find((n) => n.source === src)
      if (!item) continue
      const b = await notices.fetchBody(engine, item).catch((e) => ({ error: e.message }))
      bodySamples.push({ source: src, title: item.title, len: b && b.text ? b.text.length : 0, error: b && b.error, url: b && b.url })
    }
  }

  fs.mkdirSync(VERIFY_DIR, { recursive: true })
  fs.writeFileSync(path.join(VERIFY_DIR, 'courses.json'), JSON.stringify(courses, null, 2))
  fs.writeFileSync(path.join(VERIFY_DIR, 'exams.json'), JSON.stringify(exams, null, 2))
  fs.writeFileSync(path.join(VERIFY_DIR, 'notices.json'), JSON.stringify(noti, null, 2))
  fs.writeFileSync(path.join(VERIFY_DIR, 'chargers.json'), JSON.stringify(chargerData, null, 2))
  fs.writeFileSync(path.join(VERIFY_DIR, 'card.json'), JSON.stringify(cardInfo, null, 2))
  fs.writeFileSync(path.join(VERIFY_DIR, 'notice-body.json'), JSON.stringify(bodySamples, null, 2))
  fs.writeFileSync(path.join(VERIFY_DIR, 'session.json'), JSON.stringify(st, null, 2))
  log('courses=' + (courses && courses.courses ? courses.courses.length : JSON.stringify(courses)))
  log('exams=' + (exams && exams.exams ? exams.exams.length : JSON.stringify(exams)))
  log('notices=' + (noti && noti.items ? noti.items.length : JSON.stringify(noti)))
  log(
    'chargers=' +
      (chargerData && chargerData.rows
        ? `${chargerData.rows.length}行 点位${chargerData.totals.points} 空${chargerData.totals.free}/${chargerData.totals.total}`
        : JSON.stringify(chargerData).slice(0, 200))
  )
  log('card=' + JSON.stringify(cardInfo).slice(0, 160))
  log('bodies=' + JSON.stringify(bodySamples.map((b) => b.source + ':' + b.len)))

  const win = await createMainWindow()
  await sleep(7000)
  const shot = async (name) => {
    try {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(VERIFY_DIR, name), img.toPNG())
    } catch (_) {}
  }
  await shot('home.png')

  const clickNav = async (label) => {
    try {
      await win.webContents.executeJavaScript(
        `(() => { const b = [...document.querySelectorAll('.nav-item')].find(x => (x.textContent||'').includes(${JSON.stringify(
          label
        )})); if (b) { b.click(); return true } return false })()`,
        true
      )
    } catch (_) {}
  }

  await clickNav('课表')
  for (let i = 0; i < 45; i++) {
    const ok = await win.webContents
      .executeJavaScript(`!!document.querySelector('.tt-cell.filled')`, true)
      .catch(() => false)
    if (ok) break
    await sleep(2000)
  }
  await sleep(500)
  await shot('tab-table.png')

  await clickNav('通知')
  for (let i = 0; i < 40; i++) {
    const n = await win.webContents
      .executeJavaScript(`document.querySelectorAll('.notice-item').length`, true)
      .catch(() => 0)
    if (n > 0) break
    await sleep(2000)
  }
  await sleep(500)
  await shot('tab-notice.png')

  await clickNav('充电桩')
  for (let i = 0; i < 30; i++) {
    const n = await win.webContents
      .executeJavaScript(`document.querySelectorAll('.charger-card').length`, true)
      .catch(() => 0)
    if (n > 0) break
    await sleep(1000)
  }
  await sleep(500)
  await shot('tab-charger.png')
  log('screenshots saved')
  await sleep(400)
  app.quit()
}

/**
 * 单实例锁。
 * 必须要有：两个进程同时用同一个 userData 会抢 Chromium 的 persist:haust 分区，
 * 直接后果是学校会话莫名失效、课表/考试报「登录已失效」，而且缓存互相覆盖。
 * 验证模式要能反复起，所以跳过锁。
 */
if (!VERIFY) {
  const gotLock = app.requestSingleInstanceLock()
  boot('singleInstanceLock=' + gotLock)
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (mainWin && !mainWin.isDestroyed()) {
        if (mainWin.isMinimized()) mainWin.restore()
        mainWin.show()
        mainWin.focus()
      }
    })
  }
}

app.whenReady().then(async () => {
  boot('whenReady 触发 verify=' + VERIFY)
  if (!VERIFY && !app.hasSingleInstanceLock()) return
  engine = new Engine()
  store = new Store(app.getPath('userData'))
  if (!store.read('storage-retirement-v1')) {
    try {
      for (const key of ['tasks', 'done']) fs.rmSync(store.file(key), { force: true })
      fs.rmSync(path.join(app.getPath('userData'), 'chaoxing_session.enc'), { force: true })
      await electronSession.fromPartition('persist:chaoxing').clearStorageData()
      store.write('storage-retirement-v1', true)
    } catch {
      log('Retired local data cleanup failed; will retry at next startup')
    }
  }
  registerIpc()

  if (process.env.HAUST_SEED_USER && process.env.HAUST_SEED_PASS) {
    const ok = credentials.save({
      username: process.env.HAUST_SEED_USER,
      password: process.env.HAUST_SEED_PASS
    })
    log('credential seeded: ' + ok + ' available=' + credentials.available())
  }

  if (VERIFY) {
    await runVerify()
    return
  }

  await createMainWindow()

  // 会话缓存：1 小时内的登录态直接复用，避免每次启动都去探活（WebVPN 中转很慢）
  const cached = store.read('session')
  const fresh =
    cached && cached.loggedIn && Date.now() - new Date(cached.checkedAt).getTime() < 60 * 60 * 1000
  if (fresh) {
    sessionState = cached
    broadcast()
  } else {
    ensureSession(true)
  }
})

app.on('window-all-closed', () => {
  // 验证模式下没有主窗口，登录窗关掉会触发这条；那时采集还在跑，不能跟着退
  if (VERIFY) return
  app.quit()
})
