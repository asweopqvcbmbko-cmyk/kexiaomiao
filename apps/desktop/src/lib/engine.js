const { BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const PARTITION = 'persist:haust'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

/**
 * 数据引擎：一个与用户共享分区的浏览器窗口。
 * 未登录时它就是登录窗口（可见）；登录完成后被 hide()，继续在后台充当数据引擎。
 * 关键：全程只用一个窗口，避免二次请求把 WebVPN 的一次性令牌打失效（否则页面报"操作异常"）。
 */
class Engine {
  constructor(opts = {}) {
    // 默认仍是学校那套登录态分区；学习通另起一个持久分区，互不污染
    this.partition = opts.partition || PARTITION
    this._win = null
  }

  get win() {
    return this._win && !this._win.isDestroyed() ? this._win : null
  }

  createWindow(show) {
    const win = new BrowserWindow({
      show,
      width: 1280,
      height: 900,
      minWidth: 900,
      backgroundColor: '#0f1115',
      title: '校园助手 · 登录',
      autoHideMenuBar: true,
      webPreferences: {
        partition: this.partition,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    win.webContents.setUserAgent(UA)

    // 学校的 CAS / 门户是 Vue SPA：v-cloak 没被摘掉时整页 display:none，用户会看到白屏。
    // 每次加载后尝试摘掉它（带 40 秒内的重试，SPA 晚渲染也能兜住）。
    win.webContents.on('did-finish-load', () => {
      win.webContents
        .executeJavaScript(
          `(function(){var n=0;var t=setInterval(function(){
             var m=document.getElementById('vue_main');
             if(m && m.hasAttribute('v-cloak') && m.innerHTML.length>2000) m.removeAttribute('v-cloak');
             if(++n>40) clearInterval(t);
           },1000);})()`,
          true
        )
        .catch(() => {})
    })

    // 验证模式下定期截图，方便看登录页面到底卡在哪一步
    if (process.env.HAUST_VERIFY === '1') {
      const timer = setInterval(() => {
        if (win.isDestroyed() || win.isVisible() === false) return
        win.webContents
          .capturePage()
          .then((img) => {
            const dir = path.resolve(__dirname, '../../../../build/verify')
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, 'login.png'), img.toPNG())
          })
          .catch(() => {})
      }, 5000)
      win.on('closed', () => clearInterval(timer))
    }

    return win
  }

  async ensureWindow(show = false) {
    if (this.win) return this.win
    this._win = this.createWindow(show)
    return this._win
  }

  async load(url, timeoutMs = 45000) {
    const win = await this.ensureWindow(false)
    try {
      await Promise.race([
        win.loadURL(url, { userAgent: UA }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
      ])
    } catch (err) {
      return 'load-error:' + (err && err.message ? err.message : String(err))
    }
    return win.webContents.getURL()
  }

  async run(code) {
    const win = this.win || (await this.ensureWindow(false))
    return win.webContents.executeJavaScript(code, true)
  }

  async waitFor(code, timeoutMs = 15000, intervalMs = 400) {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) {
      try {
        last = await this.run(code)
        if (last) return last
      } catch (_) {}
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return last || false
  }

  url() {
    const win = this.win
    return win ? win.webContents.getURL() : ''
  }

  hide() {
    if (this.win) this.win.hide()
  }

  async captureTo(file) {
    const win = this.win
    if (!win) return false
    try {
      const img = await win.webContents.capturePage()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, img.toPNG())
      return true
    } catch (_) {
      return false
    }
  }
}

module.exports = { Engine, PARTITION, UA }
