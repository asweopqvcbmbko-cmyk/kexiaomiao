// @ts-nocheck —— 从桌面端逐行移植并增强的纯逻辑模块（支持双网 ID 归一化 + 第 1 页增量截断）。
import { WebVpnAuthError, normalizeNoticeItem } from '../../notice-db.ts'

/**
 * 通知聚合适配器：三个来源
 *  - 全校通知公告 / 校园新闻（i 科大 portal-api）
 *  - 教务处通知公告（jwc）
 *  - 材料学院通知公告（cl）
 * 列表统一成 { source, sourceName, id, title, date, dept, url }；
 * 正文按需抓取（用户点开某条且本地无 IndexedDB 缓存时才请求），避免并发拉详情。
 */

const PORTAL_URL = 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/NewsCenter'
const JWC_LIST_DIRECT = 'https://jwc.haust.edu.cn/tzgg.htm'
const JWC_LIST = 'https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm'
const CL_LIST = 'https://cl.haust.edu.cn/index/tzgg.htm'

const PORTAL_COLUMNS_JSON = JSON.stringify([
  { id: 'remote-1120073', tag: 'school', name: '全校通知' },
  { id: 'remote-1120074', tag: 'news', name: '校园新闻' }
])

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
      let okCount = 0;
      for (const item of results) {
        if (item.ok) okCount += 1;
        for (const row of item.items) out.push(row);
      }
      window.__haustPortalNotices = { done: true, okCount, items: out };
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
          finishOne({ ok: true, items: list });
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

const CL_LIST_JS = `(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const out = [];
  const seen = {};
  document.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const m1 = href.match(/info\\/1204\\/(\\d+)\\.htm/);
    const m2 = href.match(/wbnewsid=(\\d+)/);
    const id = (m1 && m1[1]) || (m2 && m2[1]);
    if (!id || seen[id]) return;
    seen[id] = 1;
    const li = a.closest('li') || a.parentElement;
    const m = ((li && li.innerText) || '').match(/(20\\d\\d)年(\\d{1,2})月(\\d{1,2})日/);
    out.push({
      source: 'cl', sourceName: '材料学院', id: id,
      title: (a.title || a.textContent || '').replace(/\\s+/g, ' ').trim(),
      date: m ? m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) : '',
      dept: '材料科学与工程学院',
      url: 'https://cl.haust.edu.cn/info/1204/' + id + '.htm'
    });
  });
  return JSON.stringify(out);
})()`

const BODY_JS = String.raw`((expectedTitle, expectedId) => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const el =
    document.querySelector('[id^=vsb_content]') ||
    document.querySelector('.v_news_content') ||
    document.querySelector('.article-content') ||
    document.querySelector('form[name="_newscontent_fromname"]') ||
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('.content');
  const h2t = (node) => {
    const h = node.innerHTML
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|li|h[1-6]|tr|table|section)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const ta = document.createElement('textarea');
    ta.innerHTML = h;
    return ta.value.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  };
  const imgs = [...(el || document).querySelectorAll('img')]
    .map((i) => i.getAttribute('src'))
    .filter(Boolean)
    .map((s) => {
      try { return new URL(s, location.href).href; } catch (_) { return ''; }
    })
    .filter(Boolean);
  const attachments = [...(el || document).querySelectorAll('a[href]')]
    .map((a) => {
      const href = a.getAttribute('href') || '';
      if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return null;
      const isFile = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|wps)(?:[?#]|$)/i.test(href) || /download\.jsp|\/_upload\/|attach/i.test(href);
      if (!isFile) return null;
      try {
        return { name: norm(a.textContent || a.title || '附件'), url: new URL(href, location.href).href };
      } catch (_) { return null; }
    })
    .filter(Boolean);
  const dm = (document.body.innerText || '').match(/20\d\d年\d{1,2}月\d{1,2}日|20\d\d-\d{2}-\d{2}/);
  const url = location.href;
  const pageText = norm((document.body && document.body.innerText) || '');
  const login = /统一身份认证|统一认证|VPN登录|VPN 登录|用户登录|请先登录|登录后查看/.test(pageText) ||
    /\/login|\/cas\//i.test(url) || /passport|sso/i.test(location.hostname);
  const pageTitle = norm((el && el.querySelector('h1,h2,.tit,.title'))?.textContent || document.title);
  const compact = (s) => norm(s).replace(/[《》【】\[\]（）()“”"'：:，,。.!！?？\s]/g, '');
  const targetTitle = compact(expectedTitle);
  const actualTitle = compact(pageTitle);
  const idInUrl = expectedId && new RegExp('(?:wbnewsid=|/|id=)' + expectedId + '(?:\\D|$)').test(url);
  const titleMatch = !!targetTitle && (actualTitle === targetTitle || actualTitle.includes(targetTitle) || targetTitle.includes(actualTitle));
  const content = el ? h2t(el) : '';
  const contentImages = imgs.length > 0;
  const articleMatch = !login && !!(idInUrl || titleMatch) && !!(content || contentImages || attachments.length > 0);
  return JSON.stringify({
    title: pageTitle,
    text: content,
    imgs: imgs,
    attachments: attachments,
    date: dm ? dm[0] : '',
    url,
    pageType: login ? 'login' : articleMatch ? 'article' : el ? 'content-unmatched' : 'page',
    articleMatch
  });
})`;

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

function isLoginLandingUrl(url) {
  return /\/cas\/login|vpn\.haust\.edu\.cn\/portal|loginExt|passport|auth\.htm/i.test(String(url || ''))
}

async function fetchList(engine, options = {}) {
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
        break
      }
    } catch (_) {}
  }

  // 3) 材料学院：直连失败回退 WebVPN；日常仅抓第 1 页，首次最多抓 3 页
  const clPageLimit = hasSourceCache(['cl:']) ? 1 : maxInitialPages
  for (const clTarget of buildCandidateUrls(CL_LIST, false)) {
    try {
      const timeout = clTarget === CL_LIST ? 10000 : 25000
      let nextUrl = clTarget
      let clOk = false
      for (let pageNo = 1; pageNo <= clPageLimit && nextUrl; pageNo++) {
        const landedCl = await engine.load(nextUrl, timeout)
        if (String(landedCl).startsWith('load-error')) break
        if (isLoginLandingUrl(landedCl)) {
          authRedirectCount += 1
          break
        }
        const raw = await engine.run(CL_LIST_JS)
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!Array.isArray(arr) || !arr.length) break
        clOk = true
        const hitCached = ingestPage(arr)
        if (hitCached || pageNo >= clPageLimit) break
        nextUrl = String((await engine.run(NEXT_PAGE_JS).catch(() => '')) || '')
      }
      if (clOk) {
        succeededSources += 1
        break
      }
    } catch (_) {}
  }

  if (succeededSources === 0) {
    if (authRedirectCount > 0 || portalAuthRequired) {
      throw new WebVpnAuthError('校园网认证已过期，当前显示离线缓存')
    }
    throw new Error('全部通知源抓取失败，请检查网络或登录状态后重试')
  }

  items.sort((a, b) => String(b.date).localeCompare(String(a.date)))

  // 教务处详情页有防盗链，通道域名会被 302 回普通域名而拦截。
  // 同一篇通知通常也发在“全校通知”里，按标题匹配一份镜像地址（走 www 通道域名，正文可取）。
  const schoolByTitle = {}
  for (const it of items) {
    if ((it.source === 'school' || it.source === 'news') && it.url) {
      schoolByTitle[String(it.title).replace(/\s+/g, '')] = it.url
    }
  }
  for (const it of items) {
    if (it.source !== 'jwc') continue
    const key = String(it.title).replace(/\s+/g, '')
    if (schoolByTitle[key]) it.mirrorUrl = schoolByTitle[key]
  }

  return { fetchedAt: new Date().toISOString(), items: items, portalAuthRequired, authRequired: portalAuthRequired }
}

async function fetchBody(engine, item) {
  const diagnostics = []
  const expectedId = String(item.id || '').replace(/[^0-9]/g, '')
  const expectedTitle = String(item.title || '')
  const capture = async () => {
    const js = `${BODY_JS}(${JSON.stringify(expectedTitle)}, ${JSON.stringify(expectedId)})`
    const raw = await engine.run(js)
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }
  const waitForArticleOrLogin = async (timeoutMs = 22000) => {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
      last = await capture().catch(() => null)
      if (last?.pageType === 'login' || last?.pageType === 'article') return last
      await new Promise((r) => setTimeout(r, 350))
    }
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
      const data = await waitForArticleOrLogin(loadTimeoutMs < 15000 ? 10000 : 22000)
      if (data?.pageType === 'login') {
        diagnostics.push({ domain: safeDomain(data.url || landed), pageType: 'login', result: 'authentication-required' })
        return { failure: 'auth', error: '请先登录科大 VPN 后查看这条通知。', pageType: 'login' }
      }
      const matchedOriginal = item.source !== 'jwc' && (data?.text || data?.imgs?.length || data?.attachments?.length)
      if ((data?.pageType === 'article' && data.articleMatch) || matchedOriginal) {
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

  // 主链路：优先 WebVPN 代理链接（避免非校园网白等直连超时），教务处自动附带列表页 Referer 绕过防盗链
  const candidates = buildCandidateUrls(item.url, true)
  let lastResult = { failure: 'network', error: '网络连接失败，请重新加载。' }
  for (const target of candidates) {
    const viaVpn = isWebVpnHost(safeDomain(target))
    const kind = item.source === 'jwc'
      ? (viaVpn ? 'jwc-webvpn' : 'jwc-direct')
      : (viaVpn ? 'webvpn' : 'original')
    const referer = item.source === 'jwc' ? (viaVpn ? JWC_LIST : JWC_LIST_DIRECT) : ''
    const res = await attempt(target, kind, viaVpn ? 25000 : 10000, referer)
    if (!res.failure) return { ...res, sourceUrl: viaVpn ? target : (toWebVpnUrl(item.url) || item.url) }
    lastResult = res
    if (res.failure === 'auth') return { ...res, sourceUrl: toWebVpnUrl(item.url) || item.url }
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
    sourceUrl: toWebVpnUrl(item.url) || item.url,
    pageType: last?.pageType || 'unknown'
  }
}

export { fetchList, fetchBody, toWebVpnUrl, toDirectUrl, buildCandidateUrls, PORTAL_URL, JWC_LIST, JWC_LIST_DIRECT, CL_LIST }
