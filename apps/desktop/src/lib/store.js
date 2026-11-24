const fs = require('node:fs')
const path = require('node:path')

/** 极简本地缓存：每类数据一个 JSON 文件。
 *  目录用 userData/data —— 不能叫 cache，会和 Chromium 自己的缓存目录打架（文件会被清掉）。 */
class Store {
  constructor(userDataDir) {
    this.dir = path.join(userDataDir, 'data')
    fs.mkdirSync(this.dir, { recursive: true })
  }

  file(key) {
    return path.join(this.dir, key + '.json')
  }

  read(key) {
    try {
      return JSON.parse(fs.readFileSync(this.file(key), 'utf8'))
    } catch (_) {
      return null
    }
  }

  write(key, value) {
    const tmp = this.file(key) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, this.file(key))
    return value
  }

  clear() {
    for (const f of fs.readdirSync(this.dir)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(this.dir, f))
    }
  }
}

module.exports = { Store }
