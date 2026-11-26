import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { data } from '../api'
import type { DormRoom, DormRoomListQuery, DormRoomListResult } from '../types/dorm-electricity'

function useDormOptions(query: DormRoomListQuery | null) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ query: DormRoomListQuery; revision: number; result: DormRoomListResult } | null>(null)
  useEffect(() => {
    if (!query) return
    let active = true
    void data.listDormRooms(query).then((result) => {
      if (active) setState({ query, revision, result })
    })
    return () => { active = false }
  }, [query, revision])
  const result = state?.query === query && state?.revision === revision ? state.result : null
  return {
    options: result?.status === 'ok' ? result.options : [],
    error: result?.status === 'error' ? result.message : '',
    authRequired: result?.status === 'error' ? !!result.authRequired : false,
    loading: Boolean(query && !result),
    retry: () => setRevision((value) => value + 1)
  }
}

export function DormElecBinding({ room, onSave, onLogin }: {
  room: DormRoom | null
  onSave: (room: DormRoom) => Promise<boolean>
  onLogin?: () => void
}) {
  const [areaId, setAreaId] = useState(room?.areaId || '')
  const [buildId, setBuildId] = useState(room?.buildId || '')
  const [roomId, setRoomId] = useState(room?.roomId || '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const areasQuery = useMemo<DormRoomListQuery>(() => ({ stage: 'areas' }), [])
  const areas = useDormOptions(areasQuery)
  const area = areas.options.find((option) => option.id === areaId)
  const selectedAreaId = area?.id || ''

  const buildingsQuery = useMemo<DormRoomListQuery | null>(
    () => (selectedAreaId ? { stage: 'buildings', areaId: selectedAreaId } : null),
    [selectedAreaId]
  )
  const buildings = useDormOptions(buildingsQuery)
  const building = buildings.options.find((option) => option.id === buildId)
  const selectedBuildId = building?.id || ''

  const roomsQuery = useMemo<DormRoomListQuery | null>(
    () => (selectedAreaId && selectedBuildId ? { stage: 'rooms', areaId: selectedAreaId, buildId: selectedBuildId } : null),
    [selectedAreaId, selectedBuildId]
  )
  const rooms = useDormOptions(roomsQuery)
  const selectedRoom = rooms.options.find((option) => option.id === roomId)

  const failed = [areas, buildings, rooms].find((result) => result.error)
  const loading = areas.loading || buildings.loading || rooms.loading

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !area || !building || !selectedRoom) return
    setSaving(true)
    setSaveError('')
    try {
      const ok = await onSave({
        areaId: area.id,
        areaName: area.name,
        buildId: building.id,
        buildName: building.name,
        roomId: selectedRoom.id,
        roomName: selectedRoom.name,
        displayName: `${area.name}/${building.name}/${selectedRoom.name}`
      })
      if (!ok) setSaveError('宿舍未保存，请重试。')
    } catch {
      setSaveError('宿舍未保存，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="dorm-binding school-login" onSubmit={save}>
      <label>
        园区（乾园 / 西苑 / 嘉园 / 菁园）
        <select
          value={selectedAreaId}
          disabled={saving || !areas.options.length}
          required
          onChange={(event) => {
            setAreaId(event.target.value)
            setBuildId('')
            setRoomId('')
          }}
        >
          <option value="" disabled>{areas.loading ? '正在加载园区…' : '选择园区'}</option>
          {areas.options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </label>
      <label>
        楼栋
        <select
          value={selectedBuildId}
          disabled={saving || !buildings.options.length}
          required
          onChange={(event) => {
            setBuildId(event.target.value)
            setRoomId('')
          }}
        >
          <option value="" disabled>{buildings.loading ? '正在加载楼栋…' : '选择楼栋'}</option>
          {buildings.options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </label>
      <label>
        房间
        <select
          value={selectedRoom?.id || ''}
          disabled={saving || !rooms.options.length}
          required
          onChange={(event) => setRoomId(event.target.value)}
        >
          <option value="" disabled>{rooms.loading ? '正在加载房间…' : '选择房间'}</option>
          {rooms.options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </label>
      {room?.displayName && !selectedRoom ? <small>当前绑定：{room.displayName}</small> : null}
      {failed ? (
        <>
          <p role="alert" className="bodycopy">{failed.error}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {failed.authRequired && onLogin ? (
              <button type="button" className="primary" onClick={onLogin}>去登录教务</button>
            ) : null}
            <button type="button" className="softbtn" onClick={failed.retry}>重新加载</button>
          </div>
        </>
      ) : null}
      {saveError ? <p role="alert" className="bodycopy">{saveError}</p> : null}
      <button className="primary" disabled={saving || loading || !selectedRoom} type="submit">
        {saving ? '保存中…' : '保存宿舍'}
      </button>
    </form>
  )
}
