import type { AuthOptions, AuthRequest, CaptchaAnswer } from '../../types.ts'
import { CHAOXING_LOGIN_URL, isChaoxingLoginUrl } from './chaoxing.ts'
import {
  authDelay, authPageScript, AuthFlowError, classifyAuthError, classifyAuthRisk,
  driveAuth, failAuth, inspectAuthPage, waitForAuthInput
} from './auth-flow.ts'
import type { AuthBrowser } from './auth-flow.ts'

export const CHAOXING_LAST_ACCOUNT_KEY = 'haust:chaoxing_last_account_v1'

export function readChaoxingAccount(storage: Pick<Storage, 'getItem'>) {
  try { return storage.getItem(CHAOXING_LAST_ACCOUNT_KEY) || '' } catch { return '' }
}

export function rememberChaoxingAccount(storage: Pick<Storage, 'setItem'>, account: string) {
  const value = account.trim()
  if (!value) return
  try { storage.setItem(CHAOXING_LAST_ACCOUNT_KEY, value) } catch {}
}

export function isChaoxingDestination(url: string) {
  try {
    const target = new URL(url)
    return target.protocol === 'https:' && target.hostname.endsWith('.chaoxing.com') &&
      !target.hostname.startsWith('passport') && !isChaoxingLoginUrl(url) &&
      !/(?:^|\/)(?:login|verify|captcha)(?:[/.]|$)/i.test(target.pathname)
  } catch {
    return false
  }
}

export function classifyChaoxingQrStatus(url: string, text = '') {
  if (isChaoxingDestination(url)) return 'confirmed'
  if (/二维码.{0,10}(?:失效|过期)|扫码.{0,5}(?:超时|过期)|请刷新二维码/.test(text)) return 'expired'
  if (/已扫码|已扫描|扫码成功|扫描成功|请在.{0,12}(?:学习通|手机|客户端).{0,8}确认/.test(text)) return 'scanned'
  return 'waiting'
}

type ChaoxingRequest = Extract<AuthRequest, { platform: 'chaoxing' }>

const CHAOXING_SMS_LOGIN_URL =
  'https://passport2.chaoxing.com/login?loginType=2&newversion=true&fid=&refer=https%3A%2F%2Fi.chaoxing.com'

export async function driveChaoxingAuth(
  browser: AuthBrowser,
  run: (script: string) => Promise<unknown>,
  request: ChaoxingRequest,
  options: AuthOptions
) {
  const { signal, onProgress } = options
  onProgress({ type: 'stage', message: request.mode === 'qr' ? '正在获取学习通登录二维码…' : '正在连接学习通…' })
  const entryUrl = request.mode === 'sms' ? CHAOXING_SMS_LOGIN_URL : CHAOXING_LOGIN_URL
  await driveAuth(browser, run, options, entryUrl, '超星学习通', async ({ execute, readUrl, setRisk }) => {
    let submitted = false
    let smsRequested = false
    let tabClicked = false
    let qrRefresh = false
    let qrImage: string | undefined
    let qrStatus: ReturnType<typeof classifyChaoxingQrStatus> | undefined
    let qrExpires = 0
    let buttonDeadline = Date.now() + 25_000
    let submissionDeadline = 0
    let riskUrl = ''
    let previousUrl = ''
    let smsCode = ''
    let captchaCode = ''
    let captchaMessage = '请输入图片中的验证码'
    const refresh = () => { qrRefresh = true }
    const deadline = Date.now() + 5 * 60_000

    while (Date.now() < deadline) {
      const url = await readUrl()
      if (isChaoxingDestination(url)) {
        await setRisk(false)
        if (request.mode === 'qr') onProgress({ type: 'qr', status: 'confirmed', dataUrl: qrImage, refresh })
        onProgress({ type: 'stage', message: '正在校验学习通会话…' })
        await authDelay(1200, signal)
        return
      }
      if (riskUrl && url !== riskUrl) {
        await setRisk(false)
        riskUrl = ''
      }
      if (url !== previousUrl) {
        previousUrl = url
        buttonDeadline = Date.now() + 25_000
      }
      const page = await inspectAuthPage(execute, false, request.mode === 'qr')
      if (page) {
        const failure = classifyAuthError(page.error) || classifyAuthError(page.text)
        const risk = classifyAuthRisk(page)
        if (failure && (smsRequested || submitted || failure.reason === 'locked') &&
            !(failure.reason === 'captcha' && risk === 'image' && request.mode === 'password')) {
          if (submitted && request.mode === 'sms' && failure.reason === 'captcha') {
            failAuth('sms_code', failure.message)
          }
          throw new AuthFlowError(failure)
        }
        if ((risk === 'complex' || (risk === 'image' && !page.dataUrl)) && !(request.mode === 'sms' && page.smsSent)) {
          await setRisk(true)
          riskUrl = url
          await authDelay(450, signal)
          continue
        }
        if (riskUrl) {
          await setRisk(false)
          riskUrl = ''
          buttonDeadline = Date.now() + 25_000
          if (submissionDeadline) submissionDeadline = Date.now() + 25_000
        }
        if (request.mode === 'qr') {
          if (qrRefresh) {
            qrRefresh = false
            qrStatus = undefined
            qrImage = undefined
            qrExpires = 0
            buttonDeadline = Date.now() + 25_000
            if (await execute(authPageScript(false, 'qr_refresh', {}, true)) !== 'clicked') {
              tabClicked = false
              await execute(`location.origin === 'https://passport2.chaoxing.com' && location.reload()`)
              await authDelay(1000, signal)
              continue
            }
            await authDelay(850, signal)
            continue
          }
          let status: ReturnType<typeof classifyChaoxingQrStatus> = classifyChaoxingQrStatus(url, page.qrText)
          if (status === 'waiting' && qrStatus === 'scanned') status = 'scanned'
          if ((status === 'waiting' || status === 'scanned') && qrExpires && Date.now() >= qrExpires) status = 'expired'
          if (status === 'expired' || page.qr) {
            if (page.qr && page.qr !== qrImage && status !== 'expired') qrExpires = Date.now() + 120_000
            if (status !== qrStatus || (page.qr && page.qr !== qrImage)) {
              qrStatus = status
              qrImage = page.qr || qrImage
              onProgress({ type: 'qr', status, dataUrl: qrImage, refresh })
            }
          } else if (!tabClicked && !page.qrVisible) {
            tabClicked = await execute(authPageScript(false, 'qr_tab')) === 'clicked'
          }
          if (!qrStatus && Date.now() > buttonDeadline) failAuth('verification', '无法读取学习通二维码，请重试')
        } else if (request.mode === 'sms') {
          if (smsRequested && page.smsSent && !smsCode) {
            smsCode = await waitForAuthInput<string>(signal, (submit) => {
              onProgress({ type: 'sms_sent', retryAt: Date.now() + 60_000, submit })
            }, 300_000)
            onProgress({ type: 'stage', message: '正在提交短信验证码…' })
            buttonDeadline = Date.now() + 20_000
          }
          if (!smsRequested || (smsCode && !submitted)) {
            const result = await execute(authPageScript(false, smsCode ? 'sms_submit' : 'sms_send', {
              account: request.account, code: smsCode
            }))
            if (result === 'submitted') {
              smsRequested = true
              submitted = !!smsCode
              if (submitted) submissionDeadline = Date.now() + 25_000
              else buttonDeadline = Date.now() + 25_000
            }
          }
          if (!submitted && Date.now() > buttonDeadline) failAuth('timeout', smsRequested ? '未收到短信发送确认，请重试' : '未找到短信登录入口，请重试')
        } else {
          if (risk === 'image' && page.dataUrl &&
              (!submitted || (failure?.reason === 'captcha' && failure.message !== captchaMessage))) {
            captchaMessage = failure?.message || '请输入图片中的验证码'
            const answer = await waitForAuthInput<CaptchaAnswer>(signal, (respond) => {
              onProgress({ type: 'captcha', dataUrl: page.dataUrl!, message: captchaMessage, respond })
            })
            if ('refresh' in answer) {
              await execute(authPageScript(false, 'captcha_refresh'))
              submitted = false
              await authDelay(550, signal)
              continue
            }
            captchaCode = answer.text
            submitted = false
            onProgress({ type: 'stage', message: '正在校验学习通登录…' })
          }
          if (!submitted) {
            const result = await execute(authPageScript(false, 'password', {
              account: request.account, password: request.password, code: captchaCode
            }))
            if (result === 'submitted') {
              submitted = true
              submissionDeadline = Date.now() + 25_000
            }
          }
          if (!submitted && Date.now() > buttonDeadline) failAuth('verification', '无法读取学习通登录表单，请重试')
        }
      }
      if (submissionDeadline && Date.now() > submissionDeadline) failAuth('timeout', '学习通登录超时，请重试')
      await authDelay(450, signal)
    }
    failAuth('timeout', '学习通登录超时，请重试')
  }, true)
}
