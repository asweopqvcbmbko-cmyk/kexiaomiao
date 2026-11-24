// 解析可用的 electron 可执行文件。
// pnpm 有时会装出多份 electron（带 peer 后缀的那份可能没有下载 dist），
// 所以这里逐个探测，挑真正存在的那个。
const fs = require('node:fs')
const path = require('node:path')

function candidates() {
  const list = []
  try {
    const p = require('electron')
    if (typeof p === 'string') list.push(p)
  } catch (_) {}

  const root = path.resolve(__dirname, '..', '..', '..', 'node_modules', '.pnpm')
  try {
    for (const dir of fs.readdirSync(root)) {
      if (!dir.startsWith('electron@')) continue
      const exe = path.join(root, dir, 'node_modules', 'electron', 'dist', 'electron.exe')
      list.push(exe)
    }
  } catch (_) {}
  return list
}

function resolveElectron() {
  for (const p of candidates()) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch (_) {}
  }
  throw new Error('找不到可用的 electron 可执行文件，请执行 pnpm install --config.dangerouslyAllowAllBuilds=true')
}

module.exports = { resolveElectron }
