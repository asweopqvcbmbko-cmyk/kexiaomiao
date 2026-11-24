/**
 * 通知聚合适配器：三个来源
 *  - 全校通知公告 / 校园新闻（i 科大 portal-api）
 *  - 教务处通知公告（jwc）
 *  - 材料学院通知公告（cl）
 * 列表统一成 { source, sourceName, id, title, date, dept, url }；
 * 正文按需抓取（用户点开某条时才请求），避免每次刷新都打 40 个详情页。
 */

const PORTAL_URL = 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/NewsCenter'
const JWC_LIST = 'https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm'
const CL_LIST = 'https://cl.haust.edu.cn/index/tzgg.htm'

const PORTAL_COLUMNS_JSON = JSON.stringify([
  { id: 'remote-1120073', tag: 'school', name: '全校通知' },
  { id: 'remote-1120074', tag: 'news', name: '校园新闻' }
])

const PORTAL_LIST_JS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const cols = ${PORTAL_COLUMNS_JSON};
  const out = [];
  for (const c of cols) {
    const x = new XMLHttpRequest();
    x.open('GET', '/portal-api/v3/cms/content/getColumncontents?kw=&columnId=' + c.id +
      '&pageNo=1&pageSize=20&loadContent=false&loadPicContents=true&sf_request_type=ajax', false);
    x.send(null);
    let j = {};
    try { j = JSON.parse(x.responseText); } catch (e) { continue; }
    const arr = (j.data && j.data.allContents) || [];
    for (const it of arr) {
      out.push({
        source: c.tag,
        sourceName: c.name,
        id: String(it.id || ''),
        title: norm(it.title),
        date: String(it.releaseStartTime || it.createTime || '').slice(0, 10),
        dept: norm(it.releaseDeptName),
        url: it.url || ''
      });
    }
  }
  return JSON.stringify(out);
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

const BODY_JS = String.raw`(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const el =
    document.querySelector('[id^=vsb_content]') ||
    document.querySelector('.v_news_content') ||
    document.querySelector('.article-content') ||
    document.querySelector('article');
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
  const imgs = [...document.querySelectorAll('[id^=vsb_content] img, .v_news_content img')]
    .map((i) => i.getAttribute('src'))
    .filter(Boolean)
    .map((s) => new URL(s, location.href).href);
  const dm = (document.body.innerText || '').match(/20\d\d年\d{1,2}月\d{1,2}日|20\d\d-\d{2}-\d{2}/);
  return JSON.stringify({
    title: norm(document.title),
    text: el ? h2t(el) : '',
    imgs: imgs,
    date: dm ? dm[0] : '',
    url: location.href
  });
})()`

function withAlias(url) {
  return String(url || '').replace('https://www.haust.edu.cn/', 'https://www-haust-edu-cn-s.haust.edu.cn/')
}

async function fetchList(engine) {
  const items = []

  // 1) 全校通知 + 校园新闻
  await engine.load(PORTAL_URL)
  try {
    const raw = await engine.run(PORTAL_LIST_JS)
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    for (const it of arr || []) items.push(it)
  } catch (_) {}

  // 2) 教务处
  await engine.load(JWC_LIST)
  try {
    const raw = await engine.run(JWC_LIST_JS)
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    for (const it of arr || []) items.push(it)
  } catch (_) {}

  // 3) 材料学院
  await engine.load(CL_LIST)
  try {
    const raw = await engine.run(CL_LIST_JS)
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    for (const it of arr || []) items.push(it)
  } catch (_) {}

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

  return { fetchedAt: new Date().toISOString(), items: items }
}

async function fetchBody(engine, item) {
  const primary = item.source === 'school' || item.source === 'news' ? withAlias(item.url) : item.url

  const tryOnce = async (target) => {
    const landed = await engine.load(target)
    if (String(landed).indexOf('load-error') === 0) return { text: '', error: landed }
    try {
      const raw = await engine.run(BODY_JS)
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw
      return data
    } catch (err) {
      return { text: '', error: String(err && err.message) }
    }
  }

  let data = await tryOnce(primary)
  if ((!data || !data.text) && item.mirrorUrl) {
    const mirror = await tryOnce(withAlias(item.mirrorUrl))
    if (mirror && mirror.text) {
      mirror.mirrored = true
      return mirror
    }
  }

  // 教务处详情页有 Referer 校验：直接 loadURL 会被拦，改成"在列表页里点进去"
  if (item.source === 'jwc' && (!data || !data.text)) {
    try {
      await engine.load(JWC_LIST)
      const clicked = await engine.run(
        `(() => { const a = document.querySelector('a[href*="wbnewsid=${String(item.id).replace(
          /[^0-9]/g,
          ''
        )}"]'); if (!a) return false; a.click(); return true; })()`
      )
      if (clicked) {
        await new Promise((r) => setTimeout(r, 4000))
        const raw = await engine.run(BODY_JS)
        const clickedData = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (clickedData && clickedData.text) return clickedData
      }
    } catch (_) {}
  }

  return data
}

module.exports = { fetchList, fetchBody, PORTAL_URL, JWC_LIST, CL_LIST }
