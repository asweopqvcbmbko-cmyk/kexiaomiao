// @ts-nocheck —— 从桌面端逐行移植的纯逻辑模块（解析/筛选），保持与桌面版一字不差。
// 移植方式：require → import，module.exports → export；逻辑本身没有改。

/**
 * 校园卡余额适配器（i 科大首页「热点数据」卡片）
 */

const URL_INDEX = 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/Index'

const WAIT_JS = `(() => {
  const t = document.body.innerText || '';
  if (t.indexOf('校园卡') >= 0) return true;
  if (/统一身份认证|统一认证|用户登录|忘记密码/.test(t) || /\\/cas\\/|loginExt|passport/i.test(location.href)) return true;
  return false;
})()`

const EXTRACT_JS = String.raw`(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const text = document.body.innerText || '';
  const url = location.href || '';
  const isLogin = /统一身份认证|统一认证|用户登录|忘记密码/.test(text) || /\/cas\/|loginExt|passport/i.test(url);
  const patterns = [
    /校园卡[\s\S]{0,30}?余额[：:\s]*([\d]+(?:\.[\d]+)?)\s*元/,
    /余额[：:\s]*([\d]+(?:\.[\d]+)?)\s*元/
  ];
  let balance = null;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      balance = m[1];
      break;
    }
  }
  const i = text.indexOf('校园卡');
  return JSON.stringify({
    balance: balance,
    isLogin: isLogin,
    url: url,
    context: i >= 0 ? norm(text.slice(i, i + 60)) : ''
  });
})()`

function isLoginUrl(url) {
  return /loginExt|cas(?:-haust-edu-cn-s)?\.haust\.edu\.cn|vpn\.haust\.edu\.cn|auth\.htm|passport/i.test(url || '')
}

function assertSession(url) {
  if (!url || String(url).startsWith('load-error')) {
    throw new Error('校园卡页面加载失败 ' + String(url || '').slice(0, 120))
  }
  if (isLoginUrl(url)) {
    const err = new Error('校园卡登录已失效 ' + String(url || '').slice(0, 140))
    err.code = 'NO_SESSION'
    throw err
  }
}

/**
 * 校园卡余额。i 科大首页是 Vue 单页，余额是异步渲染的，所以在「隐藏 WebView」里
 * 只能轮询等。但隐藏 WebView 是全局串行的，等太久会把课表/通知全堵在后面
 * （以前 25s + 12×1.5s ≈ 43s，一次刷新能被它拖到 40 秒），这里收紧到 ~13 秒上限。
 */
async function fetchCard(engine) {
  const landed = await engine.load(URL_INDEX)
  assertSession(landed)
  await engine.waitFor(WAIT_JS, 8000)
  // 卡片数据是异步来的，可能先渲染成 "-元"，再试几次；若跳到登录页则立刻报 NO_SESSION
  for (let i = 0; i < 4; i++) {
    const raw = await engine.run(EXTRACT_JS)
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (data && (data.isLogin || isLoginUrl(data.url))) {
      const err = new Error('校园卡登录已失效 ' + String(data.url || '').slice(0, 140))
      err.code = 'NO_SESSION'
      throw err
    }
    if (data && data.balance) return Object.assign({ fetchedAt: new Date().toISOString() }, { balance: data.balance, context: data.context })
    await new Promise((r) => setTimeout(r, 1200))
  }
  const raw = await engine.run(EXTRACT_JS)
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (data && (data.isLogin || isLoginUrl(data.url))) {
    const err = new Error('校园卡登录已失效 ' + String(data.url || '').slice(0, 140))
    err.code = 'NO_SESSION'
    throw err
  }
  return Object.assign({ fetchedAt: new Date().toISOString() }, { balance: data ? data.balance : null, context: data ? data.context : '' })
}

export { fetchCard, URL_INDEX }
