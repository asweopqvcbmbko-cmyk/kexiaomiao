/**
 * 安卓版的 window.haust —— 与桌面主进程的 20 个 IPC 方法一一对应。
 * 界面代码只认 apps/web/src/env.d.ts 里那份契约，所以这里接上以后界面一行都不用改。
 *
 * 组成：
 *   engine  → Java 插件 SchoolBrowser（隐藏 WebView + CookieManager）
 *   http    → CapacitorHttp（充电桩）
 *   store   → localStorage（业务缓存），Android Keystore（教务凭据）
 *   eams / notices / card → 从桌面端逐行移植的解析模块
 */
import { chaoxing, eams, notices, card, chargers } from './lib/exports'
import { browser, engine, overlay } from './engine'
import { CapacitorHttp, ExceptionCode, registerPlugin } from '@capacitor/core'
import { retireStudyData } from './retired-study-data'
import { createAirconElectricityService } from './lib/aircon-electricity'
import {
  authDelay, authPageScript, AuthFlowError, classifyAuthError, classifyAuthRisk,
  driveAuth, failAuth, inspectAuthPage, waitForAuthInput, type AuthBrowser
} from './lib/auth-flow'
import { CHAOXING_LAST_ACCOUNT_KEY, driveChaoxingAuth, isChaoxingDestination, rememberChaoxingAccount } from './lib/chaoxing-auth'
import { readChaoxingSnapshot } from '../snapshot'
import { readSubscribedColleges } from '../college-notices'
import { createCloudPaymentSession } from '../../../desktop/src/lib/aircon-session.mjs'
import {
  WebVpnAuthError,
  getAllNoticeKeys,
  getAllNotices,
  getCachedNoticeBody,
  saveNoticeBody,
  upsertNotices
} from '../notice-db'
import type { AuthOptions, AuthRequest, AuthResult, CaptchaAnswer, ChaoxingActivitiesResult, ChaoxingDashboard, ChaoxingProgressResult, CourseTable, SchoolLogin, SessionStatus } from '../types'

const HOME = 'https://jwgl-haust-edu-cn-s.haust.edu.cn/eams/homeExt.action'
const EAMS_RE = /jwgl-haust-edu-cn-s\.haust\.edu\.cn\/eams\//

const isEams = (url: string) => EAMS_RE.test(url || '') && !/loginExt/.test(url || '')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** 安卓端没有主进程日志，console.log 会进 logcat（Capacitor/Console），排查时靠它 */
const log = (...a: any[]) => {
  try {
    console.log('[haust]', ...a)
  } catch (_) {}
}

/** 页面内容判定：真的进了教务首页才算登录成功，避免被 CAS 中间页骗过 */
const LOGGED_IN_JS = `(() => {
  const t = document.body.innerText || '';
  const hasNav = /退出|个人信息|课表查询|考试安排|成绩查询|我的课程/.test(t);
  const isLogin = /统一身份认证|用户登录|用户名|忘记密码/.test(t);
  return JSON.stringify({
    ok: hasNav && !isLogin,
    url: location.href,
    len: t.length,
    head: t.replace(/\\s+/g, ' ').slice(0, 60)
  });
})()`

/** 教务 CAS 回来后会停在「统一身份认证登录」落地页，要点一次「登录」才进系统 */
const LANDING_CLICK_JS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const cands = [...document.querySelectorAll('button, a, input[type=submit], input[type=button], .el-button, div, span, [role=button]')]
    .filter((el) => el.offsetParent !== null)
    .filter((el) => /^登录$|^统一身份认证登录$|^立即登录$/.test(norm(el.innerText || el.value || '')));
  if (!cands.length) return 'none';
  const el = cands[0];
  el.click();
  return 'clicked';
})()`

const isEamsLanding = (url: string) => /\/eams\/(loginExt|.*login[^/]*\.action)/i.test(url || '')
const CAS_LOGIN = /^https:\/\/cas(?:-haust-edu-cn-s)?\.haust\.edu\.cn\/cas\/login(?:[?#]|$)/
const isCasPage = (url: string) => CAS_LOGIN.test(url)

/* ---------------- 串行锁 ---------------- */
/** 隐藏 WebView 只有一个，所有靠它取数的调用都必须串行（桌面版是 withEngine） */
let chain: Promise<any> = Promise.resolve()
function withEngine<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/* ---------------- 本地缓存 ---------------- */
const K = (k: string) => `haust.cache.${k}`
function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(K(k))
    return raw ? (JSON.parse(raw) as T) : null
  } catch (_) {
    return null
  }
}
function write<T>(k: string, v: T): T {
  try {
    localStorage.setItem(K(k), JSON.stringify(v))
  } catch (_) {}
  return v
}
function keys(): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(K(''))) out.push(k)
    }
  } catch (_) {}
  return out
}

/** 清理与当前教务账号绑定的缓存（课表/考试/校园卡/会话/空调认证令牌），保留宿舍空调房间绑定配置 */
function clearAccountCache() {
  for (const key of ['courses', 'exams', 'card', 'session', 'aircon.jwt']) {
    try {
      localStorage.removeItem(K(key))
    } catch (_) {}
  }
}

const SCHOOL_IDENTITY_KEY = 'haust.school.session-account'

const sessionListeners = new Set<(st: SessionStatus) => void>()
function emitSession(st: SessionStatus) {
  for (const cb of [...sessionListeners]) {
    try {
      cb(st)
    } catch (_) {}
  }
}

/* 凭据操作与登录共用串行队列，避免清除凭据时被自动重登写回。 */
type Credential = Pick<SchoolLogin, 'username' | 'password'>
const legacyCred = 'haust.cred.v1'
const credentialStore = registerPlugin<{
  read(): Promise<Partial<Credential>>
  write(credential: Credential): Promise<void>
  clear(): Promise<void>
  readChaoxing(): Promise<Partial<Credential>>
  writeChaoxing(credential: Credential): Promise<void>
  clearChaoxing(): Promise<void>
}>('SchoolCredentials')

async function readCred(): Promise<Credential | null> {
  const current = await credentialStore.read()
  if (current.username && current.password) {
    localStorage.removeItem(K(legacyCred))
    return { username: current.username, password: current.password }
  }
  const legacy = read<{ u: string; p: string }>(legacyCred)
  if (!legacy || typeof legacy.u !== 'string' || typeof legacy.p !== 'string' || !legacy.u || !legacy.p) return null
  const migrated = { username: legacy.u, password: legacy.p }
  await credentialStore.write(migrated)
  localStorage.removeItem(K(legacyCred))
  return migrated
}

async function clearSavedCred(): Promise<void> {
  localStorage.removeItem(K(legacyCred))
  await credentialStore.clear()
}

async function readChaoxingCred(): Promise<Credential | null> {
  const { username, password } = await credentialStore.readChaoxing()
  return username && password ? { username, password } : null
}

async function clearSavedChaoxingCred(): Promise<void> {
  try {
    await credentialStore.clearChaoxing()
  } catch (error) {
    // Older Android binaries have no v2 credential store.
    if ((error as { code?: string } | null)?.code !== ExceptionCode.Unimplemented) throw error
  }
}

async function clearSchoolCookies(): Promise<boolean> {
  const result = await browser.clearCookiesForHosts({ hosts: [
    'haust.edu.cn', 'www-haust-edu-cn-s.haust.edu.cn', 'i-haust-edu-cn-s.haust.edu.cn',
    'jwc-haust-edu-cn-s.haust.edu.cn', 'jwgl-haust-edu-cn-s.haust.edu.cn',
    'cas-haust-edu-cn-s.haust.edu.cn', 'cas.haust.edu.cn', 'cl.haust.edu.cn'
  ].join(',') })
  return !!result?.ok
}

function fillJs({ username, password }: Credential) {
  return `(() => {
  if (!${CAS_LOGIN}.test(location.href)) return 'wrong-page';
  const bodyText = (document.body && document.body.innerText) || '';
  if (/被锁住|已锁定|账户锁定|密码错误|用户名或密码|账号或密码|验证码错误|请输入验证码/.test(bodyText)) {
    return 'abort-risk';
  }
  const setVal = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const ins = [...document.querySelectorAll('input')].filter((e) => e.offsetParent !== null && e.type !== 'hidden');
  const captcha = ins.find((e) => /code|captcha|yzm|check/i.test((e.name || '') + (e.id || '') + (e.placeholder || '')));
  if (captcha) return 'abort-captcha';
  const pwd = ins.find((e) => e.type === 'password');
  const usr = ins.find((e) => e.type !== 'password' && !/code|captcha|yzm|check/i.test((e.name || '') + (e.id || '') + (e.placeholder || '')));
  if (!usr || !pwd) return 'no-form';
  setVal(usr, ${JSON.stringify(username)});
  setVal(pwd, ${JSON.stringify(password)});
  const btns = [...document.querySelectorAll('button, input[type=submit], input[type=button], .el-button, a, div, span')]
    .filter((el) => el.offsetParent !== null)
    .filter((el) => /^\\s*登\\s*录\\s*$/.test(String(el.innerText || el.value || '').trim()));
  if (!btns.length) return 'filled';
  btns[btns.length - 1].click();
  return 'filled+clicked';
})()`
}

/* ---------------- 会话 ---------------- */
const INFO_JS = `(() => {
  const txt = document.body.innerText || '';
  const patterns = [/您好[，,\\s]*([\\u4e00-\\u9fa5]{2,4})/, /([\\u4e00-\\u9fa5]{2,4})\\s*[（(]\\s*\\d{8,}\\s*[)）]/, /学生[：:\\s]*([\\u4e00-\\u9fa5]{2,4})/];
  let name = '';
  for (const re of patterns) { const m = txt.match(re); if (m && m[1]) { name = m[1]; break } }
  const w = txt.match(/第\\s*(\\d{1,2})\\s*教学周/);
  return JSON.stringify({ name: name, week: w ? Number(w[1]) : null });
})()`

async function readInfo(): Promise<{ name: string; week: number | null }> {
  try {
    const raw = await engine.run(INFO_JS)
    return typeof raw === 'string' ? JSON.parse(raw) : raw || { name: '', week: null }
  } catch (_) {
    return { name: '', week: null }
  }
}

/** 读一次页面正文判定，返回 ok / 当前地址 / 调试信息 */
async function probe(): Promise<{ ok: boolean; url: string; len: number; head: string }> {
  try {
    const raw = await engine.run(LOGGED_IN_JS)
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw || {}
    return { ok: !!p.ok, url: p.url || '', len: p.len || 0, head: p.head || '' }
  } catch (e: any) {
    return { ok: false, url: '', len: 0, head: 'probe-err:' + (e && e.message) }
  }
}

/**
 * 走一遍教务首页并判定登录态。
 * 教务首页是 SPA，onPageFinished 时正文可能还是空的，所以 load 完还要轮询正文。
 */
async function verifyOnce(): Promise<{ ok: boolean; url: string; last: string }> {
  const landed = await engine.load(HOME)
  // 落地页（「统一身份认证登录」）要点一下才进系统
  if (isEamsLanding(landed)) {
    try {
      log('landing click', await engine.run(LANDING_CLICK_JS))
    } catch (_) {}
    await sleep(1500)
    await engine.load(HOME)
  }
  let last = ''
  for (let i = 0; i < 8; i++) {
    const p = await probe()
    if (p.ok) {
      log('verify ok', p.url)
      return { ok: true, url: p.url || landed, last }
    }
    last = `len=${p.len} url=${(p.url || landed).slice(0, 120)} head=${p.head}`
    await sleep(600)
  }
  log('verify fail', last)
  return { ok: false, url: landed, last }
}

function casPageKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch (_) {
    return url.split('?')[0]
  }
}

/** 自动登录熔断与冷却：5 分钟内最多自动登录 1 次（持久化防冷启动连击），触发锁定/密码错误/验证码立即熔断 */
const AUTO_LOGIN_COOLDOWN_MS = 5 * 60 * 1000
const AUTO_LOGIN_TS_KEY = 'haust.autologin.lastAt'
const CHAOXING_AUTO_LOGIN_TS_KEY = 'haust.cx.autologin.lastAt'
let autoLoginTripped = false
let chaoxingAutoLoginTripped = false

function readLastAutoLoginAt(key = AUTO_LOGIN_TS_KEY): number {
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch (_) {
    return 0
  }
}

function writeLastAutoLoginAt(ts: number, key = AUTO_LOGIN_TS_KEY) {
  try {
    if (ts > 0) localStorage.setItem(key, String(ts))
    else localStorage.removeItem(key)
  } catch (_) {}
}

async function statusNow(interactive = false, waitMs = 10 * 60 * 1000, credential: Credential | null = null, remember?: boolean): Promise<SessionStatus> {
  let credentialUsed = false
  if (interactive) {
    await browser.open({ url: HOME, title: '登录教务（统一身份认证）' })
    const deadline = Date.now() + waitMs
    let lastUrl = ''
    let clickedAt = ''
    const filledHosts = new Set<string>()
    let fillDisabled = false
    let verifiedInOverlay = false
    while (Date.now() < deadline) {
      await sleep(1000)
      let open = true
      try {
        open = (await browser.isOpen()).open
      } catch (_) {}
      try {
        const cur = (await browser.currentUrl()).url
        if (cur && cur !== lastUrl) {
          lastUrl = cur
          log('login overlay url', cur.slice(0, 140))
        }
      } catch (_) {}
      if (!open) break
      // 首次加载和重定向都可能短暂经过教务地址，正文验证成功才收窗。
      if (isEams(lastUrl) && !isEamsLanding(lastUrl)) {
        const page = await overlay.run(LOGGED_IN_JS).catch(() => '')
        if (typeof page === 'string' && JSON.parse(page || '{}').ok) {
          verifiedInOverlay = true
          break
        }
      }
      // 停在教务落地页：帮用户在登录窗里点一次「登录」
      if (isEamsLanding(lastUrl) && clickedAt !== lastUrl) {
        try {
          if ((await overlay.run(LANDING_CLICK_JS)) === 'clicked') clickedAt = lastUrl
        } catch (e: any) {
          log('overlay landing click fail', e && e.message)
        }
      }
      // 停在统一身份认证表单：每个 CAS 域名最多自动填 1 次（最多 2 道 CAS），遇锁定/密码错/验证码立即熔断
      const pageKey = casPageKey(lastUrl)
      if (credential && !fillDisabled && isCasPage(lastUrl) && !filledHosts.has(pageKey) && filledHosts.size < 2) {
        try {
          const result = await overlay.run(fillJs(credential))
          if (result === 'abort-risk' || result === 'abort-captcha') {
            fillDisabled = true
            autoLoginTripped = true
            log('auto-fill aborted:', result)
          } else if (result === 'filled' || result === 'filled+clicked') {
            filledHosts.add(pageKey)
            credentialUsed = true
          }
        } catch (_) {}
      }
    }
    await browser.close(verifiedInOverlay ? { successMessage: '✓ 教务登录成功，正在返回…' } : undefined).catch(() => undefined)
    log('login overlay closed at', lastUrl.slice(0, 140))
  }

  // 用户手动点的「完成」可能早于 CAS 跳转结束：多验几次
  const tries = interactive ? 4 : 1
  let ok = false
  let url = ''
  let last = ''
  for (let i = 0; i < tries; i++) {
    const r = await verifyOnce()
    url = r.url
    last = r.last
    if (r.ok) {
      ok = true
      break
    }
    if (i < tries - 1) await sleep(1200)
  }
  const prevSession = read<SessionStatus>('session')
  const info = ok ? await readInfo() : { name: '', week: null }
  if (ok && info.name && prevSession?.studentName && info.name !== prevSession.studentName) {
    clearAccountCache()
  }
  const st: SessionStatus = {
    loggedIn: ok,
    verified: true,
    url,
    checkedAt: new Date().toISOString(),
    studentName: info.name,
    currentWeek: info.week,
    hint: ok ? '' : last
  }
  write('session', st)
  if (ok && interactive) {
    try {
      if (credentialUsed && credential) localStorage.setItem(SCHOOL_IDENTITY_KEY, credential.username)
      else localStorage.removeItem(SCHOOL_IDENTITY_KEY)
    } catch (_) {}
  }
  emitSession(st)
  if (ok && credential && credentialUsed && remember !== undefined) {
    try {
      if (remember) {
        await credentialStore.write({ username: credential.username, password: credential.password })
        localStorage.removeItem(K(legacyCred))
        st.credentialSaved = true
      } else {
        await clearSavedCred()
      }
    } catch (_) {
      st.credentialSaved = false
    }
  }
  return st
}

async function driveSchoolAuth(credential: Credential, options: AuthOptions, background = false): Promise<SessionStatus> {
  const { signal, onProgress } = options
  // driveAuth initially opens the WebView with silent: true.
  return driveAuth(browser, overlay.run, options, HOME, '教务系统统一认证', async ({ execute, readUrl, setRisk }) => {
    const submitted = new Set<string>()
    const retriedCaptcha = new Set<string>()
    let landing = ''
    let riskUrl = ''
    const deadline = Date.now() + (background ? 70_000 : 5 * 60_000)
    while (Date.now() < deadline) {
      const url = await readUrl()
      if (riskUrl && riskUrl !== url) {
        await setRisk(false)
        riskUrl = ''
      }
      if (isEams(url) && !isEamsLanding(url)) {
        const raw = await execute(LOGGED_IN_JS)
        if (typeof raw === 'string' && JSON.parse(raw)?.ok) {
          await setRisk(false)
          onProgress({ type: 'stage', message: '正在校验教务会话…' })
          const info = await execute(INFO_JS)
          const { name = '', week = null } = typeof info === 'string' ? JSON.parse(info) || {} : {}
          return {
            loggedIn: true, verified: true, checkedAt: new Date().toISOString(), url,
            studentName: name, currentWeek: week
          } satisfies SessionStatus
        }
      }
      if (isEamsLanding(url) && landing !== url && await execute(LANDING_CLICK_JS) === 'clicked') landing = url
      const page = await inspectAuthPage(execute, true)
      if (page) {
        const failure = classifyAuthError(page.error) || classifyAuthError(page.text)
        const risk = classifyAuthRisk(page)
        const key = casPageKey(url)
        if (background && risk !== 'none') failAuth('captcha', '统一身份认证需要人工验证')
        const retryCaptcha = submitted.has(key) && failure?.reason === 'captcha' && risk === 'image' && !retriedCaptcha.has(key)
        if (failure && !retryCaptcha) throw new AuthFlowError(failure)
        if (risk === 'complex' || (risk === 'image' && !page.dataUrl)) {
          await setRisk(true)
          riskUrl = url
        } else {
          if (riskUrl) {
            await setRisk(false)
            riskUrl = ''
          }
          if (isCasPage(url) && (retryCaptcha || (!submitted.has(key) && submitted.size < 2))) {
            let code: string | undefined
            if (risk === 'image' && page.dataUrl) {
              const answer = await waitForAuthInput<CaptchaAnswer>(signal, (respond) => {
                onProgress({ type: 'captcha', dataUrl: page.dataUrl!, message: failure?.message || '请输入图片中的验证码', respond })
              })
              if ('refresh' in answer) {
                await execute(authPageScript(true, 'captcha_refresh'))
                await authDelay(550, signal)
                continue
              }
              code = answer.text
            }
            if ((await execute(authPageScript(true, 'password', {
              account: credential.username, password: credential.password, code
            }))) === 'submitted') {
              if (retryCaptcha) retriedCaptcha.add(key)
              submitted.add(key)
              onProgress({ type: 'stage', message: '正在校验教务会话…' })
              await authDelay(1100, signal)
            }
          }
        }
      }
      await authDelay(550, signal)
    }
    return failAuth('timeout', '统一身份认证登录超时，请重试')
  })
}

async function loginSchoolSilently(request: SchoolLogin, options: AuthOptions): Promise<SessionStatus> {
  const { signal, onProgress } = options
  const previous = localStorage.getItem(SCHOOL_IDENTITY_KEY)
  let identityCleared = false
  if (previous !== request.username) {
    if (!(await clearSchoolCookies())) failAuth('verification', '无法清除原教务会话，请重试')
    clearAccountCache()
    localStorage.removeItem(SCHOOL_IDENTITY_KEY)
    identityCleared = true
    emitSession({ loggedIn: false, verified: true, checkedAt: new Date().toISOString() })
  }
  autoLoginTripped = true
  writeLastAutoLoginAt(Date.now())
  localStorage.removeItem(AIRCON_FAIL_TS_KEY)
  onProgress({ type: 'stage', message: '正在连接统一身份认证…' })
  try {
    const session = await driveSchoolAuth(request, options)
    signal.throwIfAborted()
    const status: SessionStatus = session
    try {
      if (request.remember) {
        await credentialStore.write({ username: request.username, password: request.password })
        localStorage.removeItem(K(legacyCred))
        status.credentialSaved = true
      } else {
        await clearSavedCred()
      }
    } catch (_) {
      status.credentialSaved = false
    }
    localStorage.setItem(SCHOOL_IDENTITY_KEY, request.username)
    write('session', status)
    autoLoginTripped = false
    writeLastAutoLoginAt(0)
    emitSession(status)
    return status
  } catch (error) {
    if (identityCleared) await clearSchoolCookies().catch(() => false)
    throw error
  }
}

/* ---------------- 各模块 ---------------- */
const inflight = new Map<string, Promise<any>>()
function single<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key)
  if (cur) return cur as Promise<T>
  const p = fn()
  inflight.set(key, p)
  p.then(
    () => inflight.delete(key),
    () => inflight.delete(key)
  )
  return p
}

async function silentReloginSchool(credential: Credential): Promise<SessionStatus> {
  return driveSchoolAuth(credential, {
    signal: new AbortController().signal,
    onProgress: () => {}
  }, true)
}

/** 调用方已持有 withEngine 锁，续登与验活在同一队列操作内完成。 */
async function ensureSession(): Promise<SessionStatus> {
  const previousName = read<SessionStatus>('session')?.studentName
  const st = await statusNow(false)
  if (st.loggedIn) {
    autoLoginTripped = false
    return st
  }
  if (autoLoginTripped) {
    log('auto login skipped: fuse tripped')
    return st
  }
  const now = Date.now()
  if (now - readLastAutoLoginAt() < AUTO_LOGIN_COOLDOWN_MS) {
    log('auto login skipped: cooldown active')
    return st
  }
  const credential = await readCred().catch(() => null)
  const account = localStorage.getItem(SCHOOL_IDENTITY_KEY)
  if (!credential || (account && account !== credential.username)) return st
  writeLastAutoLoginAt(now)
  try {
    const session = await silentReloginSchool(credential)
    if (previousName && session.studentName && previousName !== session.studentName) clearAccountCache()
    localStorage.setItem(SCHOOL_IDENTITY_KEY, credential.username)
    write('session', session)
    autoLoginTripped = false
    emitSession(session)
    return session
  } catch (_) {
    autoLoginTripped = true
    return st
  }
}

/** 会话被学校判失效时，重新验活并按需续登。 */
async function recoverSession(): Promise<boolean> {
  const st = await ensureSession()
  log('recoverSession', !!st.loggedIn)
  return !!st.loggedIn
}

const AIRCON_DEVICE_KEY = 'haust.settings.aircon-device-id'
const AIRCON_FAIL_TS_KEY = 'haust.aircon.tokenFailAt'
const AIRCON_FAIL_COOLDOWN_MS = 10 * 60 * 1000

function getAirconDeviceId(): string {
  try {
    const saved = localStorage.getItem(AIRCON_DEVICE_KEY)
    if (saved && /^[A-Za-z0-9]{16,32}$/.test(saved)) return saved
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let id = ''
    for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)]
    localStorage.setItem(AIRCON_DEVICE_KEY, id)
    return id
  } catch (_) {
    return 'haustcampusdevice000001'
  }
}

function parseJwtExp(jwt: string): number {
  try {
    const part = jwt.split('.')[1]
    if (!part) return 0
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded))
    return Number(payload.exp) || 0
  } catch (_) {
    return 0
  }
}

/** 复用本机 Keystore 凭据，通过公开 RSA 公钥加密换取 30 天 idToken（单次失败即冷却 10 分钟，绝不连打） */
async function fetchAirconIdToken(): Promise<{ token: string; error?: string }> {
  const cred = await readCred().catch(() => null)
  if (!cred?.username || !cred?.password) {
    return { token: '', error: 'NO_SAVED_CREDENTIAL' }
  }
  const cached = read<{ token: string; exp: number; username: string }>('aircon.jwt')
  if (
    cached?.token &&
    cached.username === cred.username &&
    cached.exp * 1000 - Date.now() > 24 * 60 * 60 * 1000
  ) {
    return { token: cached.token }
  }
  try {
    const lastFail = Number(localStorage.getItem(AIRCON_FAIL_TS_KEY)) || 0
    if (Date.now() - lastFail < AIRCON_FAIL_COOLDOWN_MS) {
      return { token: '', error: 'CAS_TOKEN_ERROR:电费认证冷却中（防锁号保护），请稍后重试' }
    }
  } catch (_) {}

  try {
    const res = await browser.casTokenLogin({
      username: cred.username,
      password: cred.password,
      deviceId: getAirconDeviceId()
    })
    const payload = typeof res.data === 'string' && res.data ? JSON.parse(res.data) : {}
    const token = String(payload?.data?.idToken || payload?.idToken || '')
    if (res.status === 200 && token) {
      const exp = parseJwtExp(token) || Math.floor(Date.now() / 1000) + 25 * 86400
      write('aircon.jwt', { token, exp, username: cred.username })
      try { localStorage.removeItem(AIRCON_FAIL_TS_KEY) } catch (_) {}
      return { token }
    }
    try { localStorage.setItem(AIRCON_FAIL_TS_KEY, String(Date.now())) } catch (_) {}
    const msg = payload?.message || payload?.msg || `HTTP ${res.status}`
    return { token: '', error: `CAS_TOKEN_ERROR:统一身份认证换取电费令牌失败（${msg}）` }
  } catch (e: any) {
    try { localStorage.setItem(AIRCON_FAIL_TS_KEY, String(Date.now())) } catch (_) {}
    return { token: '', error: `CAS_TOKEN_ERROR:统一身份认证网络异常（${e?.message || 'network'}）` }
  }
}

const readAircon = createCloudPaymentSession(async (url, headers) => {
  await browser.isolateAirconHttp()
  if (typeof browser.airconHttp === 'function') {
    const response = await browser.airconHttp({ url, headers })
    return {
      status: response.status,
      data: response.data,
      location: response.location || '',
      setCookies: Array.isArray(response.setCookies) ? response.setCookies : []
    }
  }
  const response = await CapacitorHttp.get({
    url, headers, responseType: 'text',
    disableRedirects: true, connectTimeout: 12_000, readTimeout: 12_000
  })
  const header = (name: string) => Object.entries(response.headers || {})
    .filter(([key]) => key.toLowerCase() === name)
    .map(([, value]) => value).join(', ')
  return {
    status: response.status, data: response.data,
    location: header('location'), setCookies: header('set-cookie')
  }
}, async (_project, userAgent, cookieUrl) => {
  const tok = await fetchAirconIdToken()
  if (!tok.token) return { cookies: '', error: tok.error || 'NO_SAVED_CREDENTIAL' }
  return browser.airconAuthBootstrap({ idToken: tok.token, userAgent, cookieUrl })
})

let studyMigration: Promise<void> | undefined
let chaoxingCacheVersion = 0
const chaoxingCacheKeys = ['chaoxing', 'chaoxing.activities', 'chaoxing.progress']

function clearChaoxingCache() {
  for (const key of chaoxingCacheKeys) {
    localStorage.removeItem(K(key))
    localStorage.removeItem(K('v1.' + key))
  }
}

async function fetchWithChaoxingRelogin<T extends { authRequired?: boolean }>(
  fetchResult: () => Promise<T>, version: number
): Promise<T> {
  let result: T | undefined
  try {
    result = await fetchResult()
  } catch (error) {
    if (!(error instanceof chaoxing.ChaoxingAuthError)) throw error
  }
  if (result && !result.authRequired) return result
  if (version === chaoxingCacheVersion && await silentReloginChaoxing() && version === chaoxingCacheVersion) {
    return fetchResult()
  }
  if (result) return result
  throw new chaoxing.ChaoxingAuthError()
}

function cachedChaoxingCourses<T extends ChaoxingActivitiesResult | ChaoxingProgressResult>(
  key: string,
  ignoredCourses: string[],
  empty: T,
  fetchResult: () => Promise<T>,
  filterResult: (result: T, ignored: string[]) => T
): Promise<T> {
  const version = chaoxingCacheVersion
  return single(JSON.stringify([key, version, ignoredCourses]), () => withEngine(async () => {
    if (version !== chaoxingCacheVersion) return empty
    try {
      await prepareStudyData()
      const result = await fetchWithChaoxingRelogin(fetchResult, version)
      if (version !== chaoxingCacheVersion) return empty
      if (result.authRequired) throw new chaoxing.ChaoxingAuthError()
      // Course access parameters are needed only during the live request.
      return write(key, { ...result, courses: result.courses.map(({ enc, pEnc, ...course }) => course) })
    } catch (error) {
      if (version !== chaoxingCacheVersion) return empty
      const cached = read<T>(key)
      const authRequired = error instanceof chaoxing.ChaoxingAuthError
      return {
        ...(cached ? filterResult(cached, ignoredCourses) : empty),
        loggedIn: !authRequired && !!cached,
        authRequired,
        stale: !!cached,
        error: authRequired ? undefined : error instanceof chaoxing.ChaoxingParseError ? 'parse' : 'network'
      }
    }
  }))
}

function prepareStudyData() {
  // The legacy migration clears Chaoxing cookies. Run it before opening a new session.
  return studyMigration ??= retireStudyData().catch(() => {})
}

const CHAOXING_HOSTS = [
  'chaoxing.com', 'passport2.chaoxing.com', 'passport2-api.chaoxing.com',
  'i.chaoxing.com', 'mooc1.chaoxing.com', 'mooc2-ans.chaoxing.com',
  'mooc1-api.chaoxing.com', 'notice.chaoxing.com', 'mobilelearn.chaoxing.com',
  'stat2-ans.chaoxing.com', 'im.chaoxing.com'
].join(',')

function resetChaoxingAutoLogin() {
  chaoxingAutoLoginTripped = false
  writeLastAutoLoginAt(0, CHAOXING_AUTO_LOGIN_TS_KEY)
}

async function silentReloginChaoxing(): Promise<boolean> {
  const now = Date.now()
  if (chaoxingAutoLoginTripped || now - readLastAutoLoginAt(CHAOXING_AUTO_LOGIN_TS_KEY) < AUTO_LOGIN_COOLDOWN_MS) return false
  const credential = await readChaoxingCred().catch(() => null)
  if (!credential) return false

  writeLastAutoLoginAt(now, CHAOXING_AUTO_LOGIN_TS_KEY)
  const controller = new AbortController()
  const backgroundBrowser: AuthBrowser = {
    open: (options) => browser.open({ ...options, silent: true }),
    isOpen: () => browser.isOpen(),
    currentUrl: () => browser.currentUrl(),
    // driveAuth calls reveal before reporting risk. Stop at the native boundary.
    reveal: async () => {
      controller.abort()
      return { revealed: false }
    },
    conceal: () => browser.conceal(),
    close: () => browser.close()
  }
  try {
    await driveChaoxingAuth(backgroundBrowser, overlay.run, {
      platform: 'chaoxing', mode: 'password', account: credential.username, password: credential.password
    }, {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.type === 'captcha' || (event.type === 'risk' && event.revealed)) controller.abort()
      }
    })
    controller.signal.throwIfAborted()
    const dashboard = await chaoxing.fetchChaoxingDashboard(engine)
    return dashboard.loggedIn && !dashboard.authRequired
  } catch (error) {
    const reason = error instanceof AuthFlowError ? error.failure.reason : undefined
    if (controller.signal.aborted || reason === 'captcha' || reason === 'credentials' || reason === 'locked' || reason === 'rate_limit') {
      chaoxingAutoLoginTripped = true
    }
    return false
  }
}

async function loginChaoxingSilently(request: Extract<AuthRequest, { platform: 'chaoxing' }>, options: AuthOptions) {
  await prepareStudyData()
  options.signal.throwIfAborted()
  chaoxingCacheVersion += 1
  clearChaoxingCache()
  const version = chaoxingCacheVersion
  if (!(await browser.clearCookiesForHosts({ hosts: CHAOXING_HOSTS })).ok) {
    failAuth('verification', '无法清除原学习通会话，请重试')
  }
  if (request.mode !== 'qr') rememberChaoxingAccount(localStorage, request.account)
  try {
    await driveChaoxingAuth(browser, overlay.run, request, options)
    options.signal.throwIfAborted()
    const dashboard = await chaoxing.fetchChaoxingDashboard(engine)
    options.signal.throwIfAborted()
    // 只要主会话已确认 loggedIn 且非 authRequired 即算登录成功，不因次要接口临时波动回滚 Cookie
    if (!dashboard.loggedIn || dashboard.authRequired || version !== chaoxingCacheVersion) {
      failAuth('verification', '学习通会话校验失败，请重试')
    }
    if (request.mode === 'password' && request.remember !== false) {
      await credentialStore.writeChaoxing({ username: request.account, password: request.password })
        .catch(() => clearSavedChaoxingCred().catch(() => {}))
    } else {
      // A successful QR login does not identify the account for password reuse.
      const saved = request.mode === 'sms' ? await readChaoxingCred().catch(() => null) : null
      if (!saved || request.mode !== 'sms' || saved.username !== request.account) {
        await clearSavedChaoxingCred().catch(() => {})
      }
    }
    resetChaoxingAutoLogin()
    options.signal.throwIfAborted()
    if (version !== chaoxingCacheVersion) failAuth('cancelled', '登录已取消')
    return write('chaoxing', dashboard)
  } catch (error) {
    if (!options.signal.aborted) {
      await browser.clearCookiesForHosts({ hosts: CHAOXING_HOSTS }).catch(() => {})
    }
    throw error
  } finally {
    // Discard business requests queued against the previous or partial session.
    chaoxingCacheVersion += 1
  }
}

export const androidApi = {
  nativeAuth: (request: AuthRequest, options: AuthOptions): Promise<AuthResult> => withEngine(async () => {
    try {
      options.signal.throwIfAborted()
      return request.platform === 'school'
        ? { ok: true, platform: 'school', session: await loginSchoolSilently(request, options) }
        : { ok: true, platform: 'chaoxing', dashboard: await loginChaoxingSilently(request, options) }
    } catch (error) {
      const failure = options.signal.aborted
        ? { reason: 'cancelled' as const, message: '登录已取消' }
        : error instanceof AuthFlowError
          ? error.failure
          : { reason: 'network' as const, message: '无法完成登录，请检查网络后重试' }
      if (!options.signal.aborted) options.onProgress({ type: 'failure', ...failure })
      return { ok: false, ...failure }
    }
  }),
  saveImageToGallery: (dataUrl: string, filename?: string) => browser.saveImageToGallery({ dataUrl, filename }),
  chaoxingCourseCache: () => ({
    activities: read<ChaoxingActivitiesResult>('chaoxing.activities'),
    progress: read<ChaoxingProgressResult>('chaoxing.progress')
  }),
  chaoxingActivities: (ignoredCourses: string[] = []): Promise<ChaoxingActivitiesResult> => cachedChaoxingCourses(
    'chaoxing.activities', ignoredCourses, { loggedIn: false, courses: [], activities: [], fetchedAt: new Date().toISOString() },
    () => chaoxing.fetchChaoxingActivities(engine, ignoredCourses),
    (result, ignored) => ({
      ...result, activities: chaoxing.filterByIgnoredCourses(result.activities, ignored, (item) => item.courseName)
    })
  ),
  chaoxingProgress: (ignoredCourses: string[] = []): Promise<ChaoxingProgressResult> => cachedChaoxingCourses(
    'chaoxing.progress', ignoredCourses, { loggedIn: false, courses: [], progress: [], fetchedAt: new Date().toISOString() },
    () => chaoxing.fetchChaoxingProgress(engine, ignoredCourses),
    (result, ignored) => ({
      ...result, progress: chaoxing.filterByIgnoredCourses(result.progress, ignored, (item) => item.courseName)
    })
  ),
  chaoxingLogin: () => single('chaoxing-login', () => withEngine(async () => {
    const version = ++chaoxingCacheVersion
    clearChaoxingCache()
    await prepareStudyData()
    if (!(await browser.open({ url: chaoxing.CHAOXING_LOGIN_URL, title: '登录超星学习通' })).shown) {
      return { loggedIn: false }
    }
    try {
      while ((await browser.isOpen()).open) {
        const { url } = await browser.currentUrl()
        if (isChaoxingDestination(url)) {
          // 登录跳转后短暂等待 1.2s，确保 .chaoxing.com 子域 Cookie 完整落盘
          await sleep(1200)
          await browser.close({ successMessage: '✓ 学习通登录成功，正在返回…' })
          break
        }
        await sleep(400)
      }
      // 无论自动收窗还是用户手动点「完成」，统一用真实接口验活一次并缓存结果
      const probe = await chaoxing.fetchChaoxingDashboard(engine).catch(() => null)
      if (probe?.loggedIn && !probe.authRequired && version === chaoxingCacheVersion) {
        await clearSavedChaoxingCred().catch(() => {})
        resetChaoxingAutoLogin()
        if (version !== chaoxingCacheVersion) return { loggedIn: false }
        write('chaoxing', probe)
        return { loggedIn: true }
      }
      return { loggedIn: false }
    } catch (error) {
      await browser.close().catch(() => {})
      throw error
    }
  })),

  chaoxingDashboard: () => {
    const version = chaoxingCacheVersion
    return single('chaoxing:' + version, () => withEngine(async (): Promise<ChaoxingDashboard> => {
      const empty = { loggedIn: false, works: [], exams: [], fetchedAt: new Date().toISOString() }
      if (version !== chaoxingCacheVersion) return empty
      await prepareStudyData()
      let result: ChaoxingDashboard
      try {
        result = await fetchWithChaoxingRelogin(() => chaoxing.fetchChaoxingDashboard(engine), version)
        if (result.loggedIn && !result.authRequired && !result.error && version === chaoxingCacheVersion) return write('chaoxing', result)
      } catch (error) {
        result = error instanceof chaoxing.ChaoxingAuthError
          ? { ...empty, authRequired: true }
          : { ...empty, error: error instanceof chaoxing.ChaoxingParseError ? 'parse' : 'network' }
      }
      if (version !== chaoxingCacheVersion) return empty
      const cached = readChaoxingSnapshot()
      return cached ? {
        ...cached, loggedIn: !result.authRequired, stale: true, authRequired: result.authRequired, error: result.error
      } : result
    }))
  },

  airconElectricity: createAirconElectricityService(localStorage, readAircon),
  /* 状态判定也要排队：它同样会 load 隐藏 WebView，插队会把别人的页面顶掉 */
  status: () =>
    withEngine(async () => {
      const cached = read<any>('session')
      // 只缓存「已登录」6 小时，避免每次装包或切换界面反复探活触发学校风控
      if (
        cached &&
        cached.loggedIn === true &&
        cached.checkedAt &&
        Date.now() - new Date(cached.checkedAt).getTime() < 6 * 60 * 60 * 1000
      ) {
        return cached
      }
      return ensureSession()
    }),

  login: (options?: SchoolLogin) =>
    withEngine(async () => {
      // 用户主动点击登录时重置熔断标记，允许重新走一次手动/自动登录
      autoLoginTripped = false
      writeLastAutoLoginAt(0)
      try { localStorage.removeItem(AIRCON_FAIL_TS_KEY) } catch (_) {}
      if (options?.username) {
        const prev = await readCred().catch(() => null)
        if (prev?.username && prev.username !== options.username) {
          await clearSchoolCookies().catch(() => false)
          clearAccountCache()
        }
      }
      return statusNow(true, undefined, options, options?.remember)
    }),

  refreshCourses: () =>
    single('courses', () =>
      withEngine(async () => {
        const run = () => eams.fetchCourseTable(engine)
        try {
          let data = await run()
          // 会话判活失败（学校网关把登录踢了）：重登一次再取，别把空结果丢给界面
          if (!data || !data.courses || !data.courses.length) {
            if (await recoverSession()) data = await run()
          }
          log('courses', data && data.courses ? data.courses.length : 'none')
          if (data && data.courses && data.courses.length) return write('courses', data)
          const cached = read('courses')
          return cached ? { ...(cached as object), stale: true } : data
        } catch (e: any) {
          log('courses FAIL', e && e.message)
          if (e && e.code === 'NO_SESSION' && (await recoverSession())) {
            try {
              const again = await run()
              if (again && again.courses && again.courses.length) return write('courses', again)
            } catch (_) {}
          }
          const cached = read('courses')
          if (cached) return { ...(cached as object), stale: true, error: String(e && e.message) }
          throw e
        }
      })
    ),

  refreshExams: () =>
    single('exams', () =>
      withEngine(async () => {
        const run = () => eams.fetchExams(engine)
        try {
          const data = await run()
          log('exams', data && Array.isArray(data.exams) ? data.exams.length : 'none')
          // 教务未发布考试安排时返回空数组属于可信空数据，不误触发 recoverSession()
          if (data && Array.isArray(data.exams)) return write('exams', data)
          const cached = read<any>('exams')
          return cached ? { ...cached, stale: true, error: (data && data.error) || '' } : data
        } catch (e: any) {
          log('exams FAIL', e && e.message)
          if (e && e.code === 'NO_SESSION' && (await recoverSession())) {
            try {
              const again = await run()
              if (again && Array.isArray(again.exams)) return write('exams', again)
            } catch (_) {}
          }
          const cached = read<any>('exams')
          if (cached) return { ...cached, stale: true, error: String(e && e.message) }
          throw e
        }
      })
    ),

  refreshNotices: () =>
    single('notices', () =>
      withEngine(async () => {
        const existingKeys = await getAllNoticeKeys().catch(() => new Set<string>())
        try {
          const collegeIds = readSubscribedColleges()
          const data = await notices.fetchList(engine, { existingKeys, collegeIds })
          const fetchedItems = Array.isArray(data?.items) ? data.items : []
          log('notices', fetchedItems.length, 'existing:', existingKeys.size)
          if (fetchedItems.length > 0) {
            const merged = await upsertNotices(fetchedItems)
            const authRequired = !!(data?.authRequired || data?.portalAuthRequired)
            write('notices', { fetchedAt: data.fetchedAt, items: merged.slice(0, 60) })
            return { fetchedAt: data.fetchedAt, items: merged, stale: false, authRequired }
          }
          const persisted = await getAllNotices()
          if (persisted.length > 0) {
            return {
              fetchedAt: data?.fetchedAt || new Date().toISOString(),
              items: persisted,
              stale: true,
              authRequired: !!(data?.authRequired || data?.portalAuthRequired)
            }
          }
          const cached = read<any>('notices')
          return cached ? { ...cached, stale: true, authRequired: !!data?.authRequired } : data
        } catch (e: any) {
          const isAuth = e instanceof WebVpnAuthError || e?.code === 'WEBVPN_AUTH_REQUIRED'
          log('notices FAIL', isAuth ? 'WebVpnAuthError' : (e && e.message))
          const persisted = await getAllNotices()
          if (persisted.length > 0) {
            return {
              fetchedAt: new Date().toISOString(),
              items: persisted,
              stale: true,
              authRequired: isAuth,
              error: String(e && e.message)
            }
          }
          const cached = read<any>('notices')
          if (cached) {
            return { ...cached, stale: true, authRequired: isAuth, error: String(e && e.message) }
          }
          if (isAuth) {
            return { fetchedAt: new Date().toISOString(), items: [], stale: true, authRequired: true, error: e.message }
          }
          throw e
        }
      })
    ),

  noticeBody: async (item: any) => {
    // 正文懒加载优先读 IndexedDB 本地缓存，命中即毫秒离线直读，不占隐藏 WebView 锁
    const cachedBody = await getCachedNoticeBody(item).catch(() => null)
    if (cachedBody) return cachedBody
    return withEngine(async () => {
      try {
        const res = await notices.fetchBody(engine, item)
        if (res && !res.failure) {
          await saveNoticeBody(item, res).catch(() => {})
        }
        return res
      } catch (e: any) {
        return { text: '', failure: 'network', error: String(e && e.message) }
      }
    })
  },

  refreshCard: () =>
    single('card', () =>
      withEngine(async () => {
        const run = () => card.fetchCard(engine)
        try {
          const data = await run()
          log('card', data && data.balance)
          if (data && data.balance) return write('card', data)
          const cached = read('card')
          return cached ? { ...(cached as object), stale: true } : data
        } catch (e: any) {
          log('card FAIL', e && e.message)
          if (e && e.code === 'NO_SESSION' && (await recoverSession())) {
            try {
              const again = await run()
              log('card retry', again && again.balance)
              if (again && again.balance) return write('card', again)
              const cachedAfterRetry = read('card')
              return cachedAfterRetry ? { ...(cachedAfterRetry as object), stale: true } : again
            } catch (_) {}
          }
          const cached = read('card')
          if (cached) return { ...(cached as object), stale: true }
          throw e
        }
      })
    ),

  refreshChargers: () =>
    single('chargers', async () => {
      try {
        const data = await chargers.collect()
        log('chargers', data && data.rows ? data.rows.length : 'none')
        if (data && data.rows) return write('chargers', data)
        return data
      } catch (e: any) {
        log('chargers FAIL', e && e.message)
        const cached = read('chargers')
        if (cached) return { ...(cached as object), stale: true }
        throw e
      }
    }),

  cached: () => withEngine(async () => {
    // 首次读取缓存时迁移，即使已有有效会话或设备断网。
    await readCred().catch(() => null)
    await prepareStudyData()
    const idbNotices = await getAllNotices().catch(() => [])
    const noticeCache = idbNotices.length > 0
      ? { fetchedAt: new Date().toISOString(), items: idbNotices }
      : read('notices')
    return {
      courses: read('courses'),
      exams: read('exams'),
      notices: noticeCache,
      chargers: read('chargers'),
      card: read('card'),
      session: read('session')
    }
  }),

  clearCache: async () => {
    chaoxingCacheVersion += 1
    keys().forEach((k) => {
      if (k === K(legacyCred)) return
      try {
        localStorage.removeItem(k)
      } catch (_) {}
    })
    return true
  },
  clearCred: () => withEngine(async () => {
    chaoxingCacheVersion += 1
    const results = await Promise.allSettled([
      clearSavedCred(),
      clearSavedChaoxingCred(),
      clearSchoolCookies(),
      browser.clearCookiesForHosts({ hosts: CHAOXING_HOSTS }).then(({ ok }) => ok)
    ])
    clearAccountCache()
    clearChaoxingCache()
    localStorage.removeItem(SCHOOL_IDENTITY_KEY)
    localStorage.removeItem(CHAOXING_LAST_ACCOUNT_KEY)
    autoLoginTripped = results[0].status === 'rejected'
    writeLastAutoLoginAt(0)
    resetChaoxingAutoLogin()
    chaoxingAutoLoginTripped = results[1].status === 'rejected'
    emitSession({ loggedIn: false, verified: true, checkedAt: new Date().toISOString() })
    return results.every((result) => result.status === 'fulfilled' && result.value !== false)
  }),

  /* 教务凭据：保存后登录时自动填（学校登录链要过两道 CAS） */
  credStatus: () => withEngine(async () => {
    try {
      const credential = await readCred()
      return { saved: !!credential, username: credential?.username ?? '', encryptionAvailable: true }
    } catch (_) {
      return { saved: false, username: '', encryptionAvailable: false }
    }
  }),
  credSave: (username: string, password: string) => withEngine(async () => {
    if (!username || !password) return false
    try {
      await credentialStore.write({ username, password })
      localStorage.removeItem(K(legacyCred))
      return true
    } catch (_) {
      return false
    }
  }),
  credClear: () => withEngine(async () => {
    await clearSavedCred()
    return true
  }),

  /** 状态栏配色（跟浅色/深色主题走）：原生侧同时刷状态栏和窗口底色，避免顶部黑边 */
  statusBar: async (o: { color: string; dark: boolean }) => {
    try {
      await (browser as any).statusBar({ color: o.color, dark: !!o.dark })
      return true
    } catch (_) {
      return false
    }
  },

  openExternal: async (url: string) => {
    if (!/^https?:\/\//.test(url || '')) return false
    try {
      await browser.openExternal({ url })
      return true
    } catch (_) {
      return false
    }
  },

  openInApp: async (url: string, title = '通知原文') => {
    if (!/^https:\/\//.test(url || '')) return false
    try {
      await browser.open({ url, title })
      return true
    } catch (_) {
      return false
    }
  },

  launchApp: async (packageName: string) => {
    try {
      return await browser.launchApp({ packageName })
    } catch (_) {
      return { launched: false, installed: false }
    }
  },

  /* 事件：运行期会话状态变化（登录/失效/清除凭据）即时通知前端 */
  onSession: (cb: (st: SessionStatus) => void) => {
    sessionListeners.add(cb)
    return () => {
      sessionListeners.delete(cb)
    }
  },
}
