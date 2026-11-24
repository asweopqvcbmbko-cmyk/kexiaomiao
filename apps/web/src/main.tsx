import React from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './app.css'

/**
 * 启动：在 Capacitor（安卓）里先把 window.haust 挂上，再渲染界面。
 * 桌面版走 Electron preload 注入的 window.haust，不需要这一步；
 * 浏览器里两者都没有，界面会显示「暂无数据」。
 */
async function boot() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { androidApi } = await import('./android/api')
      ;(window as any).haust = androidApi
    } else if (import.meta.env.DEV && !(window as any).haust && new URLSearchParams(location.search).has('preview')) {
      const { createDevPreviewHaust } = await import('./dev-preview')
      ;(window as any).haust = createDevPreviewHaust()
    }
  } catch (_) {
    // 没有 Capacitor 运行时（桌面/浏览器）时静默跳过
  }
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

boot()
