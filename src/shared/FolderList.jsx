import { useEffect, useState } from 'react'

export function monthLabel(key) {
  if (!key || key === 'unknown') return 'Undated'
  const [year, month] = key.split('-')
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
  })
}

export function monthKey(value) {
  if (!value) return 'unknown'
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function groupByMonth(items, getDate) {
  const map = new Map()
  for (const item of items) {
    const key = monthKey(getDate(item))
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return [...map.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([id, rows], index) => ({
      id,
      label: monthLabel(id),
      items: rows,
      defaultOpen: index === 0,
    }))
}

export function FolderList({ groups, renderItem, listClassName = 'list', empty = 'Nothing here yet.' }) {
  const visible = (groups || []).filter((group) => (group.items || []).length > 0)
  const ids = visible.map((group) => group.id).join('|')
  const [open, setOpen] = useState(() => new Set())

  useEffect(() => {
    setOpen((current) => {
      if (current.size) return current
      const seeded = visible.filter((group) => group.defaultOpen).map((group) => group.id)
      if (seeded.length) return new Set(seeded)
      return visible[0] ? new Set([visible[0].id]) : new Set()
    })
  }, [ids])

  function toggle(id) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!visible.length) {
    return <p className="note">{empty}</p>
  }

  return (
    <div className="folder-stack">
      {visible.length > 1 ? (
        <div className="folder-chips" role="tablist" aria-label="List folders">
          {visible.map((group) => (
            <button
              key={`chip-${group.id}`}
              type="button"
              className={open.has(group.id) ? 'on' : ''}
              onClick={() => toggle(group.id)}
            >
              {group.label}
              <span>{group.items.length}</span>
            </button>
          ))}
        </div>
      ) : null}
      {visible.map((group) => {
        const isOpen = open.has(group.id)
        return (
          <section key={group.id} className={`folder ${isOpen ? 'open' : ''}`}>
            <button type="button" className="folder-head" onClick={() => toggle(group.id)} aria-expanded={isOpen}>
              <span className="folder-caret" aria-hidden="true" />
              <b>{group.label}</b>
              <small>{group.items.length}</small>
            </button>
            <div className="folder-body">
              <ul className={listClassName}>{group.items.map((item) => renderItem(item, group))}</ul>
            </div>
          </section>
        )
      })}
    </div>
  )
}
