import { useCallback, useEffect, useRef, useState } from 'react'

/** 轻提示：新提示会顶掉旧提示并重新计时，卸载时清理定时器 */
export function useToast(duration = 2400) {
  const [message, setMessage] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const toast = useCallback(
    (msg: string) => {
      setMessage(msg)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMessage(''), duration)
    },
    [duration]
  )
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { message, toast }
}

/** 原生 MainActivity 会把 Android 返回键转到 window.__haustBack；返回 true 表示已消费 */
export function useAndroidBack(handler: () => boolean) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    ;(window as any).__haustBack = () => ref.current()
    return () => {
      delete (window as any).__haustBack
    }
  }, [])
}
