import { useEffect, useState } from 'react'
import { RoleLayout, Stat } from '../shared/RoleLayout'
import RentalDispatch from '../shared/RentalDispatch'
import {
  dispatchRental,
  getCatalog,
  listBookings,
  listDispatches,
  listRoomUnits,
  returnRental,
  setRoomStatus,
} from '../lib/api'
import { rpcError } from '../lib/format'
import './staff.css'

const NAV = ['Housekeeping', 'Rental dispatch']
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

export default function ResortOperationsStaff({ session, onSignOut }) {
  const [active, setActive] = useState('Housekeeping')
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('All')
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')

  async function reload() {
    const [units, nextBookings, nextCatalog, nextLogs] = await Promise.all([
      listRoomUnits(),
      listBookings(),
      getCatalog(),
      listDispatches(),
    ])
    setRooms(units)
    setBookings(nextBookings)
    setCatalog(nextCatalog)
    setLogs(nextLogs)
  }

  useEffect(() => {
    reload().catch((err) => setError(rpcError(err)))
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const occupied = rooms.filter((room) => room.status === 'occupied').length
  const cleaning = rooms.filter((room) => room.status === 'cleaning').length
  const ready = rooms.filter((room) => room.status === 'available').length
  const inside = bookings.filter((item) => item.status === 'checked_in')
  const visible = rooms.filter((room) => (filter === 'All' ? true : room.status === filter.toLowerCase()))

  return (
    <RoleLayout roleId="staff" name={session.name} nav={NAV} active={active} onNav={setActive} onSignOut={onSignOut}>
      {error ? <p className="flash error">{error}</p> : null}
      <div className="stats">
        <Stat label="Occupied" value={String(occupied)} hint="Live stays" />
        <Stat label="Cleaning" value={String(cleaning)} hint="Turnaround" />
        <Stat label="Available" value={String(ready)} hint="Ready to sell" />
        <Stat label="Rentals out" value={String(logs.filter((item) => item.status === 'out').length)} hint="Need return" />
      </div>

      {active === 'Housekeeping' && (
        <>
          <div className="hk-filters">
            {FILTERS.map((item) => (
              <button key={item} type="button" className={filter === item ? 'on' : ''} onClick={() => setFilter(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="hk-grid">
            {visible.map((room) => (
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
                  Guest: {bookings.find((item) => item.id === room.current_booking_id)?.guest_name || '—'}
                  <br />
                  {bookings.find((item) => item.id === room.current_booking_id)?.reference || 'No live booking'}
                </p>
                <div className="hk-timer">
                  <span>{room.status === 'available' ? 'Turnaround' : room.status === 'cleaning' ? 'Ready in' : 'Checkout in'}</span>
                  <b>
                    {room.status === 'available'
                      ? 'Open'
                      : formatRemain(room.status === 'cleaning' ? room.turnaround_until : room.check_out_at, now)}
                  </b>
                </div>
                <footer>
                  {room.status === 'occupied' && (
                    <button type="button" onClick={() => setRoomStatus(room.id, 'cleaning').then(reload).catch((err) => setError(rpcError(err)))}>
                      Start cleaning
                    </button>
                  )}
                  {room.status === 'cleaning' && (
                    <button type="button" onClick={() => setRoomStatus(room.id, 'available').then(reload).catch((err) => setError(rpcError(err)))}>
                      Mark ready
                    </button>
                  )}
                  {room.status === 'available' && (
                    <button type="button" className="soft" onClick={() => setRoomStatus(room.id, 'occupied').then(reload).catch((err) => setError(rpcError(err)))}>
                      Mark occupied
                    </button>
                  )}
                </footer>
              </article>
            ))}
          </div>
        </>
      )}

      {active === 'Rental dispatch' && (
        <RentalDispatch
          guests={inside}
          rentals={catalog?.rentals || []}
          logs={logs}
          onDispatch={async ({ guestId, itemId, qty }) => {
            await dispatchRental(guestId, itemId, qty)
            await reload()
          }}
          onReturn={async (id) => {
            await returnRental(id)
            await reload()
          }}
        />
      )}
    </RoleLayout>
  )
}
