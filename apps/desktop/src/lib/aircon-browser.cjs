const { BrowserWindow, session } = require('electron')

async function bootstrapCloudPayment(project, userAgent, cookieUrl) {
  const { AIRCON_ORIGIN } = await import('./aircon-session.mjs')
  const allowed = (value) => {
    try {
      const url = new URL(value)
      return url.origin === AIRCON_ORIGIN && !url.username && !url.password &&
        url.pathname.startsWith('/CloudPayment/')
    } catch { return false }
  }
  if (!allowed(project) || !allowed(cookieUrl)) return ''
  const isolated = session.fromPartition('haust-cloudpayment-anonymous')
  await isolated.clearStorageData()
  const window = new BrowserWindow({
    show: false,
    webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  let status = 0
  let timeout
  const protectNavigation = (event, url) => { if (!allowed(url)) event.preventDefault() }
  window.webContents.on('will-navigate', protectNavigation)
  window.webContents.on('will-redirect', protectNavigation)
  window.webContents.on('did-navigate', (_event, _url, code) => { status = code })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    const loaded = window.loadURL(project, {
      userAgent, extraHeaders: 'Accept-Language: zh-CN,zh;q=0.9\n'
    }).then(async () => {
      // Wait briefly for scripts queued after the load event before reading cookies.
      await new Promise(resolve => setTimeout(resolve, 750))
      if (window.isDestroyed() || status < 200 || status >= 300 || !allowed(window.webContents.getURL())) return ''
      const cookies = await isolated.cookies.get({ url: cookieUrl })
      return cookies.map(cookie => cookie.name + '=' + cookie.value).join('; ')
    }).catch(() => '')
    return await Promise.race([loaded, new Promise(resolve => { timeout = setTimeout(() => resolve(''), 12_000) })])
  } finally {
    clearTimeout(timeout)
    if (!window.isDestroyed()) window.destroy()
    await isolated.clearStorageData()
  }
}

module.exports = { bootstrapCloudPayment }
