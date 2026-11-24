/**
 * 校园卡余额适配器（i 科大首页「热点数据」卡片）
 */

const URL_INDEX = 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/Index'

const WAIT_JS = `(() => (document.body.innerText || '').indexOf('校园卡') >= 0)()`

const EXTRACT_JS = String.raw`(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const text = document.body.innerText || '';
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
    context: i >= 0 ? norm(text.slice(i, i + 60)) : ''
  });
})()`

async function fetchCard(engine) {
  await engine.load(URL_INDEX)
  await engine.waitFor(WAIT_JS, 25000)
  // 卡片数据是异步来的，可能先渲染成 "-元"，多试几次
  for (let i = 0; i < 12; i++) {
    const raw = await engine.run(EXTRACT_JS)
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (data && data.balance) return Object.assign({ fetchedAt: new Date().toISOString() }, data)
    await new Promise((r) => setTimeout(r, 1500))
  }
  const raw = await engine.run(EXTRACT_JS)
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  return Object.assign({ fetchedAt: new Date().toISOString() }, data)
}

module.exports = { fetchCard, URL_INDEX }
