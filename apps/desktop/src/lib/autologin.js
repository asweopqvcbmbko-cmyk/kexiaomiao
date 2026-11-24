/**
 * 自动登录：学校登录链路有两层
 *   1) 教务系统落地页（"统一身份认证登录" 按钮）
 *   2) CAS 统一身份认证表单（账号 / 密码）
 * 凭据来自 credentials（DPAPI 加密），仅在本机内存中短期存在。
 */

const LANDING_CLICK_JS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const cands = [...document.querySelectorAll('button, a, input[type=submit], .el-button, [role=button]')]
    .filter((el) => el.offsetParent !== null)
    .filter((el) => /统一身份认证|登录|立即登录/.test(norm(el.innerText || el.value || '')));
  if (!cands.length) return 'none';
  const el = cands[0];
  const label = norm(el.innerText || el.value || '').slice(0, 12);
  el.click();
  return 'clicked:' + label;
})()`

function fillJs(username, password) {
  return `(() => {
    const setVal = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const visible = (el) => el && el.offsetParent !== null && !el.disabled && el.type !== 'hidden';
    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const pwd = inputs.find((i) => i.type === 'password');
    const usr = inputs.find((i) => i.type !== 'password' && !/code|captcha|yzm|check/i.test((i.name || '') + (i.id || '') + (i.placeholder || '')));
    if (!usr || !pwd) return 'no-form:' + inputs.map((i) => i.type + '/' + (i.name || i.id)).join(',');
    setVal(usr, ${JSON.stringify(username)});
    setVal(pwd, ${JSON.stringify(password)});
    return 'filled';
  })()`
}

const SUBMIT_JS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const btns = [...document.querySelectorAll('button, input[type=submit], .el-button, a')]
    .filter((el) => el.offsetParent !== null)
    .filter((el) => /^登录$|登录$|^登\\s*录$|提交|确定/.test(norm(el.innerText || el.value || '')));
  if (!btns.length) {
    const form = document.querySelector('form');
    if (form) { form.submit(); return 'form-submit'; }
    return 'no-submit';
  }
  btns[0].click();
  return 'submitted:' + norm(btns[0].innerText || btns[0].value || '').slice(0, 8);
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 尝试自动登录。返回 { ok, steps[] }
 */
async function tryAutoLogin(engine, cred, isEams) {
  const steps = []
  const win = engine.win
  if (!win || !cred || !cred.username || !cred.password) return { ok: false, steps: ['no-cred'] }

  // 1) 落地页点“登录”
  try {
    steps.push('landing:' + (await engine.run(LANDING_CLICK_JS)))
  } catch (e) {
    steps.push('landing-err:' + e.message)
  }

  // 2) 等 CAS 表单（最多 20 秒）
  let filled = 'not-tried'
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    const url = win.webContents.getURL()
    if (isEams(url)) return { ok: true, steps: steps.concat(['already-eams']) }
    if (!/cas\.haust\.edu\.cn/.test(url)) continue
    try {
      filled = await engine.run(fillJs(cred.username, cred.password))
    } catch (e) {
      filled = 'fill-err:' + e.message
    }
    if (filled === 'filled') break
  }
  steps.push('fill:' + filled)
  if (filled !== 'filled') return { ok: false, steps }

  // 3) 提交
  await sleep(400)
  try {
    steps.push('submit:' + (await engine.run(SUBMIT_JS)))
  } catch (e) {
    steps.push('submit-err:' + e.message)
  }

  // 4) 等回到教务系统（最多 40 秒）
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    const url = win.webContents.getURL()
    if (isEams(url)) return { ok: true, steps }
    // 部分情况会经过一次中转页，再点一次登录
    if (i === 6) {
      try {
        const again = await engine.run(LANDING_CLICK_JS)
        steps.push('landing2:' + again)
      } catch (_) {}
    }
  }
  return { ok: false, steps: steps.concat(['timeout']) }
}

module.exports = { tryAutoLogin }
