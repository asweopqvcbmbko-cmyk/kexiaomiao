export interface DormRoom {
  areaId: string
  areaName: string
  buildId: string
  buildName: string
  roomId: string
  roomName: string
  displayName?: string
}

export interface DormRoomOption {
  id: string
  name: string
}

export type DormRoomListQuery =
  | { stage: 'areas' }
  | { stage: 'buildings'; areaId: string }
  | { stage: 'rooms'; areaId: string; buildId: string }

export type DormRoomListResult =
  | { status: 'ok'; options: DormRoomOption[] }
  | { status: 'error'; message: string; authRequired?: boolean }

export interface DormElectricityReading {
  room: DormRoom
  remainingKwh: number
  usedKwh: number | null
  quantityUnit: string
  fetchedAt: string
}

export type DormElectricityResult =
  | { status: 'ok'; reading: DormElectricityReading }
  | { status: 'room_required' }
  | { status: 'auth_required'; room?: DormRoom; message?: string }
  | { status: 'no_data' | 'query_failed'; room: DormRoom; message?: string }

export interface DormElectricityService {
  getRoom(): Promise<DormRoom | null>
  saveRoom(room: DormRoom | null): Promise<boolean>
  listRooms(query: DormRoomListQuery): Promise<DormRoomListResult>
  query(): Promise<DormElectricityResult>
  resetSession?(): void
}
