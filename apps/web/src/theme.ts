/**
 * 主题：浅色 / 深色 / 跟随系统，与原型一致——写 <html data-theme>，localStorage 持久化，
 * 跟随系统时监听 prefers-color-scheme 变化。
 * key 沿用项目的命名空间（原型是 km-theme，这里用 haust-theme，避免和旧数据混淆）。
 */
export type Theme = 'light' | 'dark' | 'system'

const KEY = 'haust-theme'
const mq = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch (_) {}
  return 'system'
}

export function applyTheme(theme: Theme) {
  const actual = theme === 'system' ? (mq().matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = actual
  try {
    localStorage.setItem(KEY, theme)
  } catch (_) {}
  // 让 Electron 的标题栏 / 安卓状态栏跟上
  const bg = actual === 'dark' ? '#0E1218' : '#F3F5F9'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', bg)
  // 安卓：状态栏底色跟 App 背景一致，图标黑白跟着主题（沉浸感的来源）
  try {
    ;(window as any).haust?.statusBar?.({ color: bg, dark: actual === 'dark' })
  } catch (_) {}
}

export function watchSystemTheme() {
  const handler = () => {
    if (readTheme() === 'system') applyTheme('system')
  }
  mq().addEventListener('change', handler)
  return () => mq().removeEventListener('change', handler)
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
