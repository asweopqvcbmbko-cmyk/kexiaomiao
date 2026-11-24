const https = require('node:https')

/**
 * 极简 POST 客户端（只用 node 内置 https，不引第三方库）。
 *
 * 为什么默认 insecure：app.zzsx.cn 的证书主机名对不上，Python 参考实现
 * 也是 `CERT_NONE`（check_ports.py 的 _SSL_CTX）。这里保持一致，否则
 * 换个网络环境就可能直接连不上。
 */
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ' +
  'MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN miniProgram'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function postJson(url, body, opt = {}) {
  const timeoutMs = opt.timeoutMs || 12000
  const retries = Math.max(1, opt.retries || 2)
  const headers = Object.assign(
    {
      'User-Agent': UA,
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json, text/plain, */*'
    },
    opt.headers || {}
  )
  const payload = Buffer.from(JSON.stringify(body), 'utf8')

  return new Promise((resolve, reject) => {
    let attempt = 0

    const once = () => {
      attempt += 1
      const u = new URL(url)
      const req = https.request(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          headers: Object.assign({ 'Content-Length': payload.length }, headers),
          // 对齐参考实现的 CERT_NONE
          rejectUnauthorized: opt.insecure === false,
          timeout: timeoutMs
        },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return fail(new Error(`HTTP ${res.statusCode} ${text.slice(0, 160)}`))
            }
            try {
              resolve(JSON.parse(text))
            } catch (err) {
              fail(new Error(`响应不是 JSON：${text.slice(0, 160)}`))
            }
          })
        }
      )
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', (err) => fail(err))
      req.write(payload)
      req.end()
    }

    const fail = (err) => {
      if (attempt < retries) {
        // 指数退避：1.2s / 2.4s …
        sleep(1200 * attempt).then(once)
        return
      }
      reject(new Error(`接口请求失败：${err.name}: ${err.message}`))
    }

    once()
  })
}

module.exports = { postJson, UA }
