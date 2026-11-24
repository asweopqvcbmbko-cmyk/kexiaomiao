/**
 * 充电桩命名与区域归属
 * 逻辑对齐 charge-watch/check_ports.py 的 display_name / canonical_area。
 */

function cleanMap(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw || {})) {
    if (k.startsWith('_')) continue
    out[k] = v
  }
  return out
}

function getAreaAliases(rules) {
  return cleanMap((rules || {}).area_aliases)
}

/** 区域归属：按别名表顺序，首个「别名出现在原始名里」的胜出。 */
function canonicalArea(name, aliases) {
  const map = aliases || getAreaAliases(null)
  for (const [area, words] of Object.entries(map)) {
    if ((words || []).some((w) => w && (name || '').indexOf(w) >= 0)) return area
  }
  return '其他'
}

/** 把 "{1}{2}号楼" 套上正则分组（{0} 是整段匹配，{n} 是第 n 组）。 */
function applyFormat(fmt, whole, groups) {
  return String(fmt).replace(/\{(\d+)\}/g, (_m, i) => {
    const idx = Number(i)
    if (idx === 0) return whole
    const g = groups[idx - 1]
    return g == null ? '' : g
  })
}

/** 展示名：labels（设备号→名字）优先 → name_rules 正则 → 原名。 */
function displayName(rawName, deviceCodes, rules) {
  const labels = cleanMap((rules || {}).labels)
  for (const code of String(deviceCodes || '').split(',')) {
    const c = code.trim()
    if (c && labels[c]) return labels[c]
  }
  for (const rule of (rules || {}).name_rules || []) {
    if (!rule || !rule.pattern) continue
    let re
    try {
      re = new RegExp(rule.pattern)
    } catch (_) {
      continue
    }
    const m = re.exec(rawName || '')
    if (!m) continue
    return applyFormat(rule.format || '', m[0], m.slice(1))
  }
  return rawName || '未知点位'
}

module.exports = { canonicalArea, displayName, getAreaAliases, cleanMap }
