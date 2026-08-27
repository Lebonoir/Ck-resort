import { useEffect, useState } from 'react'
import { ActionToast, RoleLayout, Stat } from '../shared/RoleLayout'
import RentalDispatch from '../shared/RentalDispatch'
import {
  dispatchRental,
  getCatalog,
  listBookings,
  listDispatches,
  listRoomUnits,
  returnRental,
  deleteReturnedDispatch,
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
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')

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

  async function changeRoom(id, status, label) {
    setError('')
    setSaved('')
    setBusy(id)
    try {
      await setRoomStatus(id, status)
      await reload()
      setSaved(label)
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function handleDispatch(payload) {
    setError('')
    setSaved('')
    setBusy('dispatch')
    try {
      await dispatchRental(payload.guestId, payload.itemId, payload.qty)
      await reload()
      setSaved('Rental logged as out.')
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function handleReturn(id) {
    setError('')
    setSaved('')
    setBusy(`return:${id}`)
    try {
      await returnRental(id)
      await reload()
      setSaved('Rental marked returned.')
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }
  const occupied = rooms.filter((room) => room.status === 'occupied').length
  const cleaning = rooms.filter((room) => room.status === 'cleaning').length
  const ready = rooms.filter((room) => room.status === 'available').length
  const inside = bookings.filter((item) => item.status === 'checked_in')
  const visible = rooms.filter((room) => (filter === 'All' ? true : room.status === filter.toLowerCase()))

  return (
    <RoleLayout roleId="staff" name={session.name} nav={NAV} active={active} onNav={setActive} onSignOut={onSignOut}>
      <ActionToast
        busy={Boolean(busy)}
        tone={error ? 'error' : 'ok'}
        message={
          busy === 'dispatch'
            ? 'Logging rental…'
            : String(busy).startsWith('return:')
              ? 'Marking returned…'
              : busy
                ? 'Updating room…'
                : error || saved
        }
      />
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
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => changeRoom(room.id, 'cleaning', `${room.rooms?.name || 'Room'} ${room.name} · cleaning started.`)}
                    >
                      {busy === room.id ? 'Updating…' : 'Start cleaning'}
                    </button>
                  )}
                  {room.status === 'cleaning' && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => changeRoom(room.id, 'available', `${room.rooms?.name || 'Room'} ${room.name} · marked ready.`)}
                    >
                      {busy === room.id ? 'Updating…' : 'Mark ready'}
                    </button>
                  )}
                  {room.status === 'available' && (
                    <button
                      type="button"
                      className="soft"
                      disabled={Boolean(busy)}
                      onClick={() => changeRoom(room.id, 'occupied', `${room.rooms?.name || 'Room'} ${room.name} · marked occupied.`)}
                    >
                      {busy === room.id ? 'Updating…' : 'Mark occupied'}
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
          onDispatch={handleDispatch}
          onReturn={handleReturn}
          onDeleteReturned={async (id) => {
            setError('')
            setSaved('')
            setBusy(`delete:${id}`)
            try {
              await deleteReturnedDispatch(id)
              await reload()
              setSaved('Returned rental log removed.')
            } catch (err) {
              setError(rpcError(err))
            } finally {
              setBusy('')
            }
          }}
        />
      )}
    </RoleLayout>
  )
}
