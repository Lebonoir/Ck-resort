import { useEffect, useState } from 'react'
import { useConfirm } from './ConfirmDialog'

const FILTERS = ['All', 'Occupied', 'Available', 'Cleaning']

function formatRemain(until, now = Date.now()) {
  if (!until) return '—'
  const ms = new Date(until).getTime() - now
  if (ms <= 0) return 'Due now'
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

// Shared by Resort Operations and the Front Desk, so a receptionist can cover
// housekeeping when no operations staff is on shift.
export default function Housekeeping({ rooms, bookings = [], busy, onChangeStatus }) {
  const confirm = useConfirm()
  const [filter, setFilter] = useState('All')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

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

  const visible = rooms.filter((room) => (filter === 'All' ? true : room.status === filter.toLowerCase()))

  return (
    <>
      <div className="hk-filters">
        {FILTERS.map((item) => (
          <button key={item} type="button" className={filter === item ? 'on' : ''} onClick={() => setFilter(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className="hk-grid">
        {visible.length === 0 ? <p className="meta">No rooms match that filter.</p> : null}
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
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      changeRoom(room.id, 'available', `${room.rooms?.name || 'Room'} ${room.name} · marked ready.`)
                    }
                  >
                    {busy === room.id ? 'Updating…' : 'Mark ready'}
                  </button>
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
