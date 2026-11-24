/**
 * 安卓侧的 HTTP：走 Capacitor 的原生请求（CapacitorHttp），绕开 WebView 的 CORS。
 *
 * 原生 HTTP 请求支持：
 *   - 可以手动带 Cookie 头
 *   - 手动跟重定向，并返回最终 URL（判断有没有被踢回登录页靠它）
 *   - 按 content-type 的 charset 解码（学习通部分页面是 gbk）
 *   - 失败重试 + 超时
 */
import { CapacitorHttp } from '@capacitor/core'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

/** 充电桩用的手机小程序 UA（与桌面版一致） */
const UA_MP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN miniProgram'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function decode(bytes: Uint8Array | null, text: string, contentType: string): string {
  const m = /charset=([\w-]+)/i.exec(contentType || '')
  const cs = (m ? m[1] : 'utf-8').toLowerCase().replace('gb2312', 'gbk')
  if (bytes) {
    try {
      return new TextDecoder(cs).decode(bytes)
    } catch (_) {}
  }
  return text
}

export type Res = { status: number; headers: Record<string, string>; body: string; url: string }

async function once(
  url: string,
  opt: {
    method?: string
    cookie?: string
    referer?: string
    headers?: Record<string, string>
    body?: unknown
    timeoutMs?: number
    userAgent?: string | null
    onResponse?: (response: Res, requestedUrl: string) => void
  }
): Promise<Res> {
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(opt.headers || {})
  }
  if (opt.userAgent !== null) headers['User-Agent'] = opt.userAgent || UA
  if (opt.cookie) headers['Cookie'] = opt.cookie
  if (opt.referer) headers['Referer'] = opt.referer

  const timeout = opt.timeoutMs || 15000
  const res = await CapacitorHttp.request({
    url,
    method: (opt.method || 'GET') as any,
    headers,
    data: opt.body as any,
    responseType: 'arraybuffer' as any,
    disableRedirects: true,
    connectTimeout: timeout,
    readTimeout: timeout
  })

  const lower: Record<string, string> = {}
  Object.keys(res.headers || {}).forEach((k) => {
    lower[k.toLowerCase()] = String((res.headers as any)[k])
  })
  const raw = (res as any).data
  let bytes: Uint8Array | null = null
  let text = ''
  if (typeof raw === 'string') {
    // Android 端 arraybuffer 返回 base64 字符串；text 场景直接是正文
    if (res.status >= 200 && res.status < 300) {
      try {
        bytes = b64ToBytes(raw)
      } catch (_) {
        text = raw
      }
    } else {
      text = raw
    }
  } else if (raw) {
    text = JSON.stringify(raw)
  }
  return {
    status: res.status,
    headers: lower,
    body: decode(bytes, text, lower['content-type'] || ''),
    url: (res as any).url || url
  }
}

/** GET，自己跟重定向（要拿最终 URL 才能判断有没有被踢回登录页） */
export async function get(
  url: string,
  opt: {
    method?: string
    cookie?: string | ((url: string) => Promise<string>)
    referer?: string
    headers?: Record<string, string>
    body?: unknown
    timeoutMs?: number
    userAgent?: string | null
    onResponse?: (response: Res, requestedUrl: string) => void
    retries?: number
  } = {}
): Promise<Res> {
  const retries = Math.max(1, opt.retries || 2)
  let lastErr: any = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let current = url
      let o = { ...opt }
      let res: Res | null = null
      for (let hop = 0; hop < 6; hop++) {
        const cookie = typeof o.cookie === 'function'
          ? await o.cookie(current)
          : new URL(current).origin === new URL(url).origin ? o.cookie : undefined
        res = await once(current, { ...o, cookie })
        o.onResponse?.(res, current)
        const loc = res.headers['location']
        const isRedirect = res.status >= 300 && res.status < 400 && loc
        if (!isRedirect) break
        current = new URL(loc, current).toString()
        o = { ...o, referer: undefined }
      }
      return res as Res
    } catch (err) {
      lastErr = err
      if (attempt < retries) await sleep(600 * attempt)
    }
  }
  throw new Error('请求失败：' + (lastErr && lastErr.message ? lastErr.message : String(lastErr)))
}

/** 充电桩的 JSON POST（小程序 UA，超时/重试与桌面版一致） */
export async function postJson(
  url: string,
  body: unknown,
  opt: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {}
): Promise<any> {
  const retries = Math.max(1, opt.retries || 2)
  const timeoutMs = opt.timeoutMs || 12000
  const headers = {
    'User-Agent': UA_MP,
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    ...(opt.headers || {})
  }
  let lastErr: any = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await CapacitorHttp.request({
        url,
        method: 'POST',
        headers,
        data: body,
        responseType: 'json',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      })
      const d = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
      return d
    } catch (err) {
      lastErr = err
      if (attempt < retries) await sleep(600 * attempt)
    }
  }
  throw new Error('请求失败：' + (lastErr && lastErr.message ? lastErr.message : String(lastErr)))
}
