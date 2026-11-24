const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')

const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const nsis = builderRequire('app-builder-lib/out/targets/nsis/nsisUtil.js')
const originalTemplate = path.join(nsis.nsisTemplatesDir, 'multiUser.nsh')
const template = fs.readFileSync(originalTemplate, 'utf8')

// The first-install shell folder probe can crash System.dll (electron-builder #8536).
// Keep the existing LocalAppData default, registered install paths and /D overrides.
const shellFolderProbe = /^ {6}System::Store S\r?\n[\s\S]*?^ {6}System::Store L\r?\n/m
if (!shellFolderProbe.test(template)) {
  throw new Error('Review the NSIS first-install workaround against the installed electron-builder version')
}

const tempRoot = fs.realpathSync(os.tmpdir())
const templates = fs.mkdtempSync(path.join(tempRoot, 'haust-nsis-'))
process.on('exit', () => {
  if (path.dirname(templates) === tempRoot) fs.rmSync(templates, { recursive: true, force: true })
})
fs.cpSync(nsis.nsisTemplatesDir, templates, { recursive: true })
fs.writeFileSync(path.join(templates, 'multiUser.nsh'), template.replace(shellFolderProbe, ''))
nsis.nsisTemplatesDir = templates

process.argv[1] = builderRequire.resolve('./cli.js')
require(process.argv[1])
