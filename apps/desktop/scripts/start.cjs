const { spawn } = require('node:child_process')
const path = require('node:path')
const { resolveElectron } = require('./electron-path.cjs')

// ELECTRON_RUN_AS_NODE 会让 electron 以纯 Node 方式启动（app 未定义），必须剔除
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electron = resolveElectron()
const args = [path.join(__dirname, '..'), ...process.argv.slice(2)]

const child = spawn(electron, args, { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
