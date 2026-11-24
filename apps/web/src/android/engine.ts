/**
 * 安卓侧的「看不见的浏览器」：调 Kotlin 插件 SchoolBrowserPlugin。
 * 接口与桌面版 lib/engine.js 的 load / run / waitFor / hide 一一对应，
 * 所以 adapters/eams.js、notices.js、card.js 这三个适配器可以原样跑。
 */
import { registerPlugin } from '@capacitor/core'

type Plugin = {
  load(o: { url: string; timeoutMs?: number; referer?: string }): Promise<{ url: string; timeout?: boolean }>
  eval(o: { js: string }): Promise<{ value: any }>
  evalOverlay(o: { js: string }): Promise<{ value: any }>
  currentUrl(): Promise<{ url: string }>
  open(o: { url: string; title?: string; silent?: boolean; desktopUa?: boolean }): Promise<{ shown: boolean }>
  reveal(o?: { title?: string }): Promise<{ revealed: boolean }>
  conceal(): Promise<{ concealed: boolean }>
  saveImageToGallery(o: { dataUrl: string; filename?: string }): Promise<{ saved: boolean; message?: string }>
  close(o?: { successMessage?: string }): Promise<{ closed: boolean; url: string }>
  isOpen(): Promise<{ open: boolean }>
  cookies(o: { url: string }): Promise<{ cookies: string }>
  airconHttp(o: { url: string; headers: Record<string, string> }): Promise<{
    status: number
    data: string
    location: string
    setCookies: string[]
  }>
  airconWebViewRequest(o: {
    project: string
    activateUrl: string
    targetUrl: string
    userAgent: string
  }): Promise<{
    status: number
    data: string
    mode?: string
  }>
  bootstrapAircon(o: { project: string; userAgent: string; cookieUrl: string }): Promise<{
    cookies: string
    mode?: string
    httpStatus?: number
    error?: string
  }>
  airconAuthBootstrap(o: { idToken: string; userAgent: string; cookieUrl?: string }): Promise<{
    cookies: string
    mode?: string
    error?: string
  }>
  casTokenLogin(o: { username: string; password: string; deviceId: string }): Promise<{
    status: number
    data: string
  }>
  isolateAirconHttp(): Promise<void>
  clearCookies(): Promise<{ ok: boolean }>
  clearCookiesForHosts(o: { hosts: string }): Promise<{ ok: boolean }>
  openExternal(o: { url: string }): Promise<{ ok: boolean }>
  launchApp(o: { packageName: string }): Promise<{ launched: boolean; installed: boolean }>
  haptic(o: { style: 'light' | 'medium' | 'success' | 'error' }): Promise<void>
  statusBar(o: { color: string; dark: boolean }): Promise<void>
}

const SchoolBrowser = registerPlugin<Plugin>('SchoolBrowser')

export const engine = {
  async load(url: string, timeoutMs = 45000, referer?: string): Promise<string> {
    const r = await SchoolBrowser.load(referer ? { url, timeoutMs, referer } : { url, timeoutMs })
    return r?.url || url
  },
  async run(js: string): Promise<any> {
    const r = await SchoolBrowser.eval({ js })
    return r?.value
  },
  async waitFor(js: string, timeoutMs = 15000, intervalMs = 400): Promise<any> {
    const deadline = Date.now() + timeoutMs
    let last: any = false
    while (Date.now() < deadline) {
      try {
        last = await engine.run(js)
        if (last) return last
      } catch (_) {}
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return last || false
  },
  hide() {},
  async url() {
    try {
      return (await SchoolBrowser.currentUrl()).url
    } catch (_) {
      return ''
    }
  }
}

export const browser = SchoolBrowser

/** 在可见登录窗里执行 JS（登录流程要在那里点「登录」按钮） */
export const overlay = {
  async run(js: string): Promise<any> {
    const r = await SchoolBrowser.evalOverlay({ js })
    return r?.value
  }
}
