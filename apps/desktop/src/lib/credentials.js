const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

function file() {
  return path.join(app.getPath('userData'), 'cred.enc')
}

function available() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch (_) {
    return false
  }
}

function save(cred) {
  if (!available()) return false
  try {
    const buf = safeStorage.encryptString(JSON.stringify(cred))
    fs.writeFileSync(file(), buf, { mode: 0o600 })
    return true
  } catch (_) {
    return false
  }
}

function load() {
  if (!available()) return null
  try {
    const buf = fs.readFileSync(file())
    return JSON.parse(safeStorage.decryptString(buf))
  } catch (_) {
    return null
  }
}

function clear() {
  try {
    fs.unlinkSync(file())
    return true
  } catch (_) {
    return false
  }
}

module.exports = { save, load, clear, available, file }
