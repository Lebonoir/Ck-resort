import { useState } from 'react'
import { useConfirm } from './ConfirmDialog'
import { formatRemain, useNow } from './Countdown'

const FILTERS = ['All', 'Occupied', 'Available', 'Cleaning']

// Shared by Resort Operations and the Front Desk, so a receptionist can cover
// housekeeping when no operations staff is on shift.
export default function Housekeeping({ rooms, bookings = [], busy, onChangeStatus }) {
  const confirm = useConfirm()
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const now = useNow()

  async function changeRoom(id, status, label) {
    const roomTitle = label.split(' · ')[0]
    const prompts = {
      cleaning: { title: 'Start cleaning', message: `Start cleaning ${roomTitle}?`, confirmLabel: 'Start cleaning' },
      available: { title: 'Mark ready', message: `Mark ${roomTitle} as available?`, confirmLabel: 'Mark ready' },
      occupied: { title: 'Mark occupied', message: `Mark ${roomTitle} as occupied?`, confirmLabel: 'Mark occupied' },
    }
    const ok = await confirm(prompts[status] || { message: label, confirmLabel: 'Continue' })
    if (!ok) return
    await onChangeStatus(id, status, label)
  }

  // Filters as you type; the list itself stays live through useLiveData upstream.
  const needle = query.trim().toLowerCase()
  const visible = rooms.filter((room) => {
    if (filter !== 'All' && room.status !== filter.toLowerCase()) return false
    if (!needle) return true
    const stay = bookings.find((item) => item.id === room.current_booking_id)
    return `${room.rooms?.name || ''} ${room.name} ${room.status} ${stay?.guest_name || ''} ${stay?.reference || ''}`
      .toLowerCase()
      .includes(needle)
  })

  return (
    <>
      <div className="hk-toolbar">
        <input
          type="search"
          className="hk-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search room, guest or booking ID"
          aria-label="Search rooms"
        />
        <div className="hk-filters">
          {FILTERS.map((item) => (
            <button key={item} type="button" className={filter === item ? 'on' : ''} onClick={() => setFilter(item)}>
              {item}
            </button>
          ))}
        </div>
        <span className="hk-count">
          {visible.length} of {rooms.length} rooms
        </span>
      </div>
      <div className="hk-grid">
        {visible.length === 0 ? (
          <p className="meta">{needle ? `No rooms match "${query.trim()}".` : 'No rooms match that filter.'}</p>
        ) : null}
        {visible.map((room) => {
          const stay = bookings.find((item) => item.id === room.current_booking_id)
          return (
            <article key={room.id} className={`hk-card ${room.status}`}>
              <header>
                <div>
                  <h3>
                    {room.rooms?.name} · {room.name}
                  </h3>
                  <p className="meta">{room.capacity ? `${room.capacity} pax` : 'Camping tent'}</p>
                </div>
                <span className="pill">{room.status}</span>
              </header>
              <p className="meta">
                Guest: {stay?.guest_name || '—'}
                <br />
                {stay?.reference || 'No live booking'}
              </p>
              <div className="hk-timer">
                <span>
                  {room.status === 'available' ? 'Turnaround' : room.status === 'cleaning' ? 'Ready in' : 'Checkout in'}
                </span>
                <b>
                  {room.status === 'available'
                    ? 'Open'
                    : formatRemain(room.status === 'cleaning' ? room.turnaround_until : room.check_out_at, now)}
                </b>
              </div>
              <footer>
                {room.status === 'occupied' && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      changeRoom(room.id, 'cleaning', `${room.rooms?.name || 'Room'} ${room.name} · cleaning started.`)
                    }
                  >
                    {busy === room.id ? 'Updating…' : 'Start cleaning'}
                  </button>
                )}
                {room.status === 'cleaning' && (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        changeRoom(room.id, 'available', `${room.rooms?.name || 'Room'} ${room.name} · marked ready.`)
                      }
                    >
                      {busy === room.id ? 'Updating…' : 'Mark ready early'}
                    </button>
                    <small className="hk-auto">Frees itself when the timer ends</small>
                  </>
                )}
                {room.status === 'available' && (
                  <button
                    type="button"
                    className="soft"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      changeRoom(room.id, 'occupied', `${room.rooms?.name || 'Room'} ${room.name} · marked occupied.`)
                    }
                  >
                    {busy === room.id ? 'Updating…' : 'Mark occupied'}
                  </button>
                )}
              </footer>
            </article>
          )
        })}
      </div>
    </>
  )
}
