// @ts-nocheck —— 从桌面端逐行移植的纯逻辑模块（解析/筛选），保持与桌面版一字不差。
// 移植方式：require → import，module.exports → export；逻辑本身没有改。
import { postJson } from '../http'


/**
 * 智惠充电采集器（公开接口，零鉴权）
 *
 * 参考实现：charge-watch/check_ports.py 的 fetch_raw / normalize /
 * dist_m / merge_devices / fetch_with_ladder。语义逐行对齐，改动请同步那边。
 */

const API_URL = 'https://app.zzsx.cn/wxConfig/nearEqui'
const REFERER = 'https://app.zzsx.cn/wx/'

const int = (v) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}
const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** 拉取半径内全部设备（自动分页）。 */
async function fetchRaw(rules, anchor, radius, opt = {}) {
  const limit = int(rules.limit) || 50
  const maxPages = int(rules.max_pages) || 10
  const reqOpt = {
    timeoutMs: opt.timeoutMs || int(rules.timeout_ms) || 12000,
    retries: opt.retries || int(rules.retries) || 3,
    headers: { Referer: REFERER }
  }
  const rows = []
  let count = 0
  for (let page = 1; page <= maxPages; page++) {
    const data = await postJson(
      API_URL,
      {
        longitude: anchor.lng,
        latitude: anchor.lat,
        srcId: int(rules.srcId) || 27,
        distance: Math.round(radius),
        page,
        limit
      },
      reqOpt
    )
    if (int(data && data.code) !== 200) {
      throw new Error('接口返回异常：' + JSON.stringify(data).slice(0, 200))
    }
    const chunk = (data && data.data) || []
    count = int(data && data.count)
    rows.push(...chunk)
    if (chunk.length < limit || rows.length >= count) break
  }
  return { rows, count }
}

/** 半径阶梯：默认 3000，空结果自动放大到 5km / 10km。 */
async function fetchWithLadder(rules, anchor, opt = {}) {
  const ladder =
    Array.isArray(rules.radius_ladder_m) && rules.radius_ladder_m.length
      ? rules.radius_ladder_m.map((x) => int(x)).filter((x) => x > 0)
      : [int(rules.radius_m) || 3000]
  let used = ladder[0]
  let out = { rows: [], count: 0 }
  for (const r of ladder) {
    out = await fetchRaw(rules, anchor, r, opt)
    used = r
    if (out.rows.length) break
  }
  return { rows: out.rows, count: out.count, radius: used }
}

/** 清洗：address 用 "-" 切成 点位名 / 明细。 */
function normalize(rows) {
  return (rows || []).map((r) => {
    const addr = String((r && r.address) || '').trim()
    const parts = addr.split('-')
    const name = (parts[0] || '').trim()
    const detail = parts.slice(1).join('-').trim()
    return {
      code: r && r.code,
      name: name || (r && r.code) || '未知点位',
      detail,
      address: addr,
      lat: num(r && r.lat),
      lng: num(r && r.lng),
      free: int(r && r.free),
      total: int(r && r.totalLines),
      charging: int(r && r.charging),
      distance: num(r && r.distance) == null ? 0 : num(r && r.distance)
    }
  })
}

/** 米：球面距离（haversine），对齐 Python 的 _dist_m。 */
function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000.0
  const rad = (d) => (d * Math.PI) / 180
  const dphi = rad(lat2 - lat1)
  const dlmb = rad(lng2 - lng1)
  const a =
    Math.sin(dphi / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dlmb / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * 同名且相距 withinM 内的多台设备合并成一个物理点位。
 * 单链聚类：相邻合并，这样 4 台设备相隔 80m 只要首尾相连也能成一点。
 */
function mergeDevices(devices, withinM) {
  const byName = new Map()
  for (const d of devices || []) {
    if (!byName.has(d.name)) byName.set(d.name, [])
    byName.get(d.name).push(d)
  }

  const merged = []
  for (const [name, items] of byName) {
    items.sort((a, b) => a.distance - b.distance)
    const clusters = []
    for (const it of items) {
      let joined = null
      for (const cl of clusters) {
        for (const ref of cl) {
          const linked =
            it.lat == null || ref.lat == null ? true : distM(ref.lat, ref.lng, it.lat, it.lng) <= withinM
          if (linked) {
            joined = cl
            break
          }
        }
        if (joined) break
      }
      if (joined) joined.push(it)
      else clusters.push([it])
    }

    for (const cl of clusters) {
      merged.push({
        name,
        detail: cl[0].detail,
        codes: cl.map((c) => c.code),
        devices: cl.length,
        free: cl.reduce((s, c) => s + c.free, 0),
        total: cl.reduce((s, c) => s + c.total, 0),
        charging: cl.reduce((s, c) => s + c.charging, 0),
        distance: Math.min(...cl.map((c) => c.distance)),
        lat: cl[0].lat,
        lng: cl[0].lng
      })
    }
  }
  // 有空位的排前面，其次按距离
  merged.sort((a, b) => (a.free > 0 ? 0 : 1) - (b.free > 0 ? 0 : 1) || a.distance - b.distance)
  return merged
}

export { fetchWithLadder, fetchRaw, normalize, mergeDevices, distM, API_URL }
