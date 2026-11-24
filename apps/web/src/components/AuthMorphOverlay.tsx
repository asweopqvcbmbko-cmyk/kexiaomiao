import { useState } from 'react'
import type { AuthProgressEvent } from '../types'

export type AuthOverlayState =
  | { kind: 'loading'; message: string }
  | { kind: 'risk_revealed' }
  | { kind: 'captcha'; challenge: Extract<AuthProgressEvent, { type: 'captcha' }> }
  | { kind: 'success' | 'error'; message: string; leaving: boolean }

function CaptchaCard({ challenge, onCancel }: {
  challenge: Extract<AuthProgressEvent, { type: 'captcha' }>
  onCancel: () => void
}) {
  const [answer, setAnswer] = useState('')
  return (
    <form className="auth-captcha" aria-labelledby="auth-captcha-title" onSubmit={(event) => {
      event.preventDefault()
      if (answer.trim()) challenge.respond({ text: answer.trim() })
    }}>
      <h2 id="auth-captcha-title">图片验证码</h2>
      <p role="status">{challenge.message}</p>
      <button className="auth-captcha-image" type="button" aria-label="刷新验证码" onClick={() => challenge.respond({ refresh: true })}>
        <img src={challenge.dataUrl} alt="登录验证码" />
        <span>点击图片刷新</span>
      </button>
      <label>验证码<input autoFocus autoComplete="off" value={answer} onChange={(event) => setAnswer(event.target.value)} required /></label>
      <div className="auth-captcha-actions">
        <button className="softbtn" type="button" onClick={onCancel}>取消</button>
        <button className="primary" type="submit">确认</button>
      </div>
    </form>
  )
}

export function AuthMorphOverlay({ state, onCancel, onDismiss }: {
  state: AuthOverlayState
  onCancel: () => void
  onDismiss: () => void
}) {
  const result = state.kind === 'success' || state.kind === 'error'
  const loading = state.kind === 'loading'
  return (
    <div className={`auth-morph auth-morph--${state.kind}${result && state.leaving ? ' is-leaving' : ''}`}
      aria-hidden={state.kind === 'risk_revealed' || undefined}>
      {/* 底层全屏毛玻璃底幕：结果态不收缩，杜绝底层表单裸露与文字重叠 */}
      <div className="auth-backdrop" />
      {/* 前景主题色形变层：仅用 clip-path: circle(...) + transform/opacity 60fps 收缩为中央圆形徽章 */}
      <div className="auth-morph-disc" />
      <div className={`auth-loading${loading ? '' : ' is-hidden'}`} aria-hidden={!loading || undefined}>
        <div className="auth-glow" aria-hidden="true" />
        <p role="status">{loading ? state.message : ''}</p>
        <button className="softbtn" type="button" tabIndex={loading ? 0 : -1} onClick={onCancel}>取消登录</button>
      </div>
      {state.kind === 'captcha' && <CaptchaCard key={state.challenge.dataUrl} challenge={state.challenge} onCancel={onCancel} />}
      {result && (
        <>
          <div className="auth-result-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              {state.kind === 'success'
                ? <path pathLength="1" d="M11 25l9 9 17-20" />
                : <path pathLength="1" d="M15 15l18 18m0-18L15 33" />}
            </svg>
          </div>
          <p className="auth-result-label" role="status">{state.message}</p>
          {state.kind === 'error' && <button className="auth-dismiss" type="button" onClick={onDismiss} aria-label="返回登录表单" />}
        </>
      )}
    </div>
  )
}
