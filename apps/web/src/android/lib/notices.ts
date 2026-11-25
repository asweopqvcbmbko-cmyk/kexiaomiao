// @ts-nocheck —— 从桌面端逐行移植并增强的纯逻辑模块（支持双网 ID 归一化 + 第 1 页增量截断）。
import { WebVpnAuthError, compactNoticeTitle, normalizeNoticeItem } from '../../notice-db.ts'
import { getSubscribedCollegeSources, isCollegeSource, type CollegeSource } from '../../college-notices.ts'
import type { NoticeBody, NoticeItem } from '../../types'

/**
 * 通知聚合适配器
 *  - 全校通知公告 / 校园新闻（i 科大 portal-api）
 *  - 教务处通知公告（jwc）
 *  - 用户订阅的学院通知公告
 * 列表统一成 { source, sourceName, id, title, date, dept, url }；
 * 正文按需抓取（用户点开某条且本地无 IndexedDB 缓存时才请求），避免并发拉详情。
 */

const PORTAL_URL = 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/NewsCenter'
const JWC_LIST_DIRECT = 'https://jwc.haust.edu.cn/tzgg.htm'
const JWC_LIST = 'https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm'

const PORTAL_ORIGIN = new URL(PORTAL_URL).origin
const PORTAL_COLUMNS = [
  { id: 'remote-1120073', tag: 'school', name: '全校通知' },
  { id: 'remote-1120074', tag: 'news', name: '校园新闻' }
]
const PORTAL_COLUMNS_JSON = JSON.stringify(PORTAL_COLUMNS)

export type NoticeHttpResponse = { status: number; url: string; data: string; headers?: Record<string, string> }
export type NoticeHttpClient = {
  get(url: string, opts?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<NoticeHttpResponse>
  getCookies?(url: string): Promise<string>
}

type NoticeListOptions = { existingKeys?: Set<string> | string[]; maxInitialPages?: number; collegeIds?: string[] }
type NoticeListItem = NoticeItem & { mirrorUrl?: string }
type NoticeListResult = {
  fetchedAt: string
  items: NoticeListItem[]
  portalAuthRequired: boolean
  authRequired: boolean
  failedSources: string[]
}

export function sortAndMatchMirrors(items: NoticeListItem[]) {
  items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const titleKey = (item: NoticeListItem) => String(item.title || '').replace(/\s+/g, '')
  const mirrors = new Map(items
    .filter((item) => (item.source === 'school' || item.source === 'news') && item.url)
    .map((item) => [titleKey(item), item.url]))
  for (const item of items) {
    const mirror = item.source === 'jwc' && mirrors.get(titleKey(item))
    if (mirror) item.mirrorUrl = mirror
  }
  return items
}

function buildPortalListStartJs(pageNo = 1) {
  return `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const cols = ${PORTAL_COLUMNS_JSON};
  window.__haustPortalNotices = { done: false, okCount: 0, items: [] };
  const results = [];
  let finished = 0;
  const finishOne = (r) => {
    results.push(r);
    finished += 1;
    if (finished === cols.length) {
      const out = [];
      const okSources = [];
      for (const item of results) {
        if (item.ok) okSources.push(item.source);
        for (const row of item.items) out.push(row);
      }
      window.__haustPortalNotices = { done: true, okCount: okSources.length, okSources, items: out };
    }
  };
  for (const c of cols) {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', '/portal-api/v3/cms/content/getColumncontents?kw=&columnId=' + c.id +
        '&pageNo=${Number(pageNo) || 1}&pageSize=20&loadContent=false&loadPicContents=true&sf_request_type=ajax', true);
      x.onreadystatechange = () => {
        if (x.readyState !== 4) return;
        if (x.status < 200 || x.status >= 300 || !x.responseText) {
          finishOne({ ok: false, items: [] });
          return;
        }
        try {
          const j = JSON.parse(x.responseText);
          const arr = (j && j.data && j.data.allContents) || [];
          const list = arr.map((it) => ({
            source: c.tag,
            sourceName: c.name,
            id: String(it.id || ''),
            title: norm(it.title),
            date: String(it.releaseStartTime || it.createTime || '').slice(0, 10),
            dept: norm(it.releaseDeptName),
            url: it.url || ''
          }));
          finishOne({ ok: true, source: c.tag, items: list });
        } catch (_) {
          finishOne({ ok: false, items: [] });
        }
      };
      x.onerror = () => finishOne({ ok: false, items: [] });
      x.send(null);
    } catch (_) {
      finishOne({ ok: false, items: [] });
    }
  }
  return 'started';
})()`
}

const NEXT_PAGE_JS = `(() => {
  const links = [...document.querySelectorAll('a[href]')];
  const next = links.find((a) => /^\\s*(下页|下一页|下\\s*页)\\s*$/.test(String(a.textContent || '').trim()));
  if (!next) return '';
  const href = next.getAttribute('href') || '';
  if (!href || /^(javascript:|#)/i.test(href)) return '';
  try { return new URL(href, location.href).href; } catch (_) { return ''; }
})()`

const PORTAL_LIST_POLL_JS = `(() => {
  const st = window.__haustPortalNotices;
  if (!st || !st.done) return '';
  return JSON.stringify(st);
})()`

const JWC_LIST_JS = `(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const out = [];
  document.querySelectorAll('li').forEach((li) => {
    const a = li.querySelector('a[href*="wbnewsid"]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const id = (href.match(/wbnewsid=(\\d+)/) || [])[1] || '';
    if (!id) return;
    const m = (li.innerText || '').match(/(20\\d\\d)年(\\d{1,2})月(\\d{1,2})日/);
    out.push({
      source: 'jwc', sourceName: '教务处', id: id,
      title: (a.title || a.textContent || '').replace(/\\s+/g, ' ').trim(),
      date: m ? m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) : '',
      dept: '教务处',
      url: new URL(href, location.href).href
    });
  });
  return JSON.stringify(out);
})()`

function buildCollegeListJs(college: CollegeSource) {
  return String.raw`(() => {
  const { id: source, shortName: sourceName, fullName: dept, host } = ${JSON.stringify(college)};
  if (location.hostname !== host) return '[]';
  const pad = (n) => String(n).padStart(2, '0');
  const fullDate = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b|(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  const shortDate = /(?:^|[^\d./-])(\d{1,2})-(\d{1,2})(?![\d./-])/;
  const readDate = (a) => {
    const row = a.closest('li, tr');
    let fallback = '';
    for (let node = a.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      if (node.matches('body, main, html')) break;
      const text = node.innerText || node.textContent || '';
      const full = text.match(fullDate);
      if (full) return (full[1] || full[4]) + '-' + pad(full[2] || full[5]) + '-' + pad(full[3] || full[6]);
      const short = text.match(shortDate);
      if (short && !fallback) fallback = new Date().getFullYear() + '-' + pad(short[1]) + '-' + pad(short[2]);
      if (node === row) break;
    }
    return fallback;
  };
  const out = [];
  const seen = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const title = (a.title?.trim() || a.textContent || '').replace(/\s+/g, ' ').trim();
    if (title.length < 4) return;
    try {
      const url = new URL(href, location.href);
      const id = url.pathname.match(/\/info\/\d+\/(\d+)\.htm$/)?.[1] || url.searchParams.get('wbnewsid');
      if (!id || !/^\d+$/.test(id) || seen.has(id)) return;
      if (url.protocol === 'http:' && url.hostname.endsWith('.haust.edu.cn')) url.protocol = 'https:';
      if (url.protocol !== 'https:') return;
      seen.add(id);
      out.push({ source, sourceName, id, title, date: readDate(a), dept, url: url.href });
    } catch (_) {}
  });
  return JSON.stringify(out);
})()`
}

function bodyScript(options: NoticeArticleIdentity) {
  // Evaluate the same extractor on the live DOM after WebView rendering.
  const helpers = [compactNoticeTitle, isDecorativeNoticeImage, asHttpsUrl, isLoginLandingUrl, noticeDate]
  return 'JSON.stringify((' + extractNoticeBody + ')((' + noticeDomTree + ')(document.documentElement), location.href, ' +
    JSON.stringify(options) + ', ' + helpers.map((helper) => '(' + helper + ')').join(', ') + '))'
}

function safeDomain(url) {
  try { return new URL(url).hostname } catch (_) { return '' }
}

const WEBVPN_HOST_RE = /^([a-z0-9-]+)-haust-edu-cn-s\.haust\.edu\.cn$/i

function isWebVpnHost(host) {
  return WEBVPN_HOST_RE.test(host || '')
}

/**
 * 校内域名 → 统一身份认证 WebVPN 代理域名：
 * 如 http(s)://jwc.haust.edu.cn/tzgg.htm → https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm
 */
function toWebVpnUrl(rawUrl) {
  const input = String(rawUrl || '').trim()
  if (!input) return ''
  try {
    const u = new URL(input)
    const host = u.hostname.toLowerCase()
    if (isWebVpnHost(host)) {
      u.protocol = 'https:'
      return u.toString()
    }
    if (!host.endsWith('.haust.edu.cn') || host === 'cas.haust.edu.cn' || host === 'vpn.haust.edu.cn') {
      return u.toString()
    }
    const prefix = host.replace(/\./g, '-')
    u.protocol = 'https:'
    u.hostname = `${prefix}-s.haust.edu.cn`
    return u.toString()
  } catch (_) {
    return input
  }
}

/** WebVPN 代理域名 → 校园网直连域名 */
function toDirectUrl(rawUrl) {
  const input = String(rawUrl || '').trim()
  if (!input) return ''
  try {
    const u = new URL(input)
    const m = WEBVPN_HOST_RE.exec(u.hostname.toLowerCase())
    if (!m) return u.toString()
    u.hostname = `${m[1].replace(/-/g, '.')}.haust.edu.cn`
    return u.toString()
  } catch (_) {
    return input
  }
}

/** 构造去重后的候选访问地址（支持直连与 WebVPN 代理自动切换） */
function buildCandidateUrls(rawUrl, preferVpn = true) {
  const vpn = toWebVpnUrl(rawUrl)
  const direct = toDirectUrl(rawUrl)
  const ordered = preferVpn ? [vpn, direct, rawUrl] : [direct, vpn, rawUrl]
  return [...new Set(ordered.filter(Boolean))]
}

function withAlias(url) {
  return toWebVpnUrl(url)
}

function normalizeBodyResources(data, preferVpn) {
  if (!data || !preferVpn) return data
  const convert = (u) => toWebVpnUrl(u)
  const imgs = Array.isArray(data.imgs) ? data.imgs.map(convert) : []
  const attachments = Array.isArray(data.attachments)
    ? data.attachments.map((att) => ({ ...att, url: convert(att.url) }))
    : []
  return { ...data, imgs, attachments }
}

function isLoginLandingUrl(value: string) {
  try {
    const { hostname, pathname } = new URL(value)
    return /^(?:cas|sso|passport\d*)(?:[.-]|$)/i.test(hostname) ||
      (hostname === 'vpn.haust.edu.cn' && /^\/(?:portal(?:[/.-]|$)|$)/i.test(pathname)) ||
      /\/(?:login(?:Ext)?|cas|auth\.htm)(?:[/._-]|$)/i.test(pathname)
  } catch { return false }
}

async function fetchList(engine, options: NoticeListOptions = {}, http?: NoticeHttpClient) {
  if (http) return fetchListFast(http, options)
  const existingKeys = options.existingKeys instanceof Set
    ? options.existingKeys
    : new Set(Array.isArray(options.existingKeys) ? options.existingKeys : [])
  const maxInitialPages = Number(options.maxInitialPages) || 3

  const hasSourceCache = (prefixes) => {
    for (const k of existingKeys) {
      if (prefixes.some((p) => k.startsWith(p))) return true
    }
    return false
  }

  const items = []
  const batchSeen = new Set()
  let succeededSources = 0
  let portalAuthRequired = false
  let authRedirectCount = 0
  const failedSources = new Set(['school', 'news', 'jwc', ...getSubscribedCollegeSources(options.collegeIds || []).map(({ id }) => id)])

  /** 遍历完整一页并用内存 Set 过滤（防置顶旧公告误截断）；命中任意已缓存主键返回 true */
  const ingestPage = (rawList) => {
    let hitCached = false
    for (const raw of rawList || []) {
      const normalized = normalizeNoticeItem(raw)
      const key = `${normalized.source}:${normalized.id}`
      if (existingKeys.has(key)) {
        hitCached = true
      }
      if (batchSeen.has(key)) continue
      batchSeen.add(key)
      items.push(normalized)
    }
    return hitCached
  }

  // 1) 全校通知 + 校园新闻（首次最多抓 3 页建库，日常仅抓第 1 页；命中缓存即停）
  const portalPageLimit = hasSourceCache(['school:', 'news:']) ? 1 : maxInitialPages
  for (const portalTarget of buildCandidateUrls(PORTAL_URL, true)) {
    try {
      const landedPortal = await engine.load(portalTarget, 15000)
      if (String(landedPortal).startsWith('load-error')) continue
      if (isLoginLandingUrl(landedPortal)) {
        portalAuthRequired = true
        authRedirectCount += 1
        break
      }
      let portalOk = false
      for (let pageNo = 1; pageNo <= portalPageLimit; pageNo++) {
        await engine.run(buildPortalListStartJs(pageNo))
        const raw = await engine.waitFor(PORTAL_LIST_POLL_JS, 15000, 250)
        const parsed = typeof raw === 'string' && raw ? JSON.parse(raw) : raw
        if (!parsed || parsed.okCount <= 0) break
        portalOk = true
        const pageItems = parsed.items || []
        const okSources = parsed.okSources ?? (parsed.okCount === PORTAL_COLUMNS.length
          ? PORTAL_COLUMNS.map(({ tag }) => tag) : pageItems.map(({ source }) => source))
        for (const source of okSources) failedSources.delete(source)
        if (!pageItems.length) break
        const hitCached = ingestPage(pageItems)
        if (hitCached) break
      }
      if (portalOk) {
        succeededSources += 1
        portalAuthRequired = false
        break
      }
    } catch (_) {}
  }

  // 2) 教务处：先尝试直连，失败回退 WebVPN；日常仅抓第 1 页，首次最多抓 3 页
  const jwcPageLimit = hasSourceCache(['jwc:']) ? 1 : maxInitialPages
  for (const jwcTarget of [JWC_LIST_DIRECT, JWC_LIST]) {
    try {
      const timeout = jwcTarget === JWC_LIST_DIRECT ? 10000 : 25000
      let nextUrl = jwcTarget
      let jwcOk = false
      for (let pageNo = 1; pageNo <= jwcPageLimit && nextUrl; pageNo++) {
        const landedJwc = await engine.load(nextUrl, timeout)
        if (String(landedJwc).startsWith('load-error')) break
        if (isLoginLandingUrl(landedJwc)) {
          authRedirectCount += 1
          break
        }
        const raw = await engine.run(JWC_LIST_JS)
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!Array.isArray(arr) || !arr.length) break
        jwcOk = true
        const hitCached = ingestPage(arr)
        if (hitCached || pageNo >= jwcPageLimit) break
        nextUrl = String((await engine.run(NEXT_PAGE_JS).catch(() => '')) || '')
      }
      if (jwcOk) {
        succeededSources += 1
        failedSources.delete('jwc')
        break
      }
    } catch (_) {}
  }

  // 3) 订阅学院：独立直连；日常仅抓第 1 页，首次最多抓 3 页
  for (const college of getSubscribedCollegeSources(options.collegeIds || [])) {
    try {
      const pageLimit = hasSourceCache([`${college.id}:`]) ? 1 : maxInitialPages
      const listJs = buildCollegeListJs(college)
      let nextUrl = college.listUrl
      for (let pageNo = 1; pageNo <= pageLimit && nextUrl; pageNo++) {
        const landed = await engine.load(nextUrl, 10000)
        if (safeDomain(landed) !== college.host || isLoginLandingUrl(landed)) break
        const raw = await engine.run(listJs)
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!Array.isArray(arr) || !arr.length) break
        if (pageNo === 1) {
          succeededSources += 1
          failedSources.delete(college.id)
        }
        const hitCached = ingestPage(arr)
        if (hitCached || pageNo >= pageLimit) break
        const next = String((await engine.run(NEXT_PAGE_JS)) || '').replace(/^http:/i, 'https:')
        if (!next.startsWith('https://') || next === nextUrl || safeDomain(next) !== college.host) break
        nextUrl = next
      }
    } catch (_) {}
  }

  if (succeededSources === 0) {
    if (authRedirectCount > 0 || portalAuthRequired) {
      throw new WebVpnAuthError('校园网认证已过期，当前显示离线缓存')
    }
    throw new Error('全部通知源抓取失败，请检查网络或登录状态后重试')
  }

  // 教务处详情页有防盗链，通道域名会被 302 回普通域名而拦截。
  // 同一篇通知通常也发在“全校通知”里，按标题匹配一份镜像地址（走 www 通道域名，正文可取）。
  return { fetchedAt: new Date().toISOString(), items: sortAndMatchMirrors(items), portalAuthRequired, authRequired: portalAuthRequired, failedSources: [...failedSources] }
}

async function fetchBody(engine, item, http?: NoticeHttpClient) {
  if (http) return fetchBodyFast(http, item)
  const diagnostics = []
  const publicCollege = isCollegeSource(item.source)
  const expectedId = String(item.id || '').replace(/^\d+_/, '')
  const expectedTitle = String(item.title || '')
  const waitForArticleOrLogin = async (mirrored = false, timeoutMs = 2500) => {
    const script = bodyScript({
      expectedTitle, expectedId: mirrored ? '' : expectedId, expectedUrl: mirrored ? '' : item.url
    })
    const deadline = Date.now() + timeoutMs
    let last = null
    do {
      last = await engine.run(script).then((raw) => typeof raw === 'string' ? JSON.parse(raw) : raw).catch(() => null)
      if (['login', 'article', 'content-unmatched'].includes(last?.pageType)) return last
      await new Promise((r) => setTimeout(r, 350))
    } while (Date.now() < deadline)
    return last
  }
  const attempt = async (url, sourceKind, loadTimeoutMs = 30000, referer = '') => {
    try {
      const landed = await engine.load(url, loadTimeoutMs, referer || undefined)
      if (String(landed).startsWith('load-error')) {
        diagnostics.push({ domain: safeDomain(url), pageType: 'unknown', result: 'network-error' })
        return { failure: 'network', error: '网页加载失败，请检查网络后重试。' }
      }
      if (isLoginLandingUrl(landed)) {
        diagnostics.push({ domain: safeDomain(landed), pageType: 'login', result: 'authentication-required' })
        return { failure: 'auth', error: '请先登录科大 VPN 后查看这条通知。', pageType: 'login' }
      }
      const data = await waitForArticleOrLogin(sourceKind === 'school-mirror', loadTimeoutMs < 15000 ? 6000 : 12000)
      if (data?.pageType === 'login') {
        diagnostics.push({ domain: safeDomain(data.url || landed), pageType: 'login', result: 'authentication-required' })
        return { failure: 'auth', error: '请先登录科大 VPN 后查看这条通知。', pageType: 'login' }
      }
      if (data?.pageType === 'article' && data.articleMatch) {
        const usedVpn = isWebVpnHost(safeDomain(data.url || landed)) || isWebVpnHost(safeDomain(url))
        diagnostics.push({ domain: safeDomain(data.url || landed), pageType: 'article', result: 'matched' })
        return { ...normalizeBodyResources(data, usedVpn), sourceKind, diagnostics }
      }
      diagnostics.push({ domain: safeDomain(data?.url || landed), pageType: data?.pageType || 'unknown', result: 'article-not-found' })
      return { failure: 'parse', error: '页面已打开，但没有核对到这条通知的正文。', pageType: data?.pageType || 'unknown' }
    } catch (err) {
      diagnostics.push({ domain: safeDomain(url), pageType: 'unknown', result: 'network-error' })
      return { failure: 'network', error: '网页加载失败，请检查网络后重试。' }
    }
  }

  // 学院优先 HTTPS 直连；其他来源先走 WebVPN，教务处正文附带对应列表页 Referer。
  const directUrl = publicCollege ? toDirectUrl(item.url) : ''
  const publicUrl = safeDomain(directUrl).endsWith('.haust.edu.cn') ? directUrl.replace(/^http:/i, 'https:') : directUrl
  const candidates = buildCandidateUrls(publicUrl || item.url, !publicCollege)
  const sourceUrl = publicUrl || toWebVpnUrl(item.url) || item.url
  let lastResult = { failure: 'network', error: '网络连接失败，请重新加载。' }
  for (const target of candidates) {
    const viaVpn = isWebVpnHost(safeDomain(target))
    const kind = item.source === 'jwc'
      ? (viaVpn ? 'jwc-webvpn' : 'jwc-direct')
      : (viaVpn ? 'webvpn' : 'original')
    const referer = item.source === 'jwc' ? (viaVpn ? JWC_LIST : JWC_LIST_DIRECT) : ''
    const res = await attempt(target, kind, viaVpn ? 25000 : 10000, referer)
    if (!res.failure) return { ...res, sourceUrl: viaVpn ? target : sourceUrl }
    lastResult = res
    if (res.failure === 'auth') return { ...res, sourceUrl }
  }

  if (lastResult.failure !== 'auth' && item.source === 'jwc' && item.mirrorUrl) {
    // 转载仅在标题与正文同时核对成功后使用，并显式标明来源。
    const mirror = await attempt(toWebVpnUrl(item.mirrorUrl), 'school-mirror')
    if (!mirror.failure) return { ...mirror, sourceUrl: toWebVpnUrl(item.url) || item.url, mirrored: true }
    if (mirror.failure === 'auth') return { ...mirror, sourceUrl: toWebVpnUrl(item.url) || item.url }
  }

  // 教务处详情页可能校验 Referer；依次在 WebVPN 列表与直连列表中找到原链接，移除 target="_blank" 后点击进入
  if (item.source === 'jwc' && lastResult.failure !== 'auth') {
    for (const listUrl of [JWC_LIST, JWC_LIST_DIRECT]) {
      try {
        const landedList = await engine.load(listUrl, listUrl === JWC_LIST ? 25000 : 10000)
        if (String(landedList).startsWith('load-error')) {
          diagnostics.push({ domain: safeDomain(listUrl), pageType: 'unknown', result: 'network-error' })
          continue
        }
        if (isLoginLandingUrl(landedList)) {
          diagnostics.push({ domain: safeDomain(landedList), pageType: 'login', result: 'authentication-required' })
          return { text: '', imgs: [], failure: 'auth', error: '请先登录科大 VPN 后查看这条通知。', diagnostics, sourceUrl: toWebVpnUrl(item.url) || item.url, pageType: 'login' }
        }
        const clicked = await engine.run(
          `(() => { const id = ${JSON.stringify(expectedId)}; const title = ${JSON.stringify(expectedTitle.replace(/\s+/g, ''))}; const links = [...document.querySelectorAll('a[href]')]; const a = links.find((x) => id && ((x.getAttribute('href') || '').includes('wbnewsid=' + id) || (x.getAttribute('href') || '').includes('/' + id + '.htm'))) || links.find((x) => title && (x.title || x.textContent || '').replace(/\\s+/g, '').includes(title)); if (!a) return false; a.removeAttribute('target'); a.click(); return true; })()`
        )
        if (clicked) {
          const clickedData = await waitForArticleOrLogin(25000)
          if (clickedData?.pageType === 'login') {
            diagnostics.push({ domain: safeDomain(clickedData.url), pageType: 'login', result: 'authentication-required' })
            return { text: '', imgs: [], failure: 'auth', error: '请先登录科大 VPN 后查看这条通知。', diagnostics, sourceUrl: toWebVpnUrl(item.url) || item.url, pageType: 'login' }
          }
          if (clickedData?.pageType === 'article' && clickedData.articleMatch) {
            const usedVpn = isWebVpnHost(safeDomain(clickedData.url)) || isWebVpnHost(safeDomain(listUrl))
            diagnostics.push({ domain: safeDomain(clickedData.url), pageType: 'article', result: 'matched-from-list' })
            return { ...normalizeBodyResources(clickedData, usedVpn), sourceKind: 'jwc-list-click', diagnostics, sourceUrl: toWebVpnUrl(item.url) || item.url }
          }
          diagnostics.push({ domain: safeDomain(clickedData?.url), pageType: clickedData?.pageType || 'unknown', result: 'timeout-or-parse-failure' })
        }
      } catch (_) {
        diagnostics.push({ domain: safeDomain(listUrl), pageType: 'unknown', result: 'network-error' })
      }
    }
  }

  const last = diagnostics[diagnostics.length - 1]
  const failure = last?.result === 'network-error' ? 'network' : 'parse'
  return {
    title: '', text: '', imgs: [], failure,
    error: failure === 'network' ? '网络连接失败，请重新加载。' : '未能识别正文。可在应用内打开原文查看。',
    diagnostics,
    sourceUrl,
    pageType: last?.pageType || 'unknown'
  }
}

type HtmlNode = {
  tag: string
  attrs: Record<string, string>
  children: (HtmlNode | string)[]
  parent?: HtmlNode
}

const HTML_VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const HTML_BLOCK = new Set('br p div li h1 h2 h3 h4 h5 h6 tr table section article'.split(' '))
const htmlSpace = (value = '') => value.replace(/\s+/g, ' ').trim()

const SIMPLE_ENTITIES = new Map(Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', middot: '·', laquo: '«', raquo: '»'
}))

function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] !== '#') return SIMPLE_ENTITIES.get(key.toLowerCase()) ?? entity
    const point = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1))
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '\ufffd'
  })
}

function noticeDomTree(element: Element): HtmlNode {
  const root: HtmlNode = { tag: '#document', attrs: {}, children: [] }
  const append = (parent: HtmlNode, dom: Node) => {
    if (dom.nodeType === 3) parent.children.push(dom.nodeValue || '')
    if (dom.nodeType !== 1) return
    const element = dom as Element
    const tag = element.localName
    if (/^(?:script|style|noscript|template)$/.test(tag)) return
    const attrs = Object.fromEntries(Array.from(element.attributes, ({ name, value }) => [name, value]))
    const node: HtmlNode = { tag, attrs, children: [], parent }
    parent.children.push(node)
    for (const child of element.childNodes) append(node, child)
  }
  if (element) append(root, element)
  return root
}

function parseHtml(html: string): HtmlNode {
  if (typeof DOMParser !== 'undefined') return noticeDomTree(new DOMParser().parseFromString(html, 'text/html').documentElement)
  const root: HtmlNode = { tag: '#document', attrs: {}, children: [] }

  // VSB fixtures in Node need only text, attributes and ancestry. Never execute markup.
  const stack = [root]
  const markup = html.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
  const tokens = /<\/?[a-z][\w:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>|<![^>]*>|[^<]+|</gi
  for (const [token] of markup.matchAll(tokens)) {
    const opening = /^<(\/?)([\w:-]+)\b/i.exec(token)
    if (!opening) {
      if (!token.startsWith('<!')) stack.at(-1)!.children.push(decodeHtml(token))
      continue
    }
    const tag = opening[2].toLowerCase()
    const last = stack.findLastIndex((node) => node.tag === tag)
    if (opening[1]) {
      if (last > 0) stack.length = last
      continue
    }
    if (last > 0 && ['li', 'tr', 'td', 'p', 'a'].includes(tag)) stack.length = last
    const attrs = Object.create(null)
    const attributes = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g
    for (const [, key, quoted, single, bare] of token.slice(opening[0].length, -1).matchAll(attributes)) {
      attrs[key.toLowerCase()] ??= decodeHtml(quoted ?? single ?? bare ?? '')
    }
    const parent = stack.at(-1)!
    const node = { tag, attrs, children: [], parent }
    parent.children.push(node)
    if (!HTML_VOID.has(tag) && !token.endsWith('/>')) stack.push(node)
  }
  return root
}

function* htmlElements(node: HtmlNode): Generator<HtmlNode> {
  for (const child of node.children) {
    if (typeof child === 'string') continue
    yield child
    yield* htmlElements(child)
  }
}

function htmlText(node: HtmlNode): string {
  const text = node.children.map((child) => typeof child === 'string' ? child : htmlText(child)).join('')
  return HTML_BLOCK.has(node.tag) ? text + '\n' : text
}

function asHttpsUrl(value: string, baseUrl: string): URL | undefined {
  if (!value?.trim() || value.trim().startsWith('#')) return
  try {
    const url = new URL(value, baseUrl)
    if (url.protocol === 'http:' && url.hostname.endsWith('.haust.edu.cn')) url.protocol = 'https:'
    if (url.protocol === 'https:' && !url.username && !url.password) return url
  } catch { /* Ignore malformed links. */ }
}

function noticeDate(text: string, allowShort = false): string {
  const full = /\b(20\d{2})(?:[-/.]|\s*年\s*)(\d{1,2})(?:[-/.]|\s*月\s*)(\d{1,2})(?!\d)/.exec(text)
  const short = allowShort && /(?:^|[^\d./-])(\d{1,2})-(\d{1,2})(?![\d./-])/.exec(text)
  const date = full?.slice(1) || (short && [String(new Date().getFullYear()), ...short.slice(1)])
  return date ? [date[0], date[1].padStart(2, '0'), date[2].padStart(2, '0')].join('-') : ''
}

function articleId(url: URL, allowStatic: boolean): string {
  const id = url.searchParams.get('wbnewsid') ||
    (allowStatic ? /\/info\/\d+\/(\d+)\.htm$/i.exec(url.pathname)?.[1] : '')
  return id && /^\d+$/.test(id) ? id : ''
}

function readListDate(link: HtmlNode, allowShort: boolean) {
  let shortDate = ''
  for (let row = link.parent, depth = 0; row && depth < 4; row = row.parent, depth++) {
    if (['body', 'main', 'html', '#document', 'ul', 'ol', 'table'].includes(row.tag)) break
    const text = htmlText(row)
    const date = noticeDate(text)
    if (date) return date
    if (allowShort && !shortDate) shortDate = noticeDate(text, true)
    if (row.tag === 'li' || row.tag === 'tr') break
  }
  return shortDate
}

function parseVsbList(html: string, baseUrl: string, college?: CollegeSource) {
  const root = parseHtml(html)
  const items = new Map<string, NoticeListItem>()
  let nextPageUrl = ''
  const nodes = [...htmlElements(root)]
  for (const link of nodes) {
    if (link.tag !== 'a' || !link.attrs.href) continue
    const url = asHttpsUrl(link.attrs.href, baseUrl)
    if (!url) continue
    const label = htmlSpace(htmlText(link))
    if (!nextPageUrl && url.hostname === safeDomain(baseUrl) &&
        (/^(下\s*页|下一页)$/.test(label || link.attrs.title) || link.attrs.rel === 'next')) {
      nextPageUrl = url.href
    }
    const id = articleId(url, !!college)
    const title = htmlSpace(link.attrs.title) || label
    if (!id || !title || items.has(id)) continue
    items.set(id, {
      source: college?.id ?? 'jwc', sourceName: college?.shortName ?? '教务处',
      id, title, date: readListDate(link, !!college), dept: college?.fullName ?? '教务处', url: url.href
    })
  }
  const body = nodes.find((node) => node.tag === 'body') || root
  const text = htmlText(body)
  const login = isLoginHtml(baseUrl, nodes, text, items.size > 0)
  const empty = !login && /暂无(?:相关)?(?:通知|公告|记录|数据|内容)|没有(?:相关)?(?:记录|数据)|共\s*0\s*条/.test(text)
  return { items: [...items.values()], nextPageUrl, login, empty }
}

export function parseJwcListHtml(html: string, baseUrl: string) {
  return parseVsbList(html, baseUrl)
}

export function parseCollegeListHtml(html: string, baseUrl: string, college: CollegeSource) {
  return parseVsbList(html, baseUrl, college)
}

function isLoginHtml(url: string, nodes: HtmlNode[], text: string, article = false): boolean {
  if (isLoginLandingUrl(url) || /\/(?:login|cas)(?:[/?.#]|$)/i.test(url.split(/[?#]/, 1)[0])) return true
  if (nodes.some((node) => node.tag === 'input' && node.attrs.type?.toLowerCase() === 'password')) return true
  return !article && /统一身份认证|统一认证|VPN\s*登录|用户登录|请先登录|登录后查看/.test(text)
}

export function isDecorativeNoticeImage(url: string, attrs: Record<string, string> = {}): boolean {
  const label = [attrs.alt, attrs.class, attrs.id, attrs.title].join(' ')
  if (/logo|banner|carousel|swiper|轮播|校徽|二维码|qrcode/i.test(label) ||
      /(?:^|[\s_-])(?:icon|ewm|spacer)(?:[\s_-]|$)/i.test(label)) return true
  const size = (value = '') => /^\s*\d+(?:px)?\s*$/i.test(value) ? parseInt(value, 10) : NaN
  const width = size(attrs.width) || size(attrs.style?.match(/(?:^|;)\s*width\s*:\s*(\d+px)/i)?.[1])
  const height = size(attrs.height) || size(attrs.style?.match(/(?:^|;)\s*height\s*:\s*(\d+px)/i)?.[1])
  if (width <= 2 || height <= 2 || (width <= 32 && height <= 32)) return true

  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
    try { path = decodeURIComponent(path) } catch { /* Keep the encoded path. */ }
  } catch { return true }
  if (/\/(?:_upload|__local|system\/_content|ueditor|uploads?|attachments?)\//.test(path)) return false
  return /\/(?:images?|img|assets|dfiles)(?:\/[^/]+)*\/(?:logo|banner|top|head|foot|icon|bg|ewm|qr[-_]?code|xiaohui|pic\d*banner|slide|carousel|nav|menu|blank|spacer|transparent|pixel)/.test(path) ||
    /\/(?:logo|favicon|banner|carousel|xiaohui|qr[-_]?code|spacer|transparent|blank|pixel)(?:[-_.\d/]|$)/.test(path)
}

type NoticeArticleIdentity = { expectedTitle?: string; expectedId?: string; expectedUrl?: string; publicCollege?: boolean }

// Explicit dependencies let the same extractor run in the hidden WebView.
function extractNoticeBody(
  root: HtmlNode, baseUrl: string, { expectedTitle = '', expectedId = '', expectedUrl = '' }: NoticeArticleIdentity,
  compact: typeof compactNoticeTitle, decorative: typeof isDecorativeNoticeImage, resolveUrl: typeof asHttpsUrl,
  loginUrl: typeof isLoginLandingUrl, readDate: typeof noticeDate
) {
  const space = (value: string) => value.replace(/\s+/g, ' ').trim()
  const hasClass = (node: HtmlNode, name: string) => (node.attrs.class || '').split(/\s+/).includes(name)
  const chrome = (node: HtmlNode) => /^(?:header|nav|footer|aside)$/.test(node.tag) ||
    /^(?:navigation|banner|contentinfo)$/.test(node.attrs.role || '') || 'hidden' in node.attrs ||
    /(?:^|[\s_-])(?:header|nav|footer|banner|slider|swiper|carousel|logo|ewm|qrcode)(?:[\s_-]|\d|$)/i
      .test([node.attrs.class, node.attrs.id].join(' '))
  function* elements(node: HtmlNode, forHeadings = false): Generator<HtmlNode> {
    for (const child of node.children) {
      if (typeof child === 'string' || (chrome(child) && !(forHeadings && child.tag === 'header' && node.tag === 'article'))) continue
      yield child
      yield* elements(child, forHeadings)
    }
  }
  const textOf = (node?: HtmlNode, omit?: HtmlNode): string => {
    if (!node || node === omit || chrome(node)) return ''
    const text = node.children.map((child) => typeof child === 'string' ? child : textOf(child, omit)).join('')
    return /^(?:br|p|div|li|h[1-6]|tr|table|section|article)$/.test(node.tag) ? text + '\n' : text
  }
  const nodes = [...elements(root)]
  const pageText = textOf(nodes.find((node) => node.tag === 'body') || root)
  const form = (node: HtmlNode) => node.tag === 'form' && node.attrs.name === '_newscontent_fromname'
  const articleSelectors = [
    (node: HtmlNode) => /^vsb_content/i.test(node.attrs.id || ''),
    ...['v_news_content', 'article-content', 'news_con', 'wp_articlecontent'].map((name) =>
      (node: HtmlNode) => hasClass(node, name)),
    (node: HtmlNode) => node.tag === 'article',
    form
  ]
  const heading = (node: HtmlNode) => /^(?:h1|h2|h3)$/.test(node.tag) ||
    ['tit', 'title', 'article-title', 'news_title', 'bt', 'biaoti'].some((name) => hasClass(node, name))
  const findHeadings = (node: HtmlNode) => heading(node) ? [node] : [...elements(node, true)].filter(heading)
  const candidates = [...new Set(articleSelectors.flatMap((selector) => nodes.filter(selector)))]
  const containers = candidates.filter((node) => ![...elements(node)].some((child) => candidates.includes(child)))

  const relatedHeadings = (content: HtmlNode) => {
    // VSB and WordPress often put the headline (and a meta <h2> like "发布时间：...") before the rich text.
    const found: HtmlNode[] = []
    for (let child = content, depth = 0; child.parent && depth < 4; child = child.parent, depth++) {
      const parent = child.parent
      if (/^(?:body|html|main|#document)$/.test(parent.tag)) break
      for (const sibling of parent.children.slice(0, parent.children.indexOf(child)).reverse()) {
        if (typeof sibling === 'string') continue
        if (sibling.tag === 'header' && parent.tag === 'article') {
          found.push(...[...elements(sibling)].filter(heading))
          continue
        }
        if (chrome(sibling)) continue
        if (candidates.includes(sibling) || [...elements(sibling)].some((node) => candidates.includes(node))) break
        found.push(...findHeadings(sibling))
      }
      if (form(parent) || parent.tag === 'article') break
    }
    return found
  }

  const targetTitle = compact(expectedTitle)
  const titleMatches = (title: string) => {
    const actual = compact(title)
    if (!targetTitle || !actual) return false
    if (actual === targetTitle) return true
    const shorter = Math.min(actual.length, targetTitle.length)
    return shorter >= 6 && (actual.includes(targetTitle) || targetTitle.includes(actual))
  }
  const documentTitle = space(textOf(nodes.find((node) => node.tag === 'title')))
  const pageTitle = titleMatches(documentTitle) ? documentTitle :
    documentTitle.replace(/\s*[-–—_|｜]\s*(?:河南科技大学.*|河科大.*|[^-_|｜]*新闻网|[^-_|｜]*教务处|[^-_|｜]*学院.*)$/, '')
  const metaOrGeneric = /^(?:发布时间|发布日期|时间[：:]|日期[：:]|来源[：:]|作者[：:]|点击[：:]|浏览[：:]|编辑[：:]|当前位置|您当前的位置|首页\s*(?:>|»|\/|-)|系统提示|首页$|网站首页$|校园新闻$|全校通知$|通知公告$|新闻中心$|正文$|文章详情$|河南科技大学(?:[^0-9]{0,24}(?:学院|新闻网|教务处|官网))?$)/
  const usableTitle = (title: string) => !!compact(title) && (titleMatches(title) || !metaOrGeneric.test(title))

  const landed = resolveUrl(baseUrl, baseUrl)
  const requested = expectedUrl ? resolveUrl(expectedUrl, expectedUrl) : undefined
  const urlId = (url?: URL) => {
    if (!url) return ''
    const id = url.searchParams.get('wbnewsid') || /\/(\d+)\.s?html?$/i.exec(url.pathname)?.[1] || url.searchParams.get('id')
    return /^\d+$/.test(id || '') ? id : ''
  }
  const canonicalHost = (url: URL) => url.hostname.replace(/^([a-z0-9-]+)-haust-edu-cn-s\.haust\.edu\.cn$/i,
    (_, host: string) => host.replace(/-/g, '.') + '.haust.edu.cn')
  const requestedId = urlId(requested)
  const landedId = urlId(landed)
  const expectedArticleId = requestedId || expectedId.replace(/^\d+_/, '')
  const sameHost = !!landed && (!requested || canonicalHost(requested) === canonicalHost(landed))
  const section = (url?: URL) => url?.searchParams.get('wbtreeid') || /\/info\/(\d+)\//i.exec(url?.pathname || '')?.[1]
  const wrongId = sameHost && !!expectedArticleId && !!landedId && (
    expectedArticleId !== landedId || (!!section(requested) && !!section(landed) && section(requested) !== section(landed)))
  const idMatch = sameHost && !wrongId && !!landedId && landedId === expectedArticleId
  const login = loginUrl(baseUrl) || nodes.some((node) => node.tag === 'input' && node.attrs.type?.toLowerCase() === 'password')

  for (const content of containers) {
    if (login || wrongId) break
    const related = relatedHeadings(content)
    const local = findHeadings(content)
    const headingPool = [...related, ...local].filter((node) => usableTitle(space(textOf(node))))
    const matchedNode = headingPool.find((node) => titleMatches(space(textOf(node))))
    const headline = matchedNode || headingPool[0]
    const headlineText = headline ? space(textOf(headline)) : ''
    const title = matchedNode
      ? headlineText
      : (containers.length === 1 && titleMatches(pageTitle)
        ? pageTitle
        : (headlineText || (containers.length === 1 && usableTitle(pageTitle) ? pageTitle : '')))
    if (!titleMatches(title) && !(containers.length === 1 && idMatch && (!title || !targetTitle))) continue

    const text = textOf(content, local.includes(headline) ? headline : undefined)
      .replace(/[ \t\u00a0]+/g, ' ').replace(/\n(?:\s*\n){2,}/g, '\n\n').trim()
    if (form(content) && !headline && !text) continue
    const imgs = new Set<string>()
    const articleNodes = [...elements(content)]
    for (const { tag, attrs } of articleNodes) {
      if (tag !== 'img') continue
      for (const src of [attrs['data-src'], attrs['data-original'], attrs['data-lazy-src'], attrs.src]) {
        const url = resolveUrl(src, baseUrl)?.href
        if (!url || decorative(url, attrs)) continue
        imgs.add(url)
        break
      }
    }

    // VSB may put attachments beside the rich text in the same article form.
    let scope = content
    for (let parent = content.parent; parent; parent = parent.parent) {
      if (!form(parent)) continue
      if ([...elements(parent)].filter((node) => containers.includes(node)).length === 1) scope = parent
      break
    }
    const attachments = new Map<string, { name: string; url: string }>()
    for (const node of scope === content ? articleNodes : elements(scope)) {
      if (node.tag !== 'a') continue
      const { href, title } = node.attrs
      const url = resolveUrl(href, baseUrl)
      if (!url) continue
      const file = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|wps)$/i.test(url.pathname)
      if (!file && !/\/download\.jsp$|\/(?:attachments?|_upload)\//i.test(url.pathname)) continue
      if (!file && (/\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(url.pathname) || decorative(url.href) ||
          [...elements(node)].some((child) => child.tag === 'img'))) continue
      attachments.set(url.href, { name: space(textOf(node)) || title || '附件', url: url.href })
    }
    if (!text && !imgs.size && !attachments.size) continue
    if (/^(?:请先登录|登录后查看|统一身份认证|VPN\s*登录)/.test(text)) break
    return {
      title: title || expectedTitle, text, imgs: [...imgs], attachments: [...attachments.values()],
      date: readDate(pageText), url: baseUrl, pageType: 'article', articleMatch: true
    }
  }

  const requiresLogin = login || /统一身份认证|统一认证|VPN\s*登录|用户登录|请先登录|登录后查看|您无权访问此页面|无权访问/.test(pageText)
  return {
    title: '', text: '', imgs: [], attachments: [], date: '', url: baseUrl,
    pageType: requiresLogin ? 'login' : candidates.length ? 'content-unmatched' : 'page',
    articleMatch: false
  }
}

export function parseNoticeBodyHtml(html: string, baseUrl: string, identity: NoticeArticleIdentity = {}) {
  return extractNoticeBody(parseHtml(html), baseUrl, identity, compactNoticeTitle,
    isDecorativeNoticeImage, asHttpsUrl, isLoginLandingUrl, noticeDate)
}

type NoticePage = { items: NoticeListItem[]; nextPageUrl?: string }
type NoticeSource = { id: string; load: () => Promise<NoticeListItem[]> }

const noticeAuthError = () => new WebVpnAuthError('校园网认证已过期，当前显示离线缓存')
const readRedirectLocation = (response: NoticeHttpResponse) => {
  const headers = response.headers || {}
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'location')
  return key ? String(headers[key] || '') : ''
}
const isAuthResponse = (response: NoticeHttpResponse) => {
  if (response.status === 401 || isLoginLandingUrl(response.url)) return true
  if (response.status >= 300 && response.status < 400) {
    const loc = readRedirectLocation(response)
    // Only treat 3xx as auth failure when Location points to CAS/WebVPN login or is missing on a WebVPN host.
    if (loc) return isLoginLandingUrl(loc)
    return isWebVpnHost(safeDomain(response.url))
  }
  return false
}
const isOkResponse = (response: NoticeHttpResponse) => response.status >= 200 && response.status < 300

export async function fetchListFast(http: NoticeHttpClient, options: NoticeListOptions = {}): Promise<NoticeListResult> {
  const existingKeys = new Set(options.existingKeys)
  const maxPages = Math.max(1, Math.min(3, Math.floor(options.maxInitialPages || 3)))

  async function paginate(source: string, start: string, readPage: (url: string) => Promise<NoticePage>) {
    const limit = [...existingKeys].some((key) => key.startsWith(source + ':')) ? 1 : maxPages
    const items = new Map<string, NoticeListItem>()
    const visited = new Set<string>()
    let next = start
    for (let i = 0; i < limit && next && !visited.has(next); i++) {
      let page: NoticePage
      try {
        page = await readPage(next)
      } catch (error) {
        if (i === 0) throw error
        break
      }
      visited.add(next)
      let hitCached = false
      for (const raw of page.items) {
        const item = normalizeNoticeItem(raw)
        const key = item.source + ':' + item.id
        if (existingKeys.has(key)) hitCached = true
        if (!items.has(key)) items.set(key, item)
      }
      if (hitCached || !page.items.length) break
      next = page.nextPageUrl || ''
    }
    return [...items.values()]
  }

  // Both portal columns share a cookie read and start their requests independently.
  const portalCookies = Promise.resolve().then(() => http.getCookies?.(PORTAL_ORIGIN + '/'))
  const portalSources: NoticeSource[] = PORTAL_COLUMNS.map((column) => ({
    id: column.tag,
    load: async () => {
      const cookie = await portalCookies
      if (!cookie?.trim()) throw noticeAuthError()
      const pageUrl = (page: number) => PORTAL_ORIGIN + '/portal-api/v3/cms/content/getColumncontents?' +
        new URLSearchParams({
          kw: '', columnId: column.id, pageNo: String(page), pageSize: '20',
          loadContent: 'false', loadPicContents: 'true', sf_request_type: 'ajax'
        })
      return paginate(column.tag, pageUrl(1), async (url) => {
        const response = await http.get(url, {
          headers: { Cookie: cookie, Referer: PORTAL_URL, Accept: 'application/json' }, timeoutMs: 8000
        })
        if (isAuthResponse(response) || /^\s*</.test(response.data)) throw noticeAuthError()
        if (!isOkResponse(response)) throw new Error('Portal request failed')
        const raw = JSON.parse(response.data)
        const data = raw?.data
        if ([raw?.code, raw?.status].some((code) => [302, 401].includes(Number(code))) ||
            /请先登录|未登录|登录已过期/.test(String(raw?.message ?? raw?.msg ?? ''))) throw noticeAuthError()
        if (!Array.isArray(data?.allContents)) throw new Error('Unexpected portal list')
        const items = data.allContents.flatMap((row: any) => {
          const title = htmlSpace(String(row?.title ?? ''))
          if (!title) return []
          return [{
            source: column.tag, sourceName: column.name, id: String(row.id ?? ''),
            title, date: noticeDate(String(row.releaseStartTime || row.createTime || '')),
            dept: htmlSpace(String(row.releaseDeptName ?? '')),
            url: asHttpsUrl(row.url, response.url || url)?.href || ''
          }]
        })
        if (data.allContents.length && !items.length) throw new Error('Unexpected portal items')
        const page = Number(new URL(url).searchParams.get('pageNo'))
        const hasNext = data.totalPages != null ? page < Number(data.totalPages) : data.allContents.length === 20
        return { items, nextPageUrl: hasNext ? pageUrl(page + 1) : '' }
      })
    }
  }))

  const loadHtml = (source: string, start: string, timeoutMs: number, college?: CollegeSource, cookie?: string) =>
    paginate(source, start, async (url) => {
      const response = await http.get(url, { timeoutMs, headers: cookie ? { Cookie: cookie } : undefined })
      const landed = response.url || url
      if (isAuthResponse(response)) throw noticeAuthError()
      if (!isOkResponse(response) || safeDomain(landed) !== safeDomain(start)) throw new Error('Notice list request failed')
      const page = college ? parseCollegeListHtml(response.data, landed, college) : parseJwcListHtml(response.data, landed)
      if (page.login) throw noticeAuthError()
      if (!page.items.length && !page.empty) throw new Error('Unexpected notice list')
      return page
    })

  const sources: NoticeSource[] = [
    ...portalSources,
    {
      id: 'jwc',
      load: async () => {
        try {
          return await loadHtml('jwc', JWC_LIST_DIRECT, 5000)
        } catch (directError) {
          const cookie = await http.getCookies?.(JWC_LIST).catch(() => '')
          try {
            return await loadHtml('jwc', JWC_LIST, 8000, undefined, cookie)
          } catch (error) {
            throw directError instanceof WebVpnAuthError ? directError : error
          }
        }
      }
    },
    ...getSubscribedCollegeSources(options.collegeIds || []).map((college) => ({
      id: college.id,
      load: () => loadHtml(college.id, college.listUrl, 6000, college)
    }))
  ]
  const settled = await Promise.allSettled(sources.map((source) => source.load()))
  const items: NoticeListItem[] = []
  const failedSources: string[] = []
  let portalAuthRequired = false
  let authRequired = false
  for (const [i, result] of settled.entries()) {
    const source = sources[i].id
    if (result.status === 'fulfilled') {
      items.push(...result.value)
      continue
    }
    failedSources.push(source)
    if (result.reason instanceof WebVpnAuthError) {
      authRequired = true
      if (source === 'school' || source === 'news') portalAuthRequired = true
    }
  }
  return { fetchedAt: new Date().toISOString(), items: sortAndMatchMirrors(items), portalAuthRequired, authRequired, failedSources }
}

export async function fetchBodyFast(http: NoticeHttpClient, item: NoticeListItem): Promise<NoticeBody> {
  const publicCollege = isCollegeSource(item.source)
  const directCandidate = asHttpsUrl(toDirectUrl(item.url), toDirectUrl(item.url))?.href || ''
  const vpnCandidate = asHttpsUrl(toWebVpnUrl(item.url), toWebVpnUrl(item.url))?.href || ''
  // Public college pages & public HAUST news/www sites try fast direct HTTPS first, then fall back to WebVPN.
  const directHost = safeDomain(directCandidate)
  const preferDirect = publicCollege || (
    (item.source === 'school' || item.source === 'news') &&
    !!directHost && directHost !== 'i.haust.edu.cn' && directHost.endsWith('.haust.edu.cn')
  )
  const primaryUrl = preferDirect ? (directCandidate || vpnCandidate) : (vpnCandidate || directCandidate)
  const secondaryUrl = preferDirect ? (vpnCandidate !== primaryUrl ? vpnCandidate : '') : (directCandidate !== primaryUrl ? directCandidate : '')
  const sourceUrl = primaryUrl || directCandidate || vpnCandidate
  const networkFailure: NoticeBody = { text: '', failure: 'network', error: '网页加载失败，请检查网络后重试。', sourceUrl }
  const authFailure: NoticeBody = { text: '', failure: 'auth', error: '请先登录科大 VPN 后查看这条通知。', pageType: 'login', sourceUrl }
  if (!sourceUrl) return { text: '', failure: 'parse', error: '通知链接不可用。' }

  const attempt = async (url: string, sourceKind: string, mirrored = false, timeoutOverride?: number): Promise<NoticeBody> => {
    const viaVpn = isWebVpnHost(safeDomain(url))
    const referer = item.source === 'jwc' && !mirrored ? (viaVpn ? JWC_LIST : JWC_LIST_DIRECT)
      : publicCollege ? undefined : PORTAL_URL
    try {
      const headers: Record<string, string> = referer ? { Referer: referer } : {}
      if (viaVpn) {
        const cookie = await http.getCookies?.(url)
        if (cookie) headers.Cookie = cookie
      }
      const timeoutMs = timeoutOverride ?? (viaVpn ? 7000 : 4500)
      const response = await http.get(url, { headers, timeoutMs })
      if (isAuthResponse(response)) return authFailure
      if (!isOkResponse(response)) return networkFailure
      const landed = response.url || url
      const body = parseNoticeBodyHtml(response.data, landed, {
        expectedTitle: item.title,
        expectedId: mirrored ? '' : item.id,
        expectedUrl: mirrored ? '' : item.url,
        publicCollege
      })
      if (body.pageType === 'login') return authFailure
      if (body.articleMatch && (!publicCollege || safeDomain(landed) === safeDomain(url) || isWebVpnHost(safeDomain(landed)))) {
        return { ...normalizeBodyResources(body, isWebVpnHost(safeDomain(landed))), sourceUrl: url, sourceKind, mirrored }
      }
      return { text: '', failure: 'parse', error: '未能识别正文。可在应用内打开原文查看。', sourceUrl: url, pageType: body.pageType }
    } catch {
      return networkFailure
    }
  }

  const kindOf = (url: string) => {
    const viaVpn = isWebVpnHost(safeDomain(url))
    return item.source === 'jwc' ? (viaVpn ? 'jwc-webvpn' : 'jwc-direct') : (viaVpn ? 'webvpn' : 'original')
  }
  const primary = await attempt(primaryUrl, kindOf(primaryUrl), false, preferDirect && secondaryUrl ? 3500 : undefined)
  if (!primary.failure) return primary
  let finalFailure = primary
  if (secondaryUrl) {
    // Always try the alternate path (direct <-> WebVPN): e.g. public college pages that return
    // "您无权访问此页面" over direct internet succeed via WebVPN with cookies, and vice versa on campus Wi-Fi.
    const secondary = await attempt(secondaryUrl, kindOf(secondaryUrl))
    if (!secondary.failure) return secondary
    if (secondary.failure === 'auth') finalFailure = secondary
  }
  if (finalFailure.failure === 'auth' || item.source !== 'jwc') return finalFailure
  const mirror = item.mirrorUrl && toWebVpnUrl(item.mirrorUrl)
  const mirrorUrl = mirror && asHttpsUrl(mirror, mirror)?.href
  if (mirrorUrl) {
    const result = await attempt(mirrorUrl, 'school-mirror', true)
    if (!result.failure || result.failure === 'auth') return result
  }
  return finalFailure
}

export { fetchList, fetchBody, toWebVpnUrl, toDirectUrl, buildCandidateUrls, PORTAL_URL, JWC_LIST, JWC_LIST_DIRECT }
