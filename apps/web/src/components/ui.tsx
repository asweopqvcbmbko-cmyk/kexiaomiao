import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../icons'

/** 页头：左侧标题（子页带返回键），右侧刷新 / 附加操作 */
export function PageHeader({
  title,
  sub,
  refreshing,
  onRefresh,
  action,
  extra,
  onBack
}: {
  title: string
  sub: string
  /** 旧调用保留的可选参数，新版视觉不再显示英文眉标 */
  eyebrow?: string
  refreshing: boolean
  onRefresh: () => void
  action?: { icon: string; label: string; onClick: () => void; dot?: boolean }
  extra?: ReactNode
  onBack?: () => void
}) {
  return (
    <header className="topbar">
      <div className="topbar-main">
        {onBack && (
          <button className="iconbtn back" aria-label="返回" onClick={onBack}>
            <Icon name="left" />
          </button>
        )}
        <div>
          <h1>{title}</h1>
          <div className="subtitle">{sub}</div>
        </div>
      </div>
      <div className="actions">
        {extra}
        <button
          className={`iconbtn refresh ${refreshing ? 'spin' : ''}`}
          aria-label={refreshing ? '正在刷新' : '刷新数据'}
          aria-busy={refreshing}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <Icon name="refresh" />
        </button>
        {action && (
          <button className="iconbtn" aria-label={action.label} onClick={action.onClick}>
            <Icon name={action.icon} />
            {action.dot ? <i className="dot" /> : null}
          </button>
        )}
      </div>
    </header>
  )
}
export function SectionHead({ title, link, onLink }: { title: ReactNode; link?: string; onLink?: () => void }) {
  return (
    <div className="sectionhead">
      <h2>{title}</h2>
      {link ? (
        <button className="link" onClick={onLink}>
          {link}
          <Icon name="arrow" />
        </button>
      ) : null}
    </div>
  )
}

export function Empty({
  title,
  sub,
  icon = 'sun',
  children
}: {
  title: string
  sub?: string
  icon?: string
  children?: ReactNode
}) {
  return (
    <div className="card empty">
      <Icon name={icon} />
      <p>{title}</p>
      {sub ? <small>{sub}</small> : null}
      {children}
    </div>
  )
}

/** 弹窗：原型 behavior —— 点遮罩关闭、Esc 关闭、焦点循环、恢复焦点、锁滚动 */
export function Modal({
  title,
  onClose,
  children,
  label
}: {
  title: string
  onClose: () => void
  children: ReactNode
  label?: string
}) {
  const ref = useRef<HTMLElement | null>(null)
  const prev = useRef<Element | null>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  /** 先播退出动画再真正关闭；减少动效偏好下直接关闭。完成后复位，便于同一实例切换到下一个弹窗 */
  const closeRef = useRef(() => {})
  closeRef.current = () => {
    if (closeTimer.current !== undefined) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return onCloseRef.current()
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined
      setClosing(false)
      onCloseRef.current()
    }, 160)
  }
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  const downOnBackdrop = useRef(false)

  useEffect(() => {
    prev.current = document.activeElement
    document.body.style.overflow = 'hidden'
    const first = ref.current?.querySelector<HTMLElement>('.iconbtn')
    first?.focus()
    return () => {
      document.body.style.overflow = ''
      ;(prev.current as HTMLElement | null)?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const els = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      if (!els.length) return
      const a = els[0]
      const b = els[els.length - 1]
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault()
        b.focus()
      } else if (!e.shiftKey && document.activeElement === b) {
        e.preventDefault()
        a.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className={`backdrop${closing ? ' closing' : ''}`}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) closeRef.current()
        downOnBackdrop.current = false
      }}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label ? undefined : titleId}
        ref={(n) => {
          ref.current = n
        }}
      >
        <div className="dialog-top">
          <h2 id={titleId}>{title}</h2>
          <button className="iconbtn" aria-label="关闭弹窗" onClick={() => closeRef.current()}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
