export const AIRCON_ORIGIN = 'https://h5cloud.17wanxiao.com:18443'
const PROJECT = AIRCON_ORIGIN + '/CloudPayment/bill/selectPayProject.do?txcode=2&interurl=substituted_pay&payProId=4620&amtflag=0&payamt=100&payproname=%E7%94%A8%E7%94%B5%E6%94%AF%E5%87%BA&img=https://payicons.59wanmei.com/cloudpayment/images/project/img-nav_2.png&subPayProId=&fixamtlist='
const ACTIVATE = AIRCON_ORIGIN + '/CloudPayment/user/checkRoomCount.do?schoolCode=1007'
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 15; SM-G9900 Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Mobile Safari/537.36 SuperApp'
const SESSION_TTL = 10 * 60 * 1000
const REDIRECTS = new Set([301, 302, 303, 307, 308])

function safeUrl(input, base) {
  const url = new URL(input, base)
  if (url.origin !== AIRCON_ORIGIN || url.username || url.password || !url.pathname.startsWith('/CloudPayment/')) {
    throw new Error('Unexpected CloudPayment redirect')
  }
  url.hash = ''
  return url
}

function isSessionError(response) {
  if (response.status === 401 || response.status === 403) return true
  let data = response.data
  if (typeof data === 'string') {
    if (/^RspBaseVO\s*\[\s*code\s*=\s*ERROR\b/i.test(data.trim())) return true
    try { data = JSON.parse(data) } catch { return false }
  }
  return data?.code === 'ERROR' || data?.returncode === 'ERROR'
}

export function createCloudPaymentSession(transport, bootstrapBrowser, webViewFallback) {
  const cookies = new Map()
  let activatedAt = 0
  let sessionVersion = 0
  let queue = Promise.resolve()

  function mergeCookies(url, values) {
    const lines = Array.isArray(values) ? values : values
      ? values.split(/,\s*(?=[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/) : []
    for (const line of lines) {
      const [entry, ...attributes] = line.split(';')
      const colon = entry.indexOf('=')
      if (colon < 1) continue
      const name = entry.slice(0, colon).trim()
      const value = entry.slice(colon + 1).trim()
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) continue
      const entries = new Map()
      for (const attribute of attributes) {
        const delimiter = attribute.indexOf('=')
        if (delimiter > 0) entries.set(attribute.slice(0, delimiter).trim().toLowerCase(), attribute.slice(delimiter + 1).trim())
      }
      const domain = entries.get('domain')?.toLowerCase().replace(/^\./, '')
      if (domain && domain !== '17wanxiao.com' && domain !== url.hostname) continue
      const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/'
      const declaredPath = entries.get('path')
      const path = declaredPath?.startsWith('/') ? declaredPath : defaultPath
      const maxAge = entries.get('max-age')
      const expires = maxAge && /^-?\d+$/.test(maxAge) ? Date.now() + Number(maxAge) * 1000 : Date.parse(entries.get('expires') || '')
      const key = name + '\n' + path
      if (!value || expires <= Date.now()) cookies.delete(key)
      else cookies.set(key, { name, value, path, expires })
    }
  }

  function applicableCookies(url) {
    return [...cookies.values()].filter(cookie =>
      !(cookie.expires <= Date.now()) &&
      (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/'))
    ).sort((a, b) => b.path.length - a.path.length)
  }

  function cookieHeader(url) {
    return applicableCookies(url).map(({ name, value }) => name + '=' + value).join('; ')
  }

  function hasSessionCookie(header) {
    return /(?:^|;\s*)(?:JSESSIONID|SESSION)=[^;]+/.test(header)
  }

  async function get(input, navigation = false) {
    let url = safeUrl(input)
    for (let hop = 0; hop < 6; hop++) {
      const headers = {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: navigation ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          : 'application/json, text/javascript, */*; q=0.01'
      }
      if (!navigation) {
        headers.Referer = PROJECT
        headers['X-Requested-With'] = 'XMLHttpRequest'
      }
      const cookie = cookieHeader(url)
      if (cookie) headers.Cookie = cookie
      const response = await transport(url.toString(), headers)
      mergeCookies(url, response.setCookies)
      if (!REDIRECTS.has(response.status)) return response
      if (!response.location) throw new Error('CloudPayment redirect has no location')
      url = safeUrl(response.location, url)
    }
    throw new Error('Too many CloudPayment redirects')
  }

  async function initialize() {
    activatedAt = 0
    cookies.clear()
    const activateUrl = new URL(ACTIVATE)
    let bootNote = ''
    let authBootstrapped = false

    // 若提供认证引导（如通过 cas.haust.edu.cn idToken 换取 CloudPayment SESSION），优先完成认证会话建立
    if (bootstrapBrowser) {
      try {
        const booted = await bootstrapBrowser(PROJECT, USER_AGENT, ACTIVATE)
        const header = typeof booted === 'string' ? booted : String(booted?.cookies || '')
        if (typeof booted === 'object' && booted) {
          if (booted.error === 'NO_SAVED_CREDENTIAL') {
            return { status: 401, data: { msg: '请先登录教务并勾选“保存密码”，再查询空调电费' } }
          }
          if (booted.error && booted.error.startsWith('CAS_TOKEN_ERROR:')) {
            return { status: 401, data: { msg: booted.error.replace('CAS_TOKEN_ERROR:', '') } }
          }
          const parts = [booted.mode, booted.httpStatus ? `HTTP ${booted.httpStatus}` : '', booted.error].filter(Boolean)
          if (parts.length) bootNote = `，引导回退(${parts.join('/')})`
        }
        const entries = header.split(';').map(pair => pair.trim()).filter(Boolean)
        mergeCookies(activateUrl, entries.map(pair => pair + '; Path=/CloudPayment'))
        if (hasSessionCookie(cookieHeader(activateUrl))) authBootstrapped = true
      } catch (err) {
        bootNote = `，引导异常(${err?.message || 'failed'})`
      }
    }

    let project = { status: 0, data: '', error: '' }
    try {
      project = await get(PROJECT, true)
    } catch (err) {
      project = { status: 0, data: '', error: err?.message || 'network' }
    }
    const projectOk = project.status >= 200 && project.status < 300 && !isSessionError(project)
    if (!projectOk || !hasSessionCookie(cookieHeader(activateUrl))) {
      return {
        status: projectOk ? 503 : (project.status || 503),
        data: {
          msg: project.error
            ? `云缴费入口连接失败（selectPayProject: ${project.error}${bootNote}）`
            : projectOk
              ? `云缴费未发放有效会话（selectPayProject HTTP ${project.status}${bootNote}）`
              : `云缴费入口暂不可用（selectPayProject HTTP ${project.status}${bootNote}）`
        }
      }
    }

    // 已通过 pay.do 认证引导且 selectPayProject 返回 200 时，会话已就绪，直接放行
    if (authBootstrapped) {
      activatedAt = Date.now()
      return null
    }

    let activation
    try {
      activation = await get(ACTIVATE)
    } catch (err) {
      return {
        status: 503,
        data: { msg: `云缴费会话激活失败（checkRoomCount: ${err?.message || 'network'}）` }
      }
    }
    if (activation.status < 200 || activation.status >= 300 || isSessionError(activation)) {
      return {
        status: activation.status || 503,
        data: typeof activation.data === 'object' && activation.data
          ? activation.data
          : { msg: `云缴费会话激活失败（checkRoomCount HTTP ${activation.status}）` }
      }
    }
    if (!hasSessionCookie(cookieHeader(activateUrl))) return {
      status: 503, data: { msg: `云缴费会话未激活（checkRoomCount HTTP ${activation.status} 无 SESSION）` }
    }
    activatedAt = Date.now()
    return null
  }

  async function tryWebViewFallback(url, fallbackResult) {
    if (typeof webViewFallback !== 'function') return fallbackResult
    try {
      const res = await webViewFallback(PROJECT, ACTIVATE, url.toString(), USER_AGENT)
      if (res && res.status >= 200 && res.status < 300) return { status: res.status, data: res.data }
      return res && res.data ? { status: res.status || 503, data: res.data } : fallbackResult
    } catch (_) {
      return fallbackResult
    }
  }

  const request = (input) => {
    const url = safeUrl(input)
    if (!['/CloudPayment/user/getRoom.do', '/CloudPayment/user/getRoomState.do'].includes(url.pathname)) {
      return Promise.reject(new Error('Unsupported CloudPayment query'))
    }
    const requestVersion = sessionVersion
    const run = queue.then(async () => {
      if (requestVersion !== sessionVersion) {
        return { status: 401, data: { msg: '账号会话已切换，请重试' } }
      }
      if (!activatedAt || Date.now() - activatedAt >= SESSION_TTL || !hasSessionCookie(cookieHeader(url))) {
        const failure = await initialize()
        if (requestVersion !== sessionVersion) return { status: 401, data: { msg: '账号会话已切换，请重试' } }
        if (failure) return tryWebViewFallback(url, { status: failure.status, data: failure.data })
      }
      let response
      try {
        response = await get(url)
      } catch (err) {
        return tryWebViewFallback(url, { status: 503, data: { msg: `电控请求失败（${err?.message || 'network'}）` } })
      }
      if (requestVersion !== sessionVersion) {
        return { status: 401, data: { msg: '账号会话已切换，请重试' } }
      }
      if (isSessionError(response)) {
        const failure = await initialize()
        if (requestVersion !== sessionVersion) return { status: 401, data: { msg: '账号会话已切换，请重试' } }
        if (failure) return tryWebViewFallback(url, { status: failure.status, data: failure.data })
        try {
          response = await get(url)
        } catch (err) {
          return tryWebViewFallback(url, { status: 503, data: { msg: `电控重试失败（${err?.message || 'network'}）` } })
        }
        if (requestVersion !== sessionVersion) {
          return { status: 401, data: { msg: '账号会话已切换，请重试' } }
        }
        if (isSessionError(response)) {
          activatedAt = 0
          return tryWebViewFallback(url, { status: response.status, data: response.data })
        }
      }
      return { status: response.status, data: response.data }
    })
    queue = run.catch(() => undefined)
    return run
  }
  request.reset = () => {
    sessionVersion += 1
    activatedAt = 0
    cookies.clear()
  }
  return request
}
