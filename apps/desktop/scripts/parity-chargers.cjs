#!/usr/bin/env node
/**
 * 充电桩采集「对拍」脚本：把 Node 采集器的结果和 charge-watch 的 Python
 * 参考实现逐点位比对，用来发现移植漂移（改了聚类/分页/命名规则时会红）。
 *
 * 用法：
 *   node apps/desktop/scripts/parity-chargers.cjs
 *   $env:HAUST_PY='C:\...\python.exe'; $env:CHARGE_WATCH_DIR='C:\...\charge-watch'; node ...
 *
 * 退出码：0 = 通过，1 = 不一致，2 = 环境缺失（跳过）
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')

const rules = require('../src/lib/chargers/rules.json')
const zzsx = require('../src/lib/chargers/zzsx')
const areas = require('../src/lib/chargers/areas')

function findPython() {
  const candidates = []
  if (process.env.HAUST_PY) candidates.push({ cmd: process.env.HAUST_PY, args: [] })
  candidates.push({ cmd: 'py', args: ['-3'] })
  candidates.push({ cmd: 'python', args: [] })
  for (const c of candidates) {
    const r = spawnSync(c.cmd, [...c.args, '-c', 'import sys;print(sys.version)'], { encoding: 'utf8' })
    if (r.status === 0) return c
  }
  return null
}

function findChargeWatch() {
  const candidates = []
  if (process.env.CHARGE_WATCH_DIR) candidates.push(process.env.CHARGE_WATCH_DIR)
  candidates.push(path.resolve(ROOT, '..', 'charge-watch'))
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'Documents', 'deepseek-harness', 'default-workspace', 'charge-watch'))
  }
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'check_ports.py'))) return c
  }
  return null
}

const skip = (msg) => {
  console.log('SKIP ' + msg)
  process.exit(2)
}

const python = findPython()
if (!python) skip('找不到 Python，设置 HAUST_PY 指向解释器后再跑（这是开发期对拍脚本，App 运行不需要它）')
const cw = findChargeWatch()
if (!cw) skip('找不到 charge-watch，设置 CHARGE_WATCH_DIR 指向含 check_ports.py 的目录')

// 1) Python 参考结果
const py = spawnSync(python.cmd, [...python.args, path.join(cw, 'check_ports.py'), '--source', 'zzsx', '--json', '--no-history'], {
  encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  maxBuffer: 8 * 1024 * 1024
})
if (py.status !== 0) skip('Python 采集失败：' + (py.stderr || '').slice(0, 400))
let pyData
try {
  pyData = JSON.parse(py.stdout)
} catch (e) {
  skip('Python 输出不是 JSON：' + String(py.stdout).slice(0, 200))
}
const pyPoints = pyData.points || []

// 2) Node 结果（与 Python 同样的管线：分页 → 清洗 → 聚类）
const asyncMain = async () => {
  const fetched = await zzsx.fetchWithLadder(rules, rules.anchor)
  const points = zzsx.mergeDevices(zzsx.normalize(fetched.rows), Number(rules.merge_within_m) || 80)

  const key = (codes) => [...codes].sort().join(',')
  const pyMap = new Map()
  for (const p of pyPoints) pyMap.set(key(p.codes || []), p)
  const jsMap = new Map()
  for (const p of points) jsMap.set(key(p.codes || []), p)

  const problems = []
  const info = []

  for (const k of pyMap.keys()) if (!jsMap.has(k)) problems.push('Node 缺少点位：' + k)
  for (const k of jsMap.keys()) if (!pyMap.has(k)) problems.push('Node 多出点位：' + k)

  let totalPy = 0
  let totalJs = 0
  let freePy = Number(pyData.free_lines) || 0
  let freeJs = 0

  for (const [k, p] of pyMap) {
    const n = jsMap.get(k)
    if (!n) continue
    totalPy += p.total
    totalJs += n.total
    freeJs += n.free
    if (p.total !== n.total) problems.push(`总路数不一致 ${k}: py=${p.total} node=${n.total}`)
    if (Math.abs(p.distance - n.distance) > 0.5) {
      problems.push(`距离不一致 ${k}: py=${p.distance} node=${n.distance}`)
    }
    if (p.name !== n.name) info.push(`原始名不同 ${k}: py=${p.name} | node=${n.name}`)
    const pyArea = areas.canonicalArea(p.name)
    const jsArea = areas.canonicalArea(n.name)
    if (pyArea !== jsArea) info.push(`区域判定不同 ${p.name}: py=${pyArea} node=${jsArea}（别名表已扩展，属预期）`)
  }

  // 实时空闲数会漂，只做粗校验
  const drift = Math.abs(freeJs - freePy)
  const driftLimit = 15

  console.log(`Python 点位 ${pyPoints.length} 个 / 总路数 ${totalPy} / 空闲 ${freePy}`)
  console.log(`Node   点位 ${points.length} 个 / 总路数 ${totalJs} / 空闲 ${freeJs}`)
  console.log(`空闲漂移 ${drift}（阈值 ${driftLimit}，两次抓取相隔几秒，实时数据本来就在跳）`)

  if (info.length) {
    console.log('--- 说明（不计失败）---')
    for (const line of info.slice(0, 20)) console.log('  ' + line)
  }
  if (drift > driftLimit) problems.push(`空闲数漂移过大：py=${freePy} node=${freeJs}`)
  if (totalPy !== totalJs) problems.push(`总路数不一致：py=${totalPy} node=${totalJs}`)

  if (problems.length) {
    console.log('--- 不一致 ---')
    for (const p of problems) console.log('  ✗ ' + p)
    process.exit(1)
  }
  console.log('✅ 对拍通过（点位集合 / 总路数 / 距离 全部一致，空闲在漂移阈值内）')
}

asyncMain().catch((e) => {
  console.error('对拍异常：' + (e && e.message))
  process.exit(1)
})
