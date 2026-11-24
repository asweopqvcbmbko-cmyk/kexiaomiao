import type {
  AirconElectricityResult, AirconElectricityService, AirconRoom, AirconRoomListQuery
} from '../../types/aircon-electricity'

const ROOM_KEY = 'haust.settings.aircon-room.v1'
const BASE = 'https://h5cloud.17wanxiao.com:18443/CloudPayment'
type Request = (url: string) => Promise<{ status: number; data: unknown }>

const field = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const validId = (id: string) => /^[a-z0-9-]{1,100}$/i.test(id)

function normalize(value: unknown): AirconRoom | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const campus = field(input.campus) || '河南科技大学'
  const areaId = field(input.areaId) || '1'
  const buildName = field(input.buildName) || field(input.building)
  const roomName = field(input.roomName) || field(input.room)
  const roomVerify = field(input.roomVerify) || field(input.roomverify)
  const buildId = field(input.buildId)
  const levelId = field(input.levelId)
  if (!buildName || !roomName || [campus, buildName, roomName].some(name => name.length > 100)) return null
  if (![areaId, ...[buildId, levelId, roomVerify].filter(Boolean)].every(validId)) return null
  return { campus, areaId, buildId: buildId || undefined, buildName, levelId: levelId || undefined, roomVerify: roomVerify || undefined, roomName }
}

function endpoint(path: 'getRoom.do' | 'getRoomState.do', params: Record<string, string>) {
  const url = new URL(BASE + '/user/' + path)
  url.search = new URLSearchParams({ payProId: '4620', schoolcode: '1007', businesstype: '2', ...params }).toString()
  return url.toString()
}

function errorMessage(payload: Record<string, unknown>, fallback: string) {
  return (field(payload.subMsg) || field(payload.returnmsg) || field(payload.msg) || fallback).slice(0, 160)
}

function decode(data: unknown): Record<string, unknown> {
  let value = data
  if (typeof data === 'string') {
    try { value = JSON.parse(data) } catch {
      // The server can send its error object as text with HTTP 200.
      const match = /^RspBaseVO\s*\[[\s\S]*?[,\[]\s*msg\s*=\s*([^\r\n]{1,160}?)(?=,\s*subCode\s*=|\]\s*$)/.exec(data.trim())
      return { msg: match?.[1]?.trim() || '电控服务返回了无法识别的响应' }
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function roomListUrl(query: AirconRoomListQuery) {
  const buildid = query.stage === 'buildings' ? '0' : query.buildId
  const levelid = query.stage === 'rooms' ? query.levelId : '0'
  if (![query.areaId, buildid, levelid].every(validId)) throw new Error('宿舍查询参数无效')
  const optype = { buildings: '2', levels: '3', rooms: '4' }[query.stage]
  return endpoint('getRoom.do', { optype, areaid: query.areaId, buildid, unitid: '0', levelid })
}

export function createAirconElectricityService(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  request: Request
): AirconElectricityService {
  function read(raw: string | null) {
    try { return normalize(JSON.parse(raw || 'null')) } catch { return null }
  }

  return {
    async getRoom() { return read(storage.getItem(ROOM_KEY)) },
    async saveRoom(value) {
      try {
        if (value === null) storage.removeItem(ROOM_KEY)
        else {
          const room = normalize(value)
          if (!room?.buildId || !room.levelId || !room.roomVerify) return false
          storage.setItem(ROOM_KEY, JSON.stringify(room))
        }
        return true
      } catch { return false }
    },
    async listRooms(query) {
      try {
        const { status, data } = await request(roomListUrl(query))
        const payload = decode(data)
        if (status !== 200 || payload.code !== 'SUCCESS' || !Array.isArray(payload.roomlist)) {
          return { status: 'error', message: errorMessage(payload, `宿舍列表读取失败（getRoom HTTP ${status}），请重试`) }
        }
        const unique = new Map<string, {id: string; name: string}>()
        for (const entry of payload.roomlist) {
          if (!entry || typeof entry !== 'object') continue
          const id = typeof entry.id === 'number' ? String(entry.id) : field(entry.id)
          const name = field(entry.name)
          if (validId(id) && name && !unique.has(id)) unique.set(id, { id, name })
        }
        if (payload.roomlist.length && !unique.size) return { status: 'error', message: '宿舍列表格式无法识别' }
        return { status: 'ok', options: [...unique.values()] }
      } catch (err) {
        const detail = err instanceof Error && err.message ? `（${err.message.slice(0, 80)}）` : ''
        return { status: 'error', message: `宿舍列表查询失败${detail}，请检查网络后重试` }
      }
    },
    async query(): Promise<AirconElectricityResult> {
      const raw = storage.getItem(ROOM_KEY)
      const room = read(raw)
      if (!room?.roomVerify) return { status: 'room_required' }
      try {
        const { status, data } = await request(endpoint('getRoomState.do', { roomverify: room.roomVerify }))
        const payload = decode(data)
        if (status !== 200 || String(payload.returncode) !== '100') {
          return { status: 'query_failed', room, message: errorMessage(payload, `剩余电量查询失败（getRoomState HTTP ${status}），请重试`) }
        }
        const quantity = typeof payload.quantity === 'number' ? String(payload.quantity) : field(payload.quantity)
        const unit = field(payload.quantityunit)
        const reading = /^-?\d+(?:\.\d+)?$/.test(quantity) ? Number(quantity) : NaN
        if (!Number.isFinite(reading) || !['度', 'kwh', '千瓦时'].includes(unit.toLowerCase())) {
          return { status: 'no_data', room, message: '电控服务未返回有效的电量读数' }
        }
        const description = field(payload.description)
        const canonical = description && description.length <= 100 ? { ...room, roomName: description } : room
        // A response for an older binding must not overwrite a new room selected in the meantime.
        try {
          if (canonical !== room && canonical.roomName !== room.roomName && storage.getItem(ROOM_KEY) === raw) {
            storage.setItem(ROOM_KEY, JSON.stringify(canonical))
          }
        } catch { /* The current reading is still usable if local storage is unavailable. */ }
        return { status: 'ok', reading: {
          room: canonical, balanceYuan: null, remainingKwh: reading, quantityUnit: unit,
          updatedAt: null, fetchedAt: new Date().toISOString()
        } }
      } catch (err) {
        const detail = err instanceof Error && err.message ? `（${err.message.slice(0, 80)}）` : ''
        return { status: 'query_failed', room, message: `剩余电量查询失败${detail}，请检查网络后重试` }
      }
    }
  }
}
