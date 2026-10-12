import { useEffect, useState } from 'react'
import { ActionToast, RoleLayout, Stat } from '../shared/RoleLayout'
import Housekeeping, { reservedRooms, roomState } from '../shared/Housekeeping'
import SupplyLog from '../shared/SupplyLog'
import UtilityMonitor from '../shared/UtilityMonitor'
import DamageReports from '../shared/DamageReports'
import { useLiveData } from '../shared/useLiveData'
import { listBookings, listRoomUnits, occupyRoom, setRoomStatus } from '../lib/api'
import { rpcError } from '../lib/format'
import './staff.css'

const NAV = [
  { section: 'Operations', items: ['Housekeeping'] },
  { section: 'Reports', items: ['Supplies', 'Utility monitoring', 'Damage reports'] },
]

export default function ResortOperationsStaff({ session, onSignOut }) {
  const [active, setActive] = useState('Housekeeping')
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')

  async function reload() {
    const [units, nextBookings] = await Promise.all([listRoomUnits(), listBookings()])
    setRooms(units)
    setBookings(nextBookings)
  }

  useEffect(() => {
    reload().catch((err) => setError(rpcError(err)))
  }, [])

  // Turnaround timers finish server-side; this pulls the result in.
  useLiveData(() => reload().catch(() => {}), { channel: 'staff' })

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

async function occupyRoomByHand(room, reason) {
    const title = `${room.rooms?.name || 'Room'} ${room.name}`
    setError('')
    setSaved('')
    setBusy(room.id)
    try {
      await occupyRoom(room.id, reason)
      await reload()
      setSaved(`${title} · marked occupied.`)
      return true
    } catch (err) {
      setError(rpcError(err))
      return false
    } finally {
      setBusy('')
    }
  }

  const occupied = rooms.filter((room) => room.status === 'occupied').length
  const cleaning = rooms.filter((room) => room.status === 'cleaning').length
  const held = reservedRooms(bookings)
  const reserved = rooms.filter((room) => roomState(room, held) === 'reserved').length
  const ready = rooms.filter((room) => roomState(room, held) === 'available').length
  const inside = bookings.filter((item) => item.status === 'checked_in')

  return (
    <RoleLayout roleId="staff" name={session.name} nav={NAV} active={active} onNav={setActive} onSignOut={onSignOut}>
      <ActionToast
        busy={Boolean(busy)}
        tone={error ? 'error' : 'ok'}
        message={busy ? 'Updating room…' : error || saved}
      />
      <div className="stats">
        <Stat label="Occupied" value={String(occupied)} hint="Live stays" />
        <Stat label="Reserved" value={String(reserved)} hint="Booked, not arrived" />
        <Stat label="Cleaning" value={String(cleaning)} hint="Turnaround" />
        <Stat label="Available" value={String(ready)} hint="Ready to sell" />
      </div>

      {active === 'Housekeeping' && (
        <Housekeeping rooms={rooms} bookings={bookings} busy={busy} onChangeStatus={changeRoom} onOccupy={occupyRoomByHand} />
      )}

      {active === 'Supplies' && <SupplyLog guests={inside} onError={setError} onSaved={setSaved} />}

      {active === 'Utility monitoring' && <UtilityMonitor canFix onError={setError} onSaved={setSaved} />}

      {active === 'Damage reports' && (
        <DamageReports bookings={bookings} onError={setError} onSaved={setSaved} onChanged={reload} />
      )}

    </RoleLayout>
  )
}
