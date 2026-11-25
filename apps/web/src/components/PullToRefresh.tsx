import { useRef, useState, type ReactNode } from 'react'
import { haptic } from '../haptics'

const THRESHOLD = 56
const MAX_PULL = 104

function dampPull(dy: number): number {
  if (dy <= 0) return 0
  return Math.min(MAX_PULL, (dy * 0.52) / (1 + dy / 340))
}

/**
 * 移动端阻尼下拉刷新容器：
 * - 仅在页面滚动条处于顶部且纵向明显下拉时激活
 * - 全程 GPU 合成 transform，不改 height/padding
 * - 超过阈值触发原生 light 触感，刷新完成触发 success 触感
 */
export function PullToRefresh({
  disabled,
  refreshing,
  onRefresh,
  children
}: {
  disabled?: boolean
  refreshing?: boolean
  onRefresh: () => void | Promise<unknown>
  children: ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle')
  const startY = useRef<number | null>(null)
  const startX = useRef<number | null>(null)
  const tracking = useRef(false)
  const crossed = useRef(false)
  const active = phase === 'refreshing' || (!!refreshing && phase !== 'idle')

  const getScrollTop = () =>
    window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement | null)?.closest('.backdrop, [role="dialog"], .native-login')) return
    if (disabled || phase === 'refreshing' || e.touches.length !== 1) return
    if (getScrollTop() > 1) return
    startY.current = e.touches[0].clientY
    startX.current = e.touches[0].clientX
    tracking.current = true
    crossed.current = false
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!tracking.current || startY.current == null || startX.current == null) return
    if (disabled || phase === 'refreshing') {
      tracking.current = false
      return
    }
    const dy = e.touches[0].clientY - startY.current
    const dx = Math.abs(e.touches[0].clientX - startX.current)
    // 明显横向手势或向上滑则立即放弃，不干扰正常滚动
    if (dy <= 0 || (pull === 0 && dx > dy * 0.8)) {
      if (pull === 0) tracking.current = false
      else {
        setPull(0)
        setPhase('idle')
      }
      return
    }
    if (getScrollTop() > 1 && pull === 0) {
      tracking.current = false
      return
    }
    const next = dampPull(dy)
    setPull(next)
    const isReady = next >= THRESHOLD
    if (isReady && !crossed.current) {
      crossed.current = true
      haptic('light')
    } else if (!isReady && crossed.current) {
      crossed.current = false
    }
    setPhase(isReady ? 'ready' : 'pulling')
  }

  function onTouchEnd() {
    if (!tracking.current) return
    tracking.current = false
    startY.current = null
    startX.current = null
    if (phase === 'ready') {
      setPhase('refreshing')
      setPull(48)
      const finish = () => {
        haptic('success')
        setPull(0)
        setPhase('idle')
      }
      try {
        const res = onRefresh()
        if (res && typeof (res as Promise<unknown>).then === 'function') {
          void Promise.resolve(res).finally(() => window.setTimeout(finish, 260))
        } else {
          window.setTimeout(finish, 750)
        }
      } catch {
        window.setTimeout(finish, 260)
      }
    } else {
      setPull(0)
      setPhase('idle')
    }
  }

  const label =
    phase === 'refreshing' ? '正在刷新…' : phase === 'ready' ? '松开立即刷新' : '下拉刷新'

  return (
    <div
      className={`ptr-wrap${active ? ' is-refreshing' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className={`ptr-indicator${pull > 6 ? ' visible' : ''}${phase === 'ready' ? ' ready' : ''}${phase === 'refreshing' ? ' spinning' : ''}`}
        style={{ transform: `translate3d(0, ${Math.max(0, pull - 44)}px, 0)` }}
        aria-hidden={pull <= 6}
      >
        <span className="ptr-icon" aria-hidden="true">
          {phase === 'refreshing' ? <i className="ptr-spinner" /> : '↓'}
        </span>
        <span>{label}</span>
      </div>
      <div
        className="ptr-body"
        style={{
          transform: pull > 0 ? `translate3d(0, ${pull}px, 0)` : undefined,
          willChange: pull > 0 ? 'transform' : undefined,
          transition: tracking.current ? 'none' : 'transform .26s cubic-bezier(.22, .8, .24, 1)'
        }}
      >
        {children}
      </div>
    </div>
  )
}
