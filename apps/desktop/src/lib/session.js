const { UA } = require('./engine')
const creds = require('./credentials')
const auto = require('./autologin')

const HOME = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/homeExt.action'
const EAMS_RE = /jwgl-haust-edu-cn-s\.haust\.edu\.cn\/eams\//
const AUTH_RE = /cas\.haust\.edu\.cn|vpn\.haust\.edu\.cn/

function isEams(url) {
  return EAMS_RE.test(url || '') && !/loginExt/.test(url || '')
}

function snapshot(win, loggedIn, info) {
  const i = info || {}
  return {
    loggedIn: loggedIn,
    url: win && !win.isDestroyed() ? win.webContents.getURL() : '',
    checkedAt: new Date().toISOString(),
    studentName: i.name || '',
    currentWeek: i.week === undefined ? null : i.week
  }
}

const INFO_JS = `(() => {
  const txt = document.body.innerText || ''
  const patterns = [
    /您好[，,\\s]*([\\u4e00-\\u9fa5]{2,4})/,
    /([\\u4e00-\\u9fa5]{2,4})\\s*[（(]\\s*\\d{8,}\\s*[)）]/,
    /学生[：:\\s]*([\\u4e00-\\u9fa5]{2,4})/
  ]
  let name = ''
  for (const re of patterns) {
    const m = txt.match(re)
    if (m && m[1]) { name = m[1]; break }
  }
  const w = txt.match(/第\\s*(\\d{1,2})\\s*教学周/)
  return JSON.stringify({ name: name, week: w ? Number(w[1]) : null })
})()`

async function readInfo(engine) {
  try {
    const raw = await engine.run(INFO_JS)
    const info = typeof raw === 'string' ? JSON.parse(raw) : raw
    return info || { name: '', week: null }
  } catch (_) {
    return { name: '', week: null }
  }
}

/** 已保存凭据时先尝试自动登录；失败再交给用户 */
async function tryAuto(engine) {
  const steps = []
  const cred = creds.load()
  if (!cred || !cred.username || !cred.password) return { ok: false, steps: ['no-cred'] }
  try {
    const r = await auto.tryAutoLogin(engine, cred, isEams)
    steps.push(...r.steps)
    return { ok: r.ok, steps }
  } catch (e) {
    steps.push('auto-err:' + (e && e.message))
    return { ok: false, steps }
  }
}

async function ensure(engine, options) {
  const opts = options || {}
  const timeoutMs = opts.timeoutMs || 10 * 60 * 1000
  const interactive = opts.interactive !== false

  const win = await engine.ensureWindow(false)
  const current = win.webContents.getURL()

  if (isEams(current)) {
    engine.hide()
    return snapshot(win, true, await readInfo(engine))
  }

  if (current && AUTH_RE.test(current)) {
    if (!interactive) return snapshot(win, false)
    const a = await tryAuto(engine)
    if (a.ok) {
      engine.hide()
      const st = snapshot(win, true, await readInfo(engine))
      st.autoSteps = a.steps
      return st
    }
    win.show()
    const st = await waitForLogin(engine, win, timeoutMs)
    st.autoSteps = a.steps
    return st
  }

  try {
    await win.loadURL(HOME, { userAgent: UA })
  } catch (_) {}

  const landed = win.webContents.getURL()
  if (isEams(landed)) {
    engine.hide()
    return snapshot(win, true, await readInfo(engine))
  }

  if (!interactive) return snapshot(win, false)

  const a = await tryAuto(engine)
  if (a.ok) {
    engine.hide()
    const st = snapshot(win, true, await readInfo(engine))
    st.autoSteps = a.steps
    return st
  }

  win.show()
  const st = await waitForLogin(engine, win, timeoutMs)
  st.autoSteps = a.steps
  return st
}

function waitForLogin(engine, win, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false

    const finish = async (ok) => {
      if (settled) return
      settled = true
      cleanup()
      if (ok) {
        engine.hide()
        resolve(snapshot(win, true, await readInfo(engine)))
      } else {
        resolve(snapshot(win, false))
      }
    }

    const probe = () => {
      try {
        if (isEams(win.webContents.getURL())) finish(true)
      } catch (_) {}
    }

    const onNav = () => setTimeout(probe, 800)
    const onClose = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      try {
        win.webContents.removeListener('did-navigate', onNav)
        win.webContents.removeListener('did-finish-load', onNav)
        win.webContents.removeListener('did-navigate-in-page', onNav)
        win.removeListener('closed', onClose)
      } catch (_) {}
    }

    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-finish-load', onNav)
    win.webContents.on('did-navigate-in-page', onNav)
    win.once('closed', onClose)

    probe()
  })
}

async function check(engine) {
  if (engine.win && isEams(engine.url())) {
    return snapshot(engine.win, true, await readInfo(engine))
  }
  const url = await engine.load(HOME)
  const ok = isEams(url)
  if (ok) engine.hide()
  return {
    loggedIn: ok,
    url: url,
    checkedAt: new Date().toISOString(),
    studentName: ok ? (await readInfo(engine)).name : '',
    currentWeek: ok ? (await readInfo(engine)).week : null
  }
}

module.exports = { ensure, check, isEams, HOME }
