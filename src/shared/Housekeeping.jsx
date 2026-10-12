import { useMemo, useState } from 'react'
import { useConfirm } from './ConfirmDialog'
import { formatRemain, useNow } from './Countdown'
import { manilaTodayIso } from './MonthCalendar'
import { stayStartLabel } from '../lib/format'

const STATES = [
  { id: 'occupied', label: 'Occupied', hint: 'Guests inside' },
  { id: 'reserved', label: 'Reserved', hint: 'Booked, not arrived' },
  { id: 'cleaning', label: 'Cleaning', hint: 'Being turned over' },
  { id: 'available', label: 'Available', hint: 'Ready for guests' },
]
const HELD = ['confirmed', 'awaiting_downpayment']
const TURNAROUND_MS = 25 * 60 * 1000

/**
 * Rooms a guest has booked but not arrived for yet. The room row itself stays
 * "available" in the database until check-in (which flips it to occupied), so
 * "reserved" is read from the bookings: the nearest upcoming one per room.
 */
export function reservedRooms(bookings = []) {
  const today = manilaTodayIso()
  const map = new Map()
  for (const booking of bookings) {
    if (!HELD.includes(booking.status) || booking.stay_date < today) continue
    for (const row of booking.booking_rooms || []) {
      const current = map.get(row.room_unit_id)
      if (!current || booking.stay_date < current.stay_date) map.set(row.room_unit_id, booking)
    }
  }
  return map
}

/** What the room should read as right now: its own status, or "reserved". */
export function roomState(room, reserved) {
  return room.status === 'available' && reserved.has(room.id) ? 'reserved' : room.status
}

function arrivalLabel(booking) {
  const time = stayStartLabel(booking)
  if (booking.stay_date === manilaTodayIso()) return `Today · ${time}`
  const date = new Date(`${booking.stay_date}T00:00:00`)
  return `${date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} · ${time}`
}

// Shared by Resort Operations and the Front Desk, so a receptionist can cover
// housekeeping when no operations staff is on shift.
export default function Housekeeping({ rooms, bookings = [], busy, onChangeStatus, onOccupy }) {
  const confirm = useConfirm()
  // The room whose "mark occupied" reason is being typed, if any.
  const [draft, setDraft] = useState(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const now = useNow()
  const reserved = useMemo(() => reservedRooms(bookings), [bookings])

  async function changeRoom(room, status, done) {
    const title = `${room.rooms?.name || 'Room'} ${room.name}`
    const prompts = {
      cleaning: { title: 'Start cleaning', message: `Start cleaning ${title}?`, confirmLabel: 'Start cleaning' },
      available: { title: 'Mark ready', message: `Mark ${title} as available?`, confirmLabel: 'Mark ready' },
    }
    const ok = await confirm(prompts[status])
    if (!ok) return
    await onChangeStatus(room.id, status, `${title} · ${done}.`)
  }

  async function occupy(room) {
    const reason = draft.reason.trim()
    if (!reason) return
    const saved = await onOccupy(room, reason)
    if (saved !== false) setDraft(null)
  }

  // Each room with the state it should show and the booking behind it.
  const board = useMemo(
    () =>
      rooms.map((room) => {
        const state = roomState(room, reserved)
        const stay =
          state === 'reserved' ? reserved.get(room.id) : bookings.find((item) => item.id === room.current_booking_id)
        return { room, state, stay: stay || null }
      }),
    [rooms, bookings, reserved],
  )

  const counts = Object.fromEntries(STATES.map((item) => [item.id, board.filter((row) => row.state === item.id).length]))
  const needle = query.trim().toLowerCase()
  const visible = board.filter(({ room, state, stay }) => {
    if (filter !== 'all' && state !== filter) return false
    if (!needle) return true
    return `${room.rooms?.name || ''} ${room.name} ${state} ${stay?.guest_name || ''} ${stay?.reference || ''}`
      .toLowerCase()
      .includes(needle)
  })

  // One section per building, in the resort's own order.
  const groups = useMemo(() => {
    const map = new Map()
    for (const row of visible) {
      const key = row.room.rooms?.name || 'Rooms'
      if (!map.has(key)) map.set(key, { name: key, order: row.room.rooms?.sort_order ?? 99, rows: [] })
      map.get(key).rows.push(row)
    }
    return [...map.values()].sort((left, right) => left.order - right.order)
  }, [visible])

  function detail({ room, state, stay }) {
    if (state === 'occupied') {
      return { label: 'Checkout in', value: formatRemain(room.check_out_at, now) }
    }
    if (state === 'reserved') {
      return { label: 'Arrives', value: arrivalLabel(stay) }
    }
    if (state === 'cleaning') {
      const left = room.turnaround_until ? new Date(room.turnaround_until).getTime() - now : 0
      return {
        label: 'Ready in',
        value: formatRemain(room.turnaround_until, now),
        progress: Math.min(Math.max(1 - left / TURNAROUND_MS, 0), 1),
      }
    }
    return null
  }

  return (
    <div className="hk">
      <div className="hk-summary" role="tablist" aria-label="Filter rooms by status">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`hk-tab all ${filter === 'all' ? 'on' : ''}`}
          onClick={() => setFilter('all')}
        >
          <b>{rooms.length}</b>
          <span>All rooms</span>
          <small>Every building</small>
        </button>
        {STATES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={`hk-tab ${item.id} ${filter === item.id ? 'on' : ''}`}
            onClick={() => setFilter(filter === item.id ? 'all' : item.id)}
          >
            <b>{counts[item.id]}</b>
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>

      <div className="hk-toolbar">
        <input
          type="search"
          className="hk-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search room, guest or booking ID"
          aria-label="Search rooms"
        />
        <span className="hk-count">
          Showing {visible.length} of {rooms.length}
        </span>
      </div>

      {rooms.length === 0 ? (
        <div className="hk-grid">
          <div className="skeleton skeleton-card" style={{ minHeight: 120 }} />
          <div className="skeleton skeleton-card" style={{ minHeight: 120 }} />
          <div className="skeleton skeleton-card" style={{ minHeight: 120 }} />
        </div>
      ) : null}

      {rooms.length > 0 && visible.length === 0 ? (
        <div className="hk-empty">
          <b>{needle ? `Nothing matches "${query.trim()}"` : 'No rooms in this status right now'}</b>
          <button
            type="button"
            onClick={() => {
              setFilter('all')
              setQuery('')
            }}
          >
            Show all rooms
          </button>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.name} className="hk-group">
          <header>
            <h3>{group.name}</h3>
            <span>
              {group.rows.length} {group.rows.length === 1 ? 'room' : 'rooms'}
            </span>
          </header>
          <div className="hk-grid">
            {group.rows.map((row) => {
              const { room, state, stay } = row
              const info = detail(row)
              return (
                <article key={room.id} className={`hk-card ${state}`}>
                  <header>
                    <div>
                      <h4>{room.name}</h4>
                      <p className="meta">{room.capacity ? `Sleeps ${room.capacity}` : 'Camping tent'}</p>
                    </div>
                    <span className={`pill hk-state ${state}`}>{state}</span>
                  </header>

                  {room.under_repair ? <p className="hk-repair">Closed to new bookings · under repair</p> : null}
                  {stay ? (
                    <p className="hk-guest">
                      <b>{stay.guest_name}</b>
                      <span>
                        {stay.reference}
                        {state === 'reserved' && stay.status === 'awaiting_downpayment' ? ' · downpayment not paid yet' : ''}
                      </span>
                    </p>
                  ) : state === 'available' ? (
                    <p className="hk-guest idle">Ready for the next guest</p>
                  ) : state === 'occupied' && room.occupied_note ? (
                    <p className="hk-guest hk-reason">
                      <b>Marked occupied by staff</b>
                      <span>{room.occupied_note}</span>
                    </p>
                  ) : (
                    <p className="hk-guest idle">No booking attached</p>
                  )}

                  {info ? (
                    <div className="hk-timer">
                      <span>{info.label}</span>
                      <b>{info.value}</b>
                      {info.progress != null ? (
                        <i className="hk-progress" aria-hidden="true">
                          <i style={{ transform: `scaleX(${info.progress})` }} />
                        </i>
                      ) : null}
                    </div>
                  ) : null}

                  <footer>
                    {state === 'occupied' && (
                      <button type="button" disabled={Boolean(busy)} onClick={() => changeRoom(room, 'cleaning', 'cleaning started')}>
                        {busy === room.id ? 'Updating…' : 'Start cleaning'}
                      </button>
                    )}
                    {state === 'cleaning' && (
                      <button type="button" disabled={Boolean(busy)} onClick={() => changeRoom(room, 'available', 'marked ready')}>
                        {busy === room.id ? 'Updating…' : 'Mark ready now'}
                      </button>
                    )}
                    {state === 'reserved' && <small className="hk-auto">Turns occupied at check-in</small>}
                    {state === 'available' && onOccupy && draft?.id !== room.id && (
                      <button
                        type="button"
                        className="soft"
                        disabled={Boolean(busy)}
                        onClick={() => setDraft({ id: room.id, reason: '' })}
                      >
                        Mark occupied
                      </button>
                    )}
                  </footer>

                  {state === 'available' && draft?.id === room.id ? (
                    <form
                      className="hk-occupy"
                      onSubmit={(event) => {
                        event.preventDefault()
                        occupy(room)
                      }}
                    >
                      <label>
                        Why is this room being used?
                        <textarea
                          autoFocus
                          rows={2}
                          maxLength={200}
                          value={draft.reason}
                          onChange={(event) => setDraft({ id: room.id, reason: event.target.value })}
                          placeholder="Walk-in staying the night, owner's guests, maintenance crew"
                        />
                      </label>
                      <div>
                        <button type="submit" disabled={!draft.reason.trim() || Boolean(busy)}>
                          {busy === room.id ? 'Saving…' : 'Mark occupied'}
                        </button>
                        <button type="button" className="soft" onClick={() => setDraft(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
