import { useState } from 'react'
import { COLLEGES, COLLEGE_GROUPS, MAX_SUBSCRIBED_COLLEGES, sanitizeCollegeIds } from '../college-notices'
import { Icon } from '../icons'
import { Modal } from './ui'

export function CollegePickerModal({ selected, onSave, onClose }: {
  selected: string[]
  onSave: (ids: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(() => sanitizeCollegeIds(selected))
  const term = query.trim().toLowerCase()
  const matches = COLLEGES.filter(({ shortName, fullName, group, id }) =>
    [shortName, fullName, group, id].some((value) => value.toLowerCase().includes(term))
  )
  const atLimit = draft.length >= MAX_SUBSCRIBED_COLLEGES

  function toggle(id: string) {
    setDraft((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id)
      return current.length < MAX_SUBSCRIBED_COLLEGES ? [...current, id] : current
    })
  }

  return (
    <Modal title="订阅学院通知" onClose={onClose}>
      <div className="college-picker">
        <div className="notice-search">
          <span className="notice-search-icon" aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索学院或书院名称"
            placeholder="搜索学院或书院名称，如 计算机、软件、丽正…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="college-picker-summary">
          <span className="pill" role="status">已选 {draft.length} / {MAX_SUBSCRIBED_COLLEGES}</span>
          {draft.length > 0 && <button className="link" type="button" onClick={() => setDraft([])}>清空</button>}
        </div>
        {atLimit && <p className="college-picker-hint">已达订阅上限，取消一个选项后可继续选择。</p>}
        <div className="college-picker-list">
          {matches.length === 0 && <p className="college-picker-empty" role="status">没有匹配的学院或书院</p>}
          {COLLEGE_GROUPS.map((group) => {
            const colleges = matches.filter((college) => college.group === group)
            if (!colleges.length) return null
            return (
              <section className="college-group" key={group} aria-label={group}>
                <h3>{group}</h3>
                <div className="college-grid">
                  {colleges.map(({ id, fullName }) => {
                    const checked = draft.includes(id)
                    return (
                      <button
                        className="college-tile"
                        key={id}
                        type="button"
                        aria-pressed={checked}
                        disabled={atLimit && !checked}
                        onClick={() => toggle(id)}
                      >
                        <span>{fullName}</span>
                        {checked && <Icon name="check" />}
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
        <div className="college-picker-actions">
          <button className="softbtn" type="button" onClick={onClose}>取消</button>
          <button className="primary" type="button" onClick={() => onSave(draft)}>保存订阅</button>
        </div>
      </div>
    </Modal>
  )
}
