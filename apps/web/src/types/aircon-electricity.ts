export interface AirconRoom {
  campus: string
  areaId: string
  buildId?: string
  buildName: string
  levelId?: string
  roomVerify?: string
  roomName: string
}

export interface AirconRoomOption {
  id: string
  name: string
}

export type AirconRoomListQuery =
  | { stage: 'buildings'; areaId: string }
  | { stage: 'levels'; areaId: string; buildId: string }
  | { stage: 'rooms'; areaId: string; buildId: string; levelId: string }

export type AirconRoomListResult =
  | { status: 'ok'; options: AirconRoomOption[] }
  | { status: 'error'; message: string }

export interface AirconElectricityReading {
  room: AirconRoom
  balanceYuan: number | null
  remainingKwh: number | null
  quantityUnit?: string
  updatedAt: string | null
  fetchedAt: string
}

export type AirconElectricityResult =
  | { status: 'ok'; reading: AirconElectricityReading }
  | { status: 'room_required' }
  | { status: 'no_data' | 'query_failed'; room: AirconRoom; message?: string }

export interface AirconElectricityService {
  getRoom(): Promise<AirconRoom | null>
  saveRoom(room: AirconRoom | null): Promise<boolean>
  listRooms(query: AirconRoomListQuery): Promise<AirconRoomListResult>
  query(): Promise<AirconElectricityResult>
}
