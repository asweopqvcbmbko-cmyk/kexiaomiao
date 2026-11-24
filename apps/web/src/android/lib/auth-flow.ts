import type { AuthFailure, AuthOptions } from '../../types.ts'

const errors: [AuthFailure['reason'], RegExp][] = [
  ['locked', /(?:账号|账户|用户)(?:已被|已经被|已|被)?锁(?:定|住)|(?:账号|账户)被冻结/],
  ['credentials', /(?:用户名|学号|账号|账户|手机号)(?:或|\/|和)密码(?:错误|不正确|有误|不匹配)|(?:登录|账户)?密码(?:输入)?(?:错误|不正确|有误)|(?:账号|账户|用户|手机号)(?:不存在|未注册|或密码错误)|(?:无效|错误)的凭据/],
  ['sms_code', /短信验证码(?:输入)?(?:错误|不正确|无效|已过期)|手机验证码(?:错误|无效|已过期)/],
  ['captcha', /(?:图形)?验证码(?:输入)?(?:错误|不正确|有误|无效|已过期)/],
  ['rate_limit', /(?:操作|请求|发送|验证)(?:过于|太)?频繁|发送次数(?:过多|已达上限)|请勿频繁操作|请稍后再试/],
  ['timeout', /(?:登录|认证|会话|请求)(?:已)?(?:超时|过期)/],
  ['network', /网络(?:连接失败|错误|异常)|无法访问此网站|网页无法打开|短信发送失败/]
]

export function classifyAuthError(text = ''): AuthFailure | undefined {
  const compact = text.replace(/\s+/g, '')
  for (const [reason, pattern] of errors) {
    const message = compact.match(pattern)?.[0]
    if (message) return { reason, message }
  }
}

export function classifyAuthRisk(page: { complex?: boolean; captcha?: boolean; image?: boolean; text?: string }) {
  if (page.complex) return 'complex'
  if (page.captcha && page.image) return 'image'
  if (page.captcha || /请(?:完成|进行)安全验证|拖动滑块|拼图验证|点击下方按钮进行验证|请完成(?:人机|身份)验证/.test(page.text || '')) return 'complex'
  return 'none'
}

export class AuthFlowError extends Error {
  readonly failure: AuthFailure
  constructor(failure: AuthFailure) {
    super(failure.message)
    this.failure = failure
  }
}

export function failAuth(reason: AuthFailure['reason'], message: string): never {
  throw new AuthFlowError({ reason, message })
}

export function waitForAuthInput<T>(
  signal: AbortSignal,
  prompt: (respond: (value: T) => void) => void,
  timeout = 120_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const abort = () => { cleanup(); reject(signal.reason) }
    const timer = setTimeout(() => {
      cleanup()
      reject(new AuthFlowError({ reason: 'timeout', message: '验证超时，请重试' }))
    }, timeout)
    signal.addEventListener('abort', abort, { once: true })
    try {
      prompt((value) => { cleanup(); resolve(value) })
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export function authDelay(ms: number, signal: AbortSignal) {
  return waitForAuthInput<void>(signal, (respond) => setTimeout(respond, ms), ms + 10_000)
}

export interface AuthBrowser {
  open(options: { url: string; title?: string; silent?: boolean; desktopUa?: boolean }): Promise<{ shown: boolean }>
  isOpen(): Promise<{ open: boolean }>
  currentUrl(): Promise<{ url: string }>
  reveal(options: { title: string }): Promise<{ revealed: boolean }>
  conceal(): Promise<{ concealed: boolean }>
  close(): Promise<unknown>
}

export interface AuthPage {
  text: string
  error: string
  complex: boolean
  captcha: boolean
  image: boolean
  dataUrl?: string
  qr?: string
  qrVisible: boolean
  qrText: string
  smsSent: boolean
}

// Each command rechecks the current origin inside the page before accessing credentials.
export function authPageScript(
  school: boolean,
  command: 'inspect' | 'password' | 'sms_send' | 'sms_submit' | 'qr_tab' | 'qr_refresh' | 'captcha_refresh',
  fields: { account?: string; password?: string; code?: string } = {},
  scanQr = false
) {
  return `(() => {
    const school = ${school};
    const command = ${JSON.stringify(command)};
    if (location.protocol !== 'https:' || !(school
      ? /^(?:cas(?:-haust-edu-cn-s)?|webvpn|vpn|jwgl-haust-edu-cn-s)\\.haust\\.edu\\.cn$/.test(location.hostname)
      : location.hostname === 'passport2.chaoxing.com')) return null;
    if (school && command === 'password' &&
        !(/^cas(?:-haust-edu-cn-s)?\\.haust\\.edu\\.cn$/.test(location.hostname) &&
          /^\\/cas\\/login\\/?$/.test(location.pathname))) return 'wrong-page';
    const fields = ${JSON.stringify(fields)};
    const visible = (el) => !!el && el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden="true"]');
    const all = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible);
    const textOf = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim();
    const compact = (text) => text.replace(/\\s+/g, '');
    const controls = () => all('button,a,input[type=button],input[type=submit],[role=button],label,span,div,li,i')
      .filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    const control = (pattern) => controls().filter((el) => pattern.test(compact(textOf(el)))).at(-1);
    const inputs = all('input').filter((el) => !el.disabled && !el.readOnly);
    const hints = (el) => [el.id,el.name,el.placeholder,el.alt,el.title,el.className,el.getAttribute('src')].join(' ');
    const smsCode = (!school && all('#vercode')[0]) ||
      inputs.find((el) => /sms|phonecode|mobilecode|msgcode|messagecode|vercode|短信|手机验证码/i.test(hints(el)));
    const captcha = inputs.find((el) => el !== smsCode && /captcha|validatecode|validcode|verifycode|randcode|checkcode|yzm|图形验证码/i.test(hints(el))) ||
      (school ? inputs.find((el) => el.type === 'text' && /code|验证码/i.test(hints(el))) : undefined);
    const captchaImage = all('img').find((el) => !/quickCode/i.test(el.id || '') && !/createqr/i.test(el.getAttribute('src') || '') &&
        /captcha|validatecode|verifycode|randcode|checkcode|yzm|验证码/i.test(hints(el))) ||
      (captcha && Array.from(captcha.parentElement?.parentElement?.querySelectorAll('img') || [])
        .find((el) => visible(el) && el.width >= 35 && el.height <= 100));
    const qrImage = ${scanQr} && (
      all('img#quickCode, img[src*="createqr"], .ecode-box img').find((el) => el.naturalWidth >= 60 || el.clientWidth >= 60) ||
      all('img,canvas').find((el) => {
        const context = el.closest('[id*="qr" i],[class*="qr" i],[id*="ewm" i],[class*="ewm" i],.ecode-box,#rightdiv');
        return el.clientWidth >= 65 && el.clientHeight >= 65 &&
          (!!context || /quickcode|createqr|qrcode|qr.?login|\\bewm|二维码/i.test(hints(el)));
      })
    );
    const toImage = (el) => {
      if (!el) return undefined;
      try {
        if (el instanceof HTMLCanvasElement) return el.toDataURL('image/png');
        if (!el.complete || !el.naturalWidth || !el.naturalHeight) return undefined;
        if (/^data:image\\/(?:png|jpeg);base64,/.test(el.src)) return el.src;
        const canvas = document.createElement('canvas');
        canvas.width = el.naturalWidth;
        canvas.height = el.naturalHeight;
        canvas.getContext('2d').drawImage(el, 0, 0);
        return canvas.toDataURL('image/png');
      } catch (_) { return undefined; }
    };
    const set = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      for (const event of ['input', 'change', 'keyup']) el.dispatchEvent(new Event(event, { bubbles: true }));
    };
    const body = document.body?.innerText || '';
    if (command === 'inspect') {
      const smsControls = all('button,a,input[type=button],span').map(textOf);
      const qrMsg = all('#quickCodeMsg,.ecode-box p,.tip').map(textOf).filter(Boolean).join('\\n');
      return JSON.stringify({
        text: body.slice(0, 6500),
        error: all('[role=alert],#msg,#errorMsg,#errMsg,#errorTip,#err-txt,#err-txt2,#phoneMsg,#pwdMsg,#vercodeMsg,.err-tip,.err-txt,.error,.error-msg,.errorMsg,.login-error,.layui-layer-content,.toast,.tips-error')
          .map(textOf).filter(Boolean).join('\\n'),
        complex: all('.geetest_panel,.geetest_popup_wrap,.geetest_box,.geetest_holder,.geetest_slider,.cx_captcha_wrap,.cx-captcha,.cx_captcha,.cxCaptcha,.captcha-box,.nc_wrapper,.slider-captcha,[id*="slider" i],[class*="drag-verify" i],iframe[src*="captcha" i],iframe[src*="geetest" i]')
          .some((el) => el.clientHeight >= 25 && el.clientWidth >= 80),
        captcha: !!captcha,
        image: !!captchaImage,
        dataUrl: toImage(captchaImage),
        qr: toImage(qrImage),
        qrVisible: !!qrImage || /使用学习通APP扫码|请使用学习通扫码|二维码已(?:失效|过期)|已扫码|扫码成功/.test(qrMsg + ' ' + body),
        qrText: (qrMsg ? qrMsg + '\\n' : '') + body,
        smsSent: /短信(?:验证码)?(?:已发送|发送成功)|验证码已发送/.test(body) ||
          smsControls.some((text) => /^(?:重新获取|重新发送|获取验证码)?[（(]?\\d{1,2}\\s*(?:s|秒)[）)]?(?:后重发|后重新获取)?$/i.test(compact(text)))
      });
    }
    if (command === 'captcha_refresh') { captchaImage?.click(); return captchaImage ? 'clicked' : 'missing'; }
    if (command === 'qr_tab' || command === 'qr_refresh') {
      const button = command === 'qr_tab'
        ? control(/^(?:学习通)?(?:二维码|扫码)登录$/) ||
          all('#qrLogin,#qrcodeLogin,#qrCodeLogin,#qrTab,.qr-login,.qrcode-login,[title*="扫码"],[aria-label*="扫码"]').at(-1)
        : control(/^(?:点击)?(?:刷新(?:二维码)?|重新获取二维码|重新扫码)$/) ||
          all('#refreshQrCode,.qr-refresh,.qrcode-refresh').at(-1) || qrImage;
      if (!button) return 'missing';
      button.click();
      return 'clicked';
    }
    const password = inputs.find((el) => el.type === 'password');
    const accounts = inputs.filter((el) => el !== captcha && el !== smsCode && /^(text|tel|email|number|search)$/.test(el.type));
    const account = accounts.find((el) => /user|account|phone|mobile|student|学号|手机号|工号/i.test(hints(el))) || accounts[0];
    if (command === 'sms_send') {
      const send = (!school && all('#sendCodeBtn')[0]) || control(/^(?:免费)?(?:获取|发送|重新获取|重新发送)(?:短信)?验证码$/);
      const phone = (!school && all('#phone')[0]) || accounts.find((el) => el.type === 'tel' || /phone|mobile|手机号/i.test(hints(el))) || account;
      if (send && phone) {
        set(phone, fields.account);
        send.click();
        return 'submitted';
      }
      const tab = control(/^(?:验证码|短信|手机验证码)登录$/) ||
        all('a[onclick*="otherLogin(2)"],#smsLogin,#phoneCodeLogin,#messageLogin,.sms-login,.phone-code-login').at(-1);
      if (tab) { tab.click(); return 'switched'; }
      return 'missing';
    }
    const submit = (!school && all('#loginBtn')[0]) || control(/^(?:登\\s*录|立即登录|确认登录|统一身份认证登录)$/) ||
      all('#loginBtn,#loginButton,button[type=submit],input[type=submit]').at(-1);
    const code = smsCode || inputs.find((el) => el !== account && el !== captcha && /code|验证码/i.test(hints(el)));
    if (command === 'sms_submit') {
      if (!code || !submit) return 'missing';
      set(code, fields.code);
    } else {
      if (!account || !password || !submit || (captcha && !fields.code)) return 'missing';
      set(account, fields.account);
      set(password, fields.password);
    }
    if (captcha && fields.code && command !== 'sms_submit') set(captcha, fields.code);
    submit.click();
    return 'submitted';
  })()`
}

export async function driveAuth<T>(
  browser: AuthBrowser,
  run: (script: string) => Promise<unknown>,
  options: AuthOptions,
  url: string,
  title: string,
  flow: (context: {
    readUrl: () => Promise<string>
    execute: (script: string) => Promise<unknown>
    setRisk: (revealed: boolean) => Promise<void>
  }) => Promise<T>,
  desktopUa = false
): Promise<T> {
  const { signal, onProgress } = options
  signal.throwIfAborted()
  if (!(await browser.open({ url, title, silent: true, desktopUa })).shown) failAuth('verification', '无法打开登录页面，请重试')
  let revealed = false
  let lastLoadError = ''
  try {
    return await flow({
      async readUrl() {
        signal.throwIfAborted()
        if (!(await browser.isOpen()).open) failAuth('cancelled', '登录已取消')
        const { url: current } = await browser.currentUrl()
        if (current.startsWith('load-error:')) {
          // 连续两次读到同一个 load-error 才判失败，避免瞬态重定向误杀
          if (lastLoadError === current) {
            const parts = current.split(':')
            const code = parts[1] || ''
            try { console.warn('[haust] auth load-error:', current) } catch (_) {}
            failAuth('network', code ? `无法访问认证页面（${code}），请检查网络后重试` : '无法访问认证页面，请检查网络后重试')
          }
          lastLoadError = current
          return ''
        }
        lastLoadError = ''
        return current
      },
      async execute(script) {
        signal.throwIfAborted()
        const value = await run(script)
        signal.throwIfAborted()
        return value
      },
      async setRisk(next) {
        if (next === revealed) return
        signal.throwIfAborted()
        if (next) {
          if (!(await browser.reveal({ title: '完成安全验证后自动继续' })).revealed) failAuth('cancelled', '登录已取消')
        } else {
          if (!(await browser.conceal()).concealed) failAuth('cancelled', '登录已取消')
        }
        revealed = next
        onProgress({ type: 'risk', revealed })
      }
    })
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function inspectAuthPage(execute: (script: string) => Promise<unknown>, school: boolean, scanQr = false) {
  const raw = await execute(authPageScript(school, 'inspect', {}, scanQr))
  return typeof raw === 'string' ? JSON.parse(raw) as AuthPage | null : null
}
