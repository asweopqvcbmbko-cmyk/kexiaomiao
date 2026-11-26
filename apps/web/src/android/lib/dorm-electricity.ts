import type {
  DormElectricityResult,
  DormElectricityService,
  DormRoom,
  DormRoomListQuery,
  DormRoomOption
} from '../../types/dorm-electricity'

export const DORM_ROOM_KEY = 'haust.settings.dorm-room.v1'
export const CWPAY_ORIGIN = 'https://cwpay.haust.edu.cn'
export const CWPAY_CAS_LOGIN_URL = `${CWPAY_ORIGIN}/xysf/CasLogin.aspx`
export const CWPAY_APP_REFERER = `${CWPAY_ORIGIN}/xysf/aAppPage/index.aspx?type=3`
const CSRF_URL = `${CWPAY_ORIGIN}/xysf/api/Token/Csrf`
const GET_OPTION_URL = `${CWPAY_ORIGIN}/xysf/api/user/ElecRoom/GetOption`
const GET_RECHARGE_INFO_URL = `${CWPAY_ORIGIN}/xysf/aAppPage/index.aspx/GetRechargeInfo`

export type DormHttpResponse = {
  status: number
  url?: string
  data: unknown
  error?: 'network' | 'timeout' | 'auth'
}

export type DormHttpClient = {
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<DormHttpResponse>
  ensureSession(): Promise<boolean>
  runTransaction?<T>(fn: () => Promise<T>): Promise<T>
}

const field = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')
const validId = (id: string) => /^[a-z0-9._-]{1,100}$/i.test(id) && id !== '-1'

export function normalizeDormRoom(value: unknown): DormRoom | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const areaId = field(input.areaId)
  const areaName = field(input.areaName)
  const buildId = field(input.buildId)
  const buildName = field(input.buildName)
  const roomId = field(input.roomId)
  const roomName = field(input.roomName)
  const displayName = field(input.displayName)
  if (!areaId || !buildId || !roomId || !areaName || !buildName || !roomName) return null
  if (![areaId, buildId, roomId].every(validId)) return null
  if ([areaName, buildName, roomName, displayName].some((s) => s.length > 120)) return null
  return {
    areaId,
    areaName,
    buildId,
    buildName,
    roomId,
    roomName,
    ...(displayName ? { displayName } : {})
  }
}

export function parseKwhNumber(raw: unknown): number | null {
  const cleaned = field(raw).replace(/度|kwh|千瓦时/gi, '').trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function decodeJson(data: unknown): unknown {
  if (typeof data !== 'string') return data
  const trimmed = data.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function isAuthBounce(res: DormHttpResponse, parsed: unknown): boolean {
  if (res.error === 'auth') return true
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) return true
  if (res.url && /login\.aspx|CasLogin\.aspx|cas\.haust\.edu\.cn/i.test(res.url)) return true
  if (typeof res.data === 'string' && /login\.aspx|统一身份认证|window\.location\.href|Object moved/i.test(res.data)) {
    return true
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const inner = (obj.d && typeof obj.d === 'object' ? obj.d : obj) as Record<string, unknown>
    if (field(inner.RetCode) === 'N' || field(inner.code) === '2000') return true
  }
  return false
}

export function parseDormOptions(raw: unknown): { ok: true; options: DormRoomOption[] } | { ok: false; auth?: boolean; message: string } {
  const parsed = decodeJson(raw)
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: '宿舍电费服务返回了无法识别的列表格式' }
  }
  const obj = parsed as Record<string, unknown>
  if (field(obj.RetCode) === 'N') {
    return { ok: false, auth: true, message: '统一支付平台登录已过期，请刷新重试' }
  }
  if (obj.IsSuccess !== true || !Array.isArray(obj.Content)) {
    return { ok: false, message: field(obj.RetMsg) || '宿舍选项读取失败，请重试' }
  }
  const unique = new Map<string, DormRoomOption>()
  for (const item of obj.Content) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = field(row.value ?? row.id)
    const name = field(row.label ?? row.name)
    if (!validId(id) || !name || name === '请选择' || unique.has(id)) continue
    unique.set(id, { id, name })
  }
  return { ok: true, options: [...unique.values()] }
}

export function parseDormRechargeInfo(
  raw: unknown,
  room: DormRoom
):
  | { ok: true; remainingKwh: number; usedKwh: number | null; displayName: string }
  | { ok: false; auth?: boolean; noData?: boolean; message: string } {
  const parsed = decodeJson(raw)
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: '统一支付平台返回了无法识别的响应' }
  }
  const envelope = parsed as Record<string, unknown>
  const model = (envelope.d && typeof envelope.d === 'object' ? envelope.d : envelope) as Record<string, unknown>
  const retCode = field(model.RetCode)
  if (retCode === 'N') {
    return { ok: false, auth: true, message: '统一支付平台登录已过期，请刷新重试' }
  }
  if (retCode !== 'T') {
    return { ok: false, message: field(model.RetMsg) || '宿舍电费查询失败，请重试' }
  }
  const content = model.Content && typeof model.Content === 'object' ? (model.Content as Record<string, unknown>) : null
  if (!content || content.Succ === false) {
    const infoMsg = field(content?.Info) || field(content?.PayInfo) || field(model.RetMsg) || '暂未查询到该房间的电费读数'
    return { ok: false, noData: true, message: infoMsg.replace(/<[^>]+>/g, '').trim() }
  }
  const third = content.CzThirdInfo && typeof content.CzThirdInfo === 'object'
    ? (content.CzThirdInfo as Record<string, unknown>)
    : null
  const remainingKwh = parseKwhNumber(third?.DepName)
  if (remainingKwh === null) {
    return { ok: false, noData: true, message: '电控系统未返回有效的剩余电量读数' }
  }
  const usedKwh = parseKwhNumber(third?.State)
  const displayName = field(third?.Czxm) || `${room.areaName}/${room.buildName}/${room.roomName}`
  return { ok: true, remainingKwh, usedKwh, displayName }
}

export function createDormElectricityService(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  client: DormHttpClient
): DormElectricityService {
  let csrfToken = ''

  function readStored(raw: string | null) {
    try {
      return normalizeDormRoom(JSON.parse(raw || 'null'))
    } catch {
      return null
    }
  }

  async function fetchCsrfToken(): Promise<
    | { ok: true; token: string }
    | { ok: false; authFailed: boolean; status: number }
  > {
    const res = await client.post(CSRF_URL, {}, { Referer: CWPAY_APP_REFERER })
    const parsed = decodeJson(res.data)
    if (isAuthBounce(res, parsed)) return { ok: false, authFailed: true, status: res.status || 401 }
    if (res.error === 'network' || res.error === 'timeout' || res.status === 0 || res.status >= 500) {
      return { ok: false, authFailed: false, status: res.status || 503 }
    }
    if (typeof parsed === 'string' && parsed.trim()) return { ok: true, token: parsed.trim() }
    if (typeof res.data === 'string') {
      const stripped = res.data.trim().replace(/^"+|"+$/g, '')
      if (stripped && stripped.length < 256 && !stripped.startsWith('<')) return { ok: true, token: stripped }
    }
    return { ok: false, authFailed: res.status === 401 || res.status === 403, status: res.status || 500 }
  }

  async function postAuthed(url: string, body: unknown): Promise<{ res: DormHttpResponse; authFailed: boolean }> {
    const execute = async () => {
      const runOnce = async () => {
        if (!csrfToken) {
          const tok = await fetchCsrfToken()
          if (!tok.ok) {
            return { res: { status: tok.status, data: '' }, authFailed: tok.authFailed }
          }
          csrfToken = tok.token
        }
        const res = await client.post(url, body, {
          Referer: CWPAY_APP_REFERER,
          'x-csrfToken': csrfToken
        })
        const parsed = decodeJson(res.data)
        if (isAuthBounce(res, parsed)) {
          csrfToken = ''
          return { res, authFailed: true }
        }
        return { res, authFailed: false }
      }

      let attempt = await runOnce()
      if (!attempt.authFailed) return attempt
      const ok = await client.ensureSession().catch(() => false)
      if (!ok) return attempt
      csrfToken = ''
      attempt = await runOnce()
      return attempt
    }

    return client.runTransaction ? client.runTransaction(execute) : execute()
  }

  return {
    resetSession() {
      csrfToken = ''
    },

    async getRoom() {
      return readStored(storage.getItem(DORM_ROOM_KEY))
    },

    async saveRoom(value) {
      try {
        if (value === null) {
          storage.removeItem(DORM_ROOM_KEY)
        } else {
          const room = normalizeDormRoom(value)
          if (!room) return false
          storage.setItem(DORM_ROOM_KEY, JSON.stringify(room))
        }
        return true
      } catch {
        return false
      }
    },

    async listRooms(query: DormRoomListQuery) {
      try {
        const key = query.stage === 'areas' ? 'area' : query.stage === 'buildings' ? 'build' : 'room'
        const option = {
          areaid: query.stage === 'areas' ? '-1' : query.areaId,
          buildid: query.stage === 'rooms' ? query.buildId : '-1',
          roomid: '-1',
          IsLxr: false,
          IsDefault: false,
          IsFirst: false
        }
        const { res, authFailed } = await postAuthed(GET_OPTION_URL, { key, option })
        if (authFailed) {
          return { status: 'error', authRequired: true, message: '请先登录教务统一身份认证，再绑定宿舍电费房间' }
        }
        if (res.status < 200 || res.status >= 300) {
          return { status: 'error', message: `宿舍选项读取失败（HTTP ${res.status}），请重试` }
        }
        const parsed = parseDormOptions(res.data)
        if (!parsed.ok) {
          return { status: 'error', authRequired: parsed.auth, message: parsed.message }
        }
        return { status: 'ok', options: parsed.options }
      } catch (err) {
        const detail = err instanceof Error && err.message ? `（${err.message.slice(0, 80)}）` : ''
        return { status: 'error', message: `宿舍列表查询失败${detail}，请检查网络后重试` }
      }
    },

    async query(): Promise<DormElectricityResult> {
      const raw = storage.getItem(DORM_ROOM_KEY)
      const room = readStored(raw)
      if (!room) return { status: 'room_required' }
      try {
        const rybh = JSON.stringify({
          areaid: room.areaId,
          buildid: room.buildId,
          roomid: room.roomId,
          IsLxr: false,
          IsDefault: false,
          IsFirst: false
        })
        const { res, authFailed } = await postAuthed(GET_RECHARGE_INFO_URL, { rybh, category: 'ElecRoom' })
        if (authFailed) {
          return { status: 'auth_required', room, message: '请先登录教务账号，再查询宿舍电费' }
        }
        if (res.status < 200 || res.status >= 300) {
          return { status: 'query_failed', room, message: `宿舍电费查询失败（HTTP ${res.status}），请重试` }
        }
        const parsed = parseDormRechargeInfo(res.data, room)
        if (!parsed.ok) {
          if (parsed.auth) return { status: 'auth_required', room, message: parsed.message }
          return { status: parsed.noData ? 'no_data' : 'query_failed', room, message: parsed.message }
        }
        const canonical = parsed.displayName && parsed.displayName !== room.displayName
          ? { ...room, displayName: parsed.displayName }
          : room
        try {
          if (canonical !== room && storage.getItem(DORM_ROOM_KEY) === raw) {
            storage.setItem(DORM_ROOM_KEY, JSON.stringify(canonical))
          }
        } catch { /* ignore */ }
        return {
          status: 'ok',
          reading: {
            room: canonical,
            remainingKwh: parsed.remainingKwh,
            usedKwh: parsed.usedKwh,
            quantityUnit: '度',
            fetchedAt: new Date().toISOString()
          }
        }
      } catch (err) {
        const detail = err instanceof Error && err.message ? `（${err.message.slice(0, 80)}）` : ''
        return { status: 'query_failed', room, message: `宿舍电费查询失败${detail}，请检查网络后重试` }
      }
    }
  }
}
