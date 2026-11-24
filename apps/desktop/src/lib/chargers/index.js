/**
 * 充电桩采集入口（智惠充电）
 *
 * 纯 Node 实现：不 require electron、不开浏览器窗口、不用学校登录态，
 * 所以既能被主进程调用，也能被 scripts/parity-chargers.cjs 直接用 node 跑。
 */
const areas = require('./areas')
const zzsx = require('./zzsx')
const DEFAULT_RULES = require('./rules.json')

const COVERAGE_NOTE = '智惠充电仅覆盖生活区（菁园/嘉园/乾园/德园/小北门等），教学楼区域暂无桩位数据'

/**
 * 同一个楼栋会被平台拆成多个点位（嘉园4号楼 ×4、菁园1号楼 ×4），
 * 直接展示会刷出一堆同名卡片，所以按「区域 + 展示名」再聚合一次。
 */
function aggregate(points, rules) {
  const aliases = areas.getAreaAliases(rules)
  const byKey = new Map()

  for (const p of points) {
    const codes = (p.codes || []).filter(Boolean)
    const device = codes.join(',')
    const area = areas.canonicalArea(p.name, aliases)
    const display = areas.displayName(p.name, device, rules)
    const key = area + '\u0000' + display

    let row = byKey.get(key)
    if (!row) {
      row = {
        area,
        display,
        raw: p.name,
        devices: [],
        points: 0,
        total: 0,
        free: 0,
        charging: 0,
        distance: p.distance,
        error: null
      }
      byKey.set(key, row)
    }
    row.points += 1
    row.total += p.total || 0
    row.free += p.free || 0
    row.charging += p.charging || 0
    row.distance = Math.min(row.distance, p.distance)
    for (const c of codes) if (row.devices.indexOf(c) < 0) row.devices.push(c)
    if (row.raw !== p.name && row.raw.split(' / ').indexOf(p.name) < 0) row.raw += ' / ' + p.name
  }

  const rows = [...byKey.values()].map((r) => ({
    area: r.area,
    display: r.display,
    raw: r.raw,
    devices: r.devices.join(','),
    deviceCount: r.devices.length,
    points: r.points,
    total: r.total,
    free: r.free,
    charging: r.charging,
    distance: Math.round(r.distance),
    error: r.error
  }))

  // 空闲多的先看；同为 0 时按总容量和距离排
  rows.sort(
    (a, b) => b.free - a.free || b.total - a.total || a.distance - b.distance || a.display.localeCompare(b.display)
  )
  return rows
}

function summarize(rows) {
  const byArea = {}
  const totals = { points: 0, devices: 0, total: 0, free: 0 }
  for (const r of rows) {
    const a = (byArea[r.area] = byArea[r.area] || { points: 0, devices: 0, total: 0, free: 0 })
    a.points += r.points
    a.devices += r.deviceCount
    a.total += r.total
    a.free += r.free
    totals.points += r.points
    totals.devices += r.deviceCount
    totals.total += r.total
    totals.free += r.free
  }
  return { byArea, totals }
}

/**
 * @param {{rules?: object, timeoutMs?: number, retries?: number}} [opts]
 * @returns {Promise<object>} ChargerData
 */
async function collect(opts = {}) {
  const rules = opts.rules || DEFAULT_RULES
  const anchor = rules.anchor
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) {
    throw new Error('rules.json 缺少有效的锚点坐标（anchor.lat / anchor.lng）')
  }

  const fetched = await zzsx.fetchWithLadder(rules, anchor, opts)
  const points = zzsx.mergeDevices(zzsx.normalize(fetched.rows), Number(rules.merge_within_m) || 80)
  if (!points.length) {
    // 拿到 0 条不能当成功：调用方会据此回落缓存
    throw new Error('智惠充电没有返回任何点位（接口可能改版或 srcId 失效）')
  }

  const rows = aggregate(points, rules)
  const { byArea, totals } = summarize(rows)

  return {
    fetchedAt: new Date().toISOString(),
    anchor: { name: anchor.name, lat: anchor.lat, lng: anchor.lng },
    radius: fetched.radius,
    rawDevices: fetched.rows.length,
    rows,
    byArea,
    totals,
    coverageNote: COVERAGE_NOTE
  }
}

module.exports = { collect, aggregate, summarize, COVERAGE_NOTE, DEFAULT_RULES, API_URL: zzsx.API_URL }
