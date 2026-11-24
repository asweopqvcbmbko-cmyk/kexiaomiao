import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { data } from '../api'
import { haptic } from '../haptics'
import { readChaoxingAccount } from '../android/lib/chaoxing-auth'
import type { AuthOptions, AuthProgressEvent, AuthRequest, AuthResult } from '../types'
import { AuthMorphOverlay } from './AuthMorphOverlay'
import type { AuthOverlayState } from './AuthMorphOverlay'

type Mode = 'password' | 'sms' | 'qr'
type SmsEvent = Extract<AuthProgressEvent, { type: 'sms_sent' }>
type QrEvent = Extract<AuthProgressEvent, { type: 'qr' }>
type Success = Extract<AuthResult, { ok: true }>
const modes: { id: Mode; label: string }[] = [
  { id: 'password', label: '密码登录' }, { id: 'sms', label: '验证码登录' }, { id: 'qr', label: '扫码登录' }
]
const qrLabels = { waiting: '等待扫码', scanned: '已扫码，请在学习通确认', expired: '二维码已过期', confirmed: '扫码已确认' }

export function NativeLogin({ platform, authenticate, onClose, onSuccess, onManualLogin }: {
  platform: AuthRequest['platform']
  authenticate: (request: AuthRequest, options: AuthOptions) => Promise<AuthResult>
  onClose: () => void
  onSuccess: (result: Success, request: AuthRequest) => void
  onManualLogin?: () => void
}) {
  const school = platform === 'school'
  const [mode, setMode] = useState<Mode>('password')
  const [account, setAccount] = useState(() => school ? '' : readChaoxingAccount(localStorage))
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [remember, setRemember] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [overlay, setOverlay] = useState<AuthOverlayState | null>(null)
  const [sms, setSms] = useState<SmsEvent | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [qr, setQr] = useState<QrEvent | null>(null)
  const [qrRunning, setQrRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heading = useRef<HTMLHeadingElement>(null)
  const dialog = useRef<HTMLElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    heading.current?.focus()
    return () => {
      controller.current?.abort()
      clearTimeout(timer.current)
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    if (!retryAt) return
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 250)
    return () => clearInterval(id)
  }, [retryAt])

  function cancel() {
    controller.current?.abort()
    controller.current = null
    clearTimeout(timer.current)
    setOverlay(null)
    setSms(null)
    setQrRunning(false)
  }

  function dismissError() {
    clearTimeout(timer.current)
    setOverlay((current) => current?.kind === 'error' ? { ...current, leaving: true } : current)
    timer.current = setTimeout(() => setOverlay(null), 210)
  }

  async function start(request: AuthRequest) {
    cancel()
    const active = new AbortController()
    controller.current = active
    const qrMode = request.platform === 'chaoxing' && request.mode === 'qr'
    let confirmingQr = false
    let message = school ? '正在连接统一身份认证…' : '正在连接学习通…'
    setError('')
    setNotice('')
    if (qrMode) {
      setQr(null)
      setQrRunning(true)
    } else setOverlay({ kind: 'loading', message })
    const result = await authenticate(request, {
      signal: active.signal,
      onProgress(event) {
        if (active.signal.aborted) return
        switch (event.type) {
          case 'stage':
            message = event.message
            if (!qrMode || confirmingQr) setOverlay({ kind: 'loading', message })
            break
          case 'captcha':
            setOverlay({ kind: 'captcha', challenge: {
              ...event, respond: (answer) => {
                setOverlay({ kind: 'loading', message: '正在处理验证码…' })
                event.respond(answer)
              }
            } })
            break
          case 'risk':
            setOverlay(event.revealed ? { kind: 'risk_revealed' } :
              qrMode && !confirmingQr ? null : { kind: 'loading', message })
            break
          case 'sms_sent':
            setOverlay(null)
            setSms(event)
            setSeconds(60)
            setRetryAt(event.retryAt)
            break
          case 'qr':
            confirmingQr = event.status === 'confirmed'
            setQr(event)
            break
        }
      }
    })
    if (active.signal.aborted) return
    setSms(null)
    setQrRunning(false)
    if (result.ok) {
      haptic('success')
      setPassword('')
      setCode('')
      setOverlay({ kind: 'success', message: '登录成功', leaving: false })
      timer.current = setTimeout(() => {
        setOverlay({ kind: 'success', message: '登录成功', leaving: true })
        timer.current = setTimeout(() => onSuccess(result, request), 210)
      }, 1080)
    } else {
      setError(result.message)
      if (result.reason === 'cancelled') {
        setOverlay(null)
        return
      }
      haptic('error')
      setOverlay({ kind: 'error', message: result.message, leaving: false })
      timer.current = setTimeout(dismissError, 1400)
    }
  }

  function selectMode(next: Mode) {
    if (next === mode) return
    cancel()
    setMode(next)
    setError('')
    setPassword('')
    setCode('')
    setShown(false)
    setQr(null)
    setNotice('')
    if (next === 'qr') void start({ platform: 'chaoxing', mode: 'qr' })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = account.trim()
    if (!value) return
    if (school && password) void start({ platform: 'school', username: value, password, remember })
    else if (mode === 'password' && password) void start({ platform: 'chaoxing', mode, account: value, password })
    else if (mode === 'sms' && sms && code.trim()) {
      sms.submit(code.trim())
      setSms(null)
      setOverlay({ kind: 'loading', message: '正在提交短信验证码…' })
    }
  }

  async function saveQr(launch: boolean) {
    if (!qr?.dataUrl || !qrRunning || qr.status === 'expired' || saving) return
    const current = controller.current
    setNotice('')
    setSaving(true)
    try {
      const result = await data.saveImageToGallery(qr.dataUrl, `学习通登录二维码-${Date.now()}.png`)
      if (current?.signal.aborted) return
      if (!result.saved) setNotice(result.message || '无法保存二维码')
      else if (!launch) setNotice('二维码已保存到相册')
      else {
        const app = await data.launchApp('com.chaoxing.mobile')
        if (!current?.signal.aborted && !app.launched) setNotice('二维码已保存，请在学习通相册中扫码')
      }
    } finally {
      setSaving(false)
    }
  }

  const formDisabled = !!overlay
  const leavingSuccess = overlay?.kind === 'success' && overlay.leaving
  const hasQr = !!qr?.dataUrl && qrRunning && qr.status !== 'expired' && qr.status !== 'confirmed'
  return (
    <section ref={dialog} className={`native-login${leavingSuccess ? ' is-leaving-success' : ''}`} role="dialog" aria-modal="true" aria-labelledby="native-login-heading"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        if (event.key !== 'Tab') return
        const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled)'
        ) || []).filter((element) => element.getClientRects().length && !element.closest('[aria-hidden="true"]'))
        const index = focusable.indexOf(document.activeElement as HTMLElement)
        if (focusable.length && (event.shiftKey ? index <= 0 : index < 0 || index === focusable.length - 1)) {
          event.preventDefault()
          focusable[event.shiftKey ? focusable.length - 1 : 0].focus()
        }
      }}>
      <header className="native-login-top">
        <button className="native-login-back" type="button" aria-label="返回" onClick={onClose} disabled={formDisabled}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h13" /></svg>
        </button>
        <span>{school ? '教务系统统一认证' : '超星学习通'}</span>
      </header>
      <div className="native-login-content">
        <h1 ref={heading} id="native-login-heading" tabIndex={-1}>{school ? '登录教务' : '登录学习通'}</h1>
        <fieldset className="native-login-fields" disabled={formDisabled}>
          {!school && (
            <div className="native-login-segments" role="group" aria-label="登录方式">
              {modes.map(({ id, label }) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => selectMode(id)}>{label}</button>)}
            </div>
          )}
          {!school && mode === 'qr' ? (
            <div className="native-login-qr">
              <div className="native-login-qr-box">
                {hasQr ? <img src={qr.dataUrl} alt="学习通登录二维码" /> : qrRunning && qr?.status !== 'expired'
                  ? <span role="status">正在获取二维码…</span>
                  : <button type="button" className="softbtn" onClick={() => {
                    if (qrRunning && qr?.status === 'expired') {
                      setNotice('')
                      setQr(null)
                      qr.refresh()
                    } else void start({ platform: 'chaoxing', mode: 'qr' })
                  }}>刷新二维码</button>}
              </div>
              {qr && qrRunning && <p className="native-login-qr-status" role="status">{qrLabels[qr.status]}</p>}
              <button className="primary" type="button" disabled={!hasQr || saving} onClick={() => void saveQr(true)}>保存二维码并打开学习通</button>
              <button className="softbtn" type="button" disabled={!hasQr || saving} onClick={() => void saveQr(false)}>仅保存图片到相册</button>
              {notice && <p className="native-login-notice" role="status">{notice}</p>}
            </div>
          ) : (
            <form className="native-login-form" onSubmit={submit}>
              <label>{school ? '学号 / 工号' : mode === 'sms' ? '手机号' : '手机号 / 学号'}
                <input autoComplete={mode === 'sms' ? 'tel' : 'username'} inputMode={mode === 'sms' ? 'tel' : undefined}
                  required readOnly={!!sms} value={account} onChange={(event) => setAccount(event.target.value)} />
              </label>
              {mode === 'password' ? (
                <label>密码
                  <div className="native-login-input-action">
                    <input type={shown ? 'text' : 'password'} autoComplete="current-password" required
                      value={password} onChange={(event) => setPassword(event.target.value)} />
                    <button type="button" onClick={() => setShown(!shown)}>{shown ? '隐藏' : '显示'}</button>
                  </div>
                </label>
              ) : (
                <label>短信验证码
                  <div className="native-login-input-action">
                    <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} />
                    <button type="button" disabled={seconds > 0 || !/^\+?\d{7,15}$/.test(account.trim())} onClick={() => {
                      setCode('')
                      void start({ platform: 'chaoxing', mode: 'sms', account: account.trim() })
                    }}>{seconds > 0 ? `${seconds}s 后重试` : '获取验证码'}</button>
                  </div>
                </label>
              )}
              {school && <label className="native-login-remember">
                <input type="checkbox" role="switch" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                记住密码（本机 Keystore 加密保存）
              </label>}
              <button className="primary" type="submit" disabled={mode === 'sms' && !sms}>登录</button>
              {onManualLogin && (
                <button className="softbtn" type="button" onClick={() => { cancel(); onManualLogin() }}>
                  {school ? '在统一身份认证页手动登录' : '在学习通网页手动登录（含机构账号）'}
                </button>
              )}
            </form>
          )}
          {!school && mode === 'qr' && onManualLogin && (
            <button className="softbtn native-login-qr-fallback" type="button" onClick={() => { cancel(); onManualLogin() }}>
              无法扫码？改用网页手动登录
            </button>
          )}
          {error && !overlay && <p className="native-login-error" role="alert">{error}</p>}
        </fieldset>
      </div>
      {overlay && <AuthMorphOverlay state={overlay} onCancel={cancel} onDismiss={dismissError} />}
    </section>
  )
}
