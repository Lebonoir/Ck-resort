import { useEffect, useState } from 'react'
import { ActionToast, RoleLayout, Stat } from '../shared/RoleLayout'
import RentalDispatch from '../shared/RentalDispatch'
import Housekeeping from '../shared/Housekeeping'
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

export default function ResortOperationsStaff({ session, onSignOut }) {
  const [active, setActive] = useState('Housekeeping')
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [logs, setLogs] = useState([])
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
        <Housekeeping rooms={rooms} bookings={bookings} busy={busy} onChangeStatus={changeRoom} />
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
