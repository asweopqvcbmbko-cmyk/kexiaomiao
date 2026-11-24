import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { data } from '../api'
import type { AirconRoom, AirconRoomListQuery, AirconRoomListResult } from '../types/aircon-electricity'

function useRoomOptions(query: AirconRoomListQuery | null) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ query: AirconRoomListQuery; revision: number; result: AirconRoomListResult } | null>(null)
  useEffect(() => {
    if (!query) return
    let active = true
    void data.listAirconRooms(query).then(result => {
      if (active) setState({ query, revision, result })
    })
    return () => { active = false }
  }, [query, revision])
  const result = state?.query === query && state?.revision === revision ? state.result : null
  return {
    options: result?.status === 'ok' ? result.options : [],
    error: result?.status === 'error' ? result.message : '',
    loading: Boolean(query && !result),
    retry: () => setRevision(value => value + 1)
  }
}

export function DormBinding({ room, onSave }: {
  room: AirconRoom | null
  onSave: (room: AirconRoom) => Promise<boolean>
}) {
  const [areaId] = useState(room?.areaId || '1')
  const [buildId, setBuildId] = useState(room?.buildId || '')
  const [levelId, setLevelId] = useState(room?.levelId || '')
  const [roomVerify, setRoomVerify] = useState(room?.roomVerify || '')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const campus = room?.campus || '河南科技大学'

  const buildings = useRoomOptions(useMemo(() => ({ stage: 'buildings', areaId }), [areaId]))
  const building = buildings.options.find(option => option.id === buildId)
  const selectedBuildId = building?.id || ''
  const levels = useRoomOptions(useMemo(() => selectedBuildId
    ? { stage: 'levels', areaId, buildId: selectedBuildId } : null, [areaId, selectedBuildId]))
  const level = levels.options.find(option => option.id === levelId) ||
    (levels.options.length === 1 ? levels.options[0] : undefined)
  const selectedLevelId = level?.id || ''
  const rooms = useRoomOptions(useMemo(() => selectedBuildId && selectedLevelId
    ? { stage: 'rooms', areaId, buildId: selectedBuildId, levelId: selectedLevelId } : null,
  [areaId, selectedBuildId, selectedLevelId]))
  const selectedRoom = rooms.options.find(option => option.id === roomVerify)
  const keyword = search.normalize('NFKC').trim().toLowerCase()
  const filtered = rooms.options.filter(option => option.name.normalize('NFKC').toLowerCase().includes(keyword))
  const visibleRooms = selectedRoom && !filtered.includes(selectedRoom) ? [selectedRoom, ...filtered] : filtered
  const failed = [buildings, levels, rooms].find(result => result.error)
  const loading = buildings.loading || levels.loading || rooms.loading

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !building || !level || !selectedRoom) return
    setSaving(true)
    setSaveError('')
    try {
      if (!await onSave({
        campus, areaId, buildId: building.id, buildName: building.name,
        levelId: level.id, roomVerify: selectedRoom.id, roomName: selectedRoom.name
      })) setSaveError('宿舍未保存，请重试。')
    } catch {
      setSaveError('宿舍未保存，请重试。')
    } finally { setSaving(false) }
  }

  return (
    <form className="dorm-binding school-login" onSubmit={save}>
      <label>校区／园区<select value={areaId} disabled><option value={areaId}>{campus}</option></select></label>
      <label>楼栋
        <select value={selectedBuildId} disabled={saving || !buildings.options.length} required onChange={event => {
          setBuildId(event.target.value)
          setLevelId('')
          setRoomVerify('')
          setSearch('')
        }}>
          <option value="" disabled>{buildings.loading ? '正在加载楼栋…' : '选择楼栋'}</option>
          {buildings.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      <label>楼层
        <select value={selectedLevelId} disabled={saving || levels.options.length <= 1} required onChange={event => {
          setLevelId(event.target.value)
          setRoomVerify('')
          setSearch('')
        }}>
          <option value="" disabled>{levels.loading ? '正在加载楼层…' : '选择楼层'}</option>
          {levels.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      <label>搜索房间<input type="search" value={search} placeholder="输入房间号，例如 115"
        disabled={saving || !rooms.options.length} onChange={event => setSearch(event.target.value)} /></label>
      <label>房间
        <select value={selectedRoom?.id || ''} disabled={saving || !visibleRooms.length} required onChange={event => setRoomVerify(event.target.value)}>
          <option value="" disabled>{rooms.loading ? '正在加载房间…' : rooms.options.length && !filtered.length ? '没有匹配的房间' : '选择房间'}</option>
          {visibleRooms.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      {room?.roomName && !selectedRoom ? <small>当前绑定：{room.roomName}</small> : null}
      {failed ? (
        <>
          <p role="alert" className="bodycopy">{failed.error}</p>
          <button type="button" className="softbtn" onClick={failed.retry}>重新加载</button>
        </>
      ) : null}
      {saveError ? <p role="alert" className="bodycopy">{saveError}</p> : null}
      <button className="primary" disabled={saving || loading || !selectedRoom} type="submit">{saving ? '保存中…' : '保存宿舍'}</button>
    </form>
  )
}
