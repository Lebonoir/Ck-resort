import { useEffect, useMemo, useState } from 'react'
import { ActionToast, RoleLayout, Stat } from '../shared/RoleLayout'
import Housekeeping from '../shared/Housekeeping'
import SupplyLog from '../shared/SupplyLog'
import UtilityMonitor from '../shared/UtilityMonitor'
import DamageReports from '../shared/DamageReports'
import BlacklistPanel from '../shared/BlacklistPanel'
import { useLiveData } from '../shared/useLiveData'
import { CountdownPill } from '../shared/Countdown'
import { FolderList, groupByMonth } from '../shared/FolderList'
import { useConfirm } from '../shared/ConfirmDialog'
import { includedPax } from '../lib/rooms'
import ReceiptPrinter from './ReceiptPrinter'
import { PAYMENT_TITLES, receiptLines } from './receipt'
import {
  addBookingAddon,
  addBookingRoom,
  addExtraHours,
  checkInBooking,
  checkOutBooking,
  collectPayment,
  createWalkIn,
  getCatalog,
  listBlacklist,
  listBookings,
  listRoomUnits,
  listUsers,
  occupyRoom,
  setHeadcount,
  setRoomStatus,
} from '../lib/api'
import {
  peso,
  prettyDate,
  prettyDateTime,
  rpcError,
  STATUS_LABELS,
  statusTone,
  stayEndsAt,
  stayStartLabel,
  stayWindowLabel,
  verifiedPaid,
} from '../lib/format'
import '../resort-operations-staff/staff.css'
import './front-desk.css'
import '../shared/ops.css'

const NAV = [
  { section: 'Front desk', items: ['POS & Check-in', 'Receipts', 'Blacklist'] },
  {
    section: 'Operations',
    items: ['Housekeeping', 'Supplies', 'Utility monitoring', 'Damage reports'],
  },
]

function Counter({ label, value, onChange, min = 0 }) {
  return (
    <label className="desk-counter">
      <span>{label}</span>
      <div>
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </button>
        <strong>{value}</strong>
        <button type="button" onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </label>
  )
}

export default function FrontDeskCashier({ session, onSignOut }) {
  const confirm = useConfirm()
  const [active, setActive] = useState('POS & Check-in')
  const [bookings, setBookings] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [rooms, setRooms] = useState([])
  const [blacklist, setBlacklist] = useState([])
  const [users, setUsers] = useState([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [walkIn, setWalkIn] = useState(false)
  const [queue, setQueue] = useState('')
  const [walkName, setWalkName] = useState('')
  const [walkType, setWalkType] = useState('day')
  const [actualPax, setActualPax] = useState(20)
  const [extraHours, setExtraHours] = useState(0)
  const [cash, setCash] = useState('')
  const [ewallet, setEwallet] = useState('')
  const [addonId, setAddonId] = useState('')
  const [addonQty, setAddonQty] = useState(1)
  const [roomPick, setRoomPick] = useState('')
  const [showRooms, setShowRooms] = useState(false)
  const [addRoomOpen, setAddRoomOpen] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [printing, setPrinting] = useState(null)

  async function reload() {
    const [nextBookings, nextCatalog, nextRooms, nextBlacklist, nextUsers] = await Promise.all([
      listBookings(),
      getCatalog(),
      listRoomUnits(),
      listBlacklist(),
      listUsers().catch(() => []),
    ])
    setBookings(nextBookings)
    setCatalog(nextCatalog)
    setRooms(nextRooms)
    setBlacklist(nextBlacklist)
    setUsers(nextUsers)
    return nextBookings
  }

  async function changeRoom(id, status, label) {
    setError('')
    setDone('')
    setBusy(id)
    try {
      await setRoomStatus(id, status)
      await reload()
      setDone(label)
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }


  async function occupyRoomByHand(room, reason) {
    const title = `${room.rooms?.name || 'Room'} ${room.name}`
    setError('')
    setDone('')
    setBusy(room.id)
    try {
      await occupyRoom(room.id, reason)
      await reload()
      setDone(`${title} · marked occupied.`)
      return true
    } catch (err) {
      setError(rpcError(err))
      return false
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    reload().catch((err) => setError(rpcError(err)))
  }, [])

  // Auto checkout, expiries and housekeeping land here without a refresh.
  useLiveData(() => reload().catch(() => {}), { channel: 'desk' })

  const booking = bookings.find((item) => item.id === selectedId)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

  // The lookup list shows one queue at a time; a search looks across all of them.
  function queueOf(item) {
    if (item.status === 'confirmed') return item.stay_date === today ? 'arriving' : item.stay_date > today ? 'upcoming' : 'history'
    if (item.status === 'checked_in' || item.status === 'checked_out') return 'inside'
    if (item.status === 'pending_approval' || item.status === 'awaiting_downpayment') return 'waiting'
    return 'history'
  }
  const queues = [
    { id: 'arriving', label: 'Arriving today', empty: 'Nobody is due to arrive today.' },
    { id: 'inside', label: 'On property', empty: 'No guests on property right now.' },
    { id: 'upcoming', label: 'Upcoming', empty: 'No confirmed bookings for later dates.' },
    { id: 'waiting', label: 'Unpaid holds', empty: 'No bookings are waiting on a downpayment.' },
    { id: 'history', label: 'History', empty: 'No past bookings yet.' },
  ].map((entry) => ({ ...entry, items: bookings.filter((item) => queueOf(item) === entry.id) }))
  const activeQueue = queues.find((entry) => entry.id === queue) || queues.find((entry) => entry.items.length) || queues[0]
  const needle = query.trim().toLowerCase()
  const list = needle
    ? bookings.filter((item) => `${item.reference} ${item.guest_name}`.toLowerCase().includes(needle))
    : activeQueue.items
  const bookingQueue = booking ? queueOf(booking) : ''

  // Follow the open ticket when an action moves it (check-in, check-out).
  useEffect(() => {
    if (bookingQueue) setQueue(bookingQueue)
  }, [selectedId, bookingQueue])
  // Arriving = confirmed and due today. Pending = confirmed for a later date, or still unpaid.
  const arriving = bookings.filter((item) => item.status === 'confirmed' && item.stay_date === today)
  const upcoming = bookings.filter((item) => item.status === 'confirmed' && item.stay_date > today)
  const awaiting = bookings.filter((item) =>
    ['pending_approval', 'awaiting_downpayment'].includes(item.status),
  )
  const pending = [...upcoming, ...awaiting]
  const inside = bookings.filter((item) => item.status === 'checked_in')
  const extraPaxRate = catalog?.rates.find((row) => row.key === (booking?.tour_type === 'overnight' ? 'extra_pax_overnight' : 'extra_pax_tour'))?.amount || 200
  const hourRate = catalog?.rates.find((row) => row.key === 'extra_hour')?.amount || 1000
  const activeBlocks = blacklist.filter((row) => !row.lifted_at)

  const preview = useMemo(() => {
    if (!booking) return null
    const checkedIn = ['checked_in', 'checked_out', 'completed'].includes(booking.status)
    const bill = Number(booking.override_amount ?? booking.total_amount)
    const paid = verifiedPaid(booking)
    const settledPax = Number(booking.settled_excess_pax || 0)
    const headcount = checkedIn && booking.status !== 'checked_in' ? booking.actual_pax || booking.pax : actualPax
    // The fee starts past what the package covers (30 on a day or night tour),
    // not past the number that was booked.
    const included = includedPax(booking, catalog)
    const excess = Math.max(headcount - included, settledPax, 0)
    const chargeRows = booking.booking_charges || []
    const charges = chargeRows.reduce((sum, row) => sum + Number(row.amount), 0)
    const unpaidCharges = chargeRows.filter((row) => !row.payment_id)
    const damageDue = unpaidCharges.filter((row) => row.kind === 'damage').reduce((sum, row) => sum + Number(row.amount), 0)
    const hours = checkedIn
      ? Number(booking.checkin_extra_hours || 0)
      : Math.max(extraHours, Number(booking.settled_extra_hours || 0))
    const hoursFee = hours * hourRate
    const excessFee = excess * extraPaxRate
    const total = bill + charges + excessFee + hoursFee
    const due = Math.max(total - paid, 0)
    // More arrivals than the booked rooms sleep: offer another room on any
    // package. Only an overnight stay has to take one before going further.
    const bookedUnitIds = (booking.booking_rooms || []).map((row) => row.room_unit_id)
    const bookedUnits = rooms.filter((unit) => bookedUnitIds.includes(unit.id))
    const capacity = bookedUnits.reduce((sum, unit) => sum + Number(unit.capacity || 0), 0)
    const overCapacity = bookedUnits.length > 0 ? Math.max(headcount - capacity, 0) : 0
    const roomRequired = overCapacity > 0 && booking.tour_type === 'overnight'
    const freeUnits = rooms.filter(
      (unit) =>
        unit.is_active !== false &&
        unit.status === 'available' &&
        !unit.under_repair &&
        !bookedUnitIds.includes(unit.id),
    )
    // Rooms that sleep all the extra guests come first, cheapest and tightest
    // fit leading; if none does, the biggest room goes first.
    const roomOptions = [...freeUnits].sort((left, right) => {
      const leftFits = Number(left.capacity) >= overCapacity
      const rightFits = Number(right.capacity) >= overCapacity
      if (leftFits !== rightFits) return leftFits ? -1 : 1
      if (!leftFits) return Number(right.capacity) - Number(left.capacity)
      return Number(left.rate) - Number(right.rate) || Number(left.capacity) - Number(right.capacity)
    })
    return {
      roomOptions,
      included,
      excess,
      charges,
      chargeRows,
      unpaidCharges,
      damageDue,
      excessFee,
      hoursFee,
      bill,
      total,
      due,
      paid,
      checkedIn,
      headcount,
      bookedUnits,
      capacity,
      overCapacity,
      roomRequired,
      freeUnits,
      headcountChanged: booking.status === 'checked_in' && headcount !== (booking.actual_pax || booking.pax),
      // Late arrivals on a checked-in stay: they pay before they come in.
      newArrivals:
        booking.status === 'checked_in' ? Math.max(headcount - (booking.actual_pax || booking.pax), 0) : 0,
    }
  }, [booking, actualPax, extraHours, extraPaxRate, hourRate, rooms])

  const flagged = useMemo(() => {
    if (!booking) return null
    const name = String(booking.guest_name || '').trim().toLowerCase()
    return (
      activeBlocks.find((row) => booking.guest_id && row.guest_id === booking.guest_id) ||
      activeBlocks.find((row) => name && String(row.guest_name || '').trim().toLowerCase() === name) ||
      null
    )
  }, [booking, activeBlocks])

  function pick(item) {
    setWalkIn(false)
    setSelectedId(item.id)
    setActualPax(item.actual_pax || item.pax)
    // Once checked in the counter means "hours to add", so it starts at zero.
    const checkedIn = ['checked_in', 'checked_out', 'completed'].includes(item.status)
    setExtraHours(checkedIn ? 0 : item.checkin_extra_hours || 0)
    setCash('')
    setEwallet('')
    setAddonQty(1)
    setRoomPick('')
    setReceipt(null)
    setDone('')
    setError('')
  }

  function printReceipt(row, payment, tender = null) {
    setPrinting({ booking: row, payment, tender })
  }

  // Shared wrapper for the small ticket edits (add-on, room, hours, headcount).
  async function ticketAction(key, task, message) {
    setError('')
    setDone('')
    setBusy(key)
    try {
      await task()
      const rows = await reload()
      const next = rows.find((item) => item.id === booking.id)
      if (next) setSelectedId(next.id)
      setDone(message)
      return true
    } catch (err) {
      setError(rpcError(err))
      return false
    } finally {
      setBusy('')
    }
  }

  async function loadWalkIn() {
    const ok = await confirm({
      title: 'Create walk-in',
      message: `Load a ${walkType} walk-in for ${walkName.trim()}? Full amount is due at the counter.`,
      confirmLabel: 'Load to POS',
    })
    if (!ok) return
    setError('')
    setDone('')
    setBusy('walkin')
    try {
      const created = await createWalkIn({
        guest_name: walkName,
        tour_type: walkType,
        // Same starting sizes as an online booking: a 30-pax tour, a 10-pax overnight.
        pax: walkType === 'overnight' ? 10 : walkType === 'event' ? 20 : 30,
        stay_date: new Date().toISOString().slice(0, 10),
        event_when: 'day',
      })
      const rows = await reload()
      const row = rows.find((item) => item.id === created.id) || created
      setWalkIn(false)
      setWalkName('')
      pick(row)
      setDone(`${row.guest_name} loaded to POS.`)
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  // One runner for the four money actions so each ends with the same receipt.
  async function settle(kind) {
    if (!booking || !preview) return
    const tender = { cash: Number(cash) || 0, ewallet: Number(ewallet) || 0 }
    const due = preview.due
    const prompts = {
      collect: {
        title: 'Collect payment',
        message: `Collect ${peso(due)} from ${booking.guest_name} (tendered ${peso(tender.cash + tender.ewallet)}) without checking in yet?`,
        confirmLabel: 'Collect only',
      },
      checkin: {
        title: due > 0 ? 'Collect & check in' : 'Check in',
        message:
          due > 0
            ? `Collect ${peso(due)} (tendered ${peso(tender.cash + tender.ewallet)}) and check in ${booking.guest_name} with ${actualPax} pax?`
            : `Check in ${booking.guest_name} with ${actualPax} pax? The bill is already settled.`,
        confirmLabel: due > 0 ? 'Collect & check in' : 'Check in',
      },
      admit: {
        title: 'Collect & let them in',
        message: `Collect ${peso(due)} (tendered ${peso(tender.cash + tender.ewallet)}) and let ${preview.newArrivals} more guest${preview.newArrivals === 1 ? '' : 's'} in? ${booking.guest_name}'s headcount becomes ${actualPax}.`,
        confirmLabel: 'Collect & let them in',
      },
      checkout: {
        title: booking.status === 'checked_out' ? 'Complete stay' : due > 0 ? 'Collect & check out' : 'Check out',
        message:
          due > 0
            ? `Collect ${peso(due)} (tendered ${peso(tender.cash + tender.ewallet)}) and ${booking.status === 'checked_out' ? 'complete' : 'check out'} ${booking.guest_name}?`
            : `Check out ${booking.guest_name}? Nothing is left to pay.`,
        confirmLabel: booking.status === 'checked_out' ? 'Complete stay' : 'Check out',
      },
    }
    if (kind === 'admit') {
      // Checked before the headcount is saved, so nobody is let in on a short payment.
      if (tender.cash + tender.ewallet + 0.009 < due) {
        setDone('')
        setError(`Payment is short. Collect ${peso(due)} before the extra guests come in.`)
        return
      }
      if (tender.cash + 0.009 < Math.min(preview.damageDue, due)) {
        setDone('')
        setError(`Damaged items are settled in cash. Cash needed: ${peso(Math.min(preview.damageDue, due))}.`)
        return
      }
    }
    const ok = await confirm(prompts[kind])
    if (!ok) return
    setError('')
    setDone('')
    setBusy(kind)
    try {
      let result
      if (kind === 'collect') {
        result = await collectPayment(booking.id, {
          cash: tender.cash,
          ewallet: tender.ewallet,
          actualPax: booking.status === 'confirmed' ? actualPax : null,
          extraHours: booking.status === 'confirmed' ? extraHours : null,
        })
      } else if (kind === 'admit') {
        await setHeadcount(booking.id, actualPax)
        result = await collectPayment(booking.id, { cash: tender.cash, ewallet: tender.ewallet })
      } else if (kind === 'checkin') {
        result = await checkInBooking(booking.id, {
          actualPax,
          extraHours,
          cash: tender.cash,
          ewallet: tender.ewallet,
        })
      } else {
        result = await checkOutBooking(booking.id, { cash: tender.cash, ewallet: tender.ewallet })
      }
      const status = result.booking?.status
      const label =
        kind === 'collect'
          ? 'Payment collected'
          : kind === 'admit'
            ? 'Extra guests paid and let in'
            : kind === 'checkin'
              ? 'Checked in'
            : status === 'completed'
              ? 'Stay completed'
              : 'Checked out'
      setDone(`${booking.guest_name} · ${label}. ${peso(result.due)} collected, change ${peso(result.change)}.`)
      setCash('')
      setEwallet('')
      const rows = await reload()
      const fresh = rows.find((item) => item.id === booking.id) || booking
      const payment = (fresh.payments || []).find((row) => row.id === result.payment_id)
      setReceipt(payment ? { booking: fresh, payment, tender: { ...tender, change: result.change } } : null)
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  const paidReceipts = bookings.flatMap((item) =>
    (item.payments || [])
      .filter((pay) => pay.status === 'paid')
      .map((pay) => ({ ...pay, reference: item.reference, guest_name: item.guest_name, booking: item })),
  )

  const addon = catalog?.rentals.find((item) => item.id === addonId) || catalog?.rentals[0]
  // Billiards is unlimited play: one flat charge, so it has no quantity.
  const addonSingle = addon?.slug === 'billiard'
  const addonCount = addonSingle ? 1 : addonQty
  const canEditBill = booking && ['confirmed', 'checked_in', 'checked_out'].includes(booking.status)
  const busyText = {
    collect: 'Collecting payment…',
    admit: 'Collecting payment…',
    checkin: 'Checking in…',
    checkout: 'Checking out…',
    walkin: 'Loading walk-in…',
    charge: 'Adding charge…',
    addon: 'Adding add-on…',
    room: 'Adding room…',
    hours: 'Adding extra hours…',
    headcount: 'Updating headcount…',
  }

  return (
    <RoleLayout roleId="front-desk" name={session.name} nav={NAV} active={active} onNav={setActive} onSignOut={onSignOut}>
      <ActionToast busy={Boolean(busy)} tone={error ? 'error' : 'ok'} message={busyText[busy] || error || done} />
      <div className="stats">
        <Stat label="Arriving today" value={String(arriving.length)} hint="Confirmed for today" />
        <Stat label="Pending" value={String(pending.length)} hint="Future & unpaid" />
        <Stat label="On property" value={String(inside.length)} hint="Checked in" />
        <Stat
          label="Open balance"
          value={peso(arriving.concat(inside).reduce((sum, item) => sum + Math.max(Number(item.override_amount ?? item.total_amount) - verifiedPaid(item), 0), 0))}
          hint="Remaining + extras"
        />
      </div>

      {active === 'POS & Check-in' && (
        <div className="desk-grid">
          <section className="desk-card">
            <div className="desk-search">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Booking ID or guest name"
                aria-label="Look up a booking"
              />
              <button type="button" className={`desk-walkin ${walkIn ? 'on' : ''}`} onClick={() => setWalkIn(true)}>
                New walk-in
              </button>
            </div>
            {needle ? (
              <p className="desk-note">
                {list.length} {list.length === 1 ? 'match' : 'matches'} across every list
              </p>
            ) : (
              <div className="desk-queues" role="tablist" aria-label="Booking lists">
                {queues.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={activeQueue.id === entry.id}
                    className={`${activeQueue.id === entry.id ? 'on' : ''} ${entry.items.length ? '' : 'none'}`}
                    onClick={() => setQueue(entry.id)}
                  >
                    {entry.label}
                    <span>{entry.items.length}</span>
                  </button>
                ))}
              </div>
            )}
            {list.length === 0 ? (
              <p className="desk-queue-empty">{needle ? 'No booking matches that search.' : activeQueue.empty}</p>
            ) : (
              <ul className="desk-queue">
                {list.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.id === selectedId && !walkIn ? 'on' : ''}
                      aria-current={item.id === selectedId && !walkIn}
                      onClick={() => pick(item)}
                    >
                      <span className="desk-queue-who">
                        <b>{item.guest_name}</b>
                        <small>
                          {item.reference} · {item.package_label}
                        </small>
                      </span>
                      <span className="desk-queue-when">
                        <span>
                          {prettyDate(item.stay_date)} · {stayStartLabel(item)}
                        </span>
                        <i className={`pill ${statusTone(item.status)}`}>
                          {item.status === 'awaiting_downpayment' ? 'Unpaid' : STATUS_LABELS[item.status] || item.status}
                        </i>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="desk-card ticket">
            {walkIn && (
              <div className="walk-form">
                <h3>Walk-in reservation</h3>
                <input value={walkName} onChange={(event) => setWalkName(event.target.value)} placeholder="Guest name" />
                <div className="chip-row tight">
                  {[
                    ['day', 'Day Tour'],
                    ['night', 'Night Tour'],
                    ['overnight', 'Overnight'],
                    ['event', 'Event'],
                  ].map(([id, label]) => (
                    <button key={id} type="button" className={walkType === id ? 'mini on' : 'mini'} onClick={() => setWalkType(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                {activeBlocks.some(
                  (row) => walkName.trim() && String(row.guest_name || '').trim().toLowerCase() === walkName.trim().toLowerCase(),
                ) ? (
                  <p className="ticket-warn">This name is on the blacklist. Check with the manager before loading the walk-in.</p>
                ) : null}
                <p className="desk-note">Full amount is due at the counter because no downpayment was collected yet.</p>
                <button type="button" className="desk-btn" disabled={!walkName.trim() || Boolean(busy)} onClick={loadWalkIn}>
                  {busy === 'walkin' ? 'Loading…' : 'Load walk-in to POS'}
                </button>
              </div>
            )}

            {!walkIn && !booking && (
              <p className="desk-note">Pick a booking from the list to count heads, add extras and collect payment.</p>
            )}

            {!walkIn && booking && preview && (
              <>
                <div className="ticket-head">
                  <div>
                    <p>{booking.reference}</p>
                    <h3>{booking.guest_name}</h3>
                    <small>
                      {booking.package_label} · {prettyDate(booking.stay_date)}
                    </small>
                  </div>
                  <span className="pill">{STATUS_LABELS[booking.status]}</span>
                </div>
                {flagged ? (
                  <p className="ticket-warn">
                    On the blacklist · {flagged.reason}. Check with the manager before going further.
                  </p>
                ) : null}
                <div className="ticket-arrival">
                  <span>Arrival</span>
                  <b>{stayStartLabel(booking)}</b>
                  <small>{stayWindowLabel(booking)}</small>
                </div>
                {booking.status === 'checked_in' ? (
                  <CountdownPill
                    until={stayEndsAt(booking)}
                    label="Checkout in"
                    doneLabel="Checking out automatically…"
                  />
                ) : null}

                {['confirmed', 'checked_in'].includes(booking.status) ? (
                  <div className="ticket-block">
                    <b>Headcount</b>
                    <Counter
                      label={booking.status === 'confirmed' ? 'Pax on arrival' : 'Pax on property'}
                      value={actualPax}
                      min={1}
                      onChange={setActualPax}
                    />
                    <p className="desk-note">
                      Booked for {booking.pax} pax · package covers {preview.included} · excess × {preview.excess} at{' '}
                      {peso(extraPaxRate)} each
                      {preview.bookedUnits.length
                        ? ` · rooms sleep ${preview.capacity} (${preview.bookedUnits.map((unit) => `${unit.rooms?.name || ''} ${unit.name}`.trim()).join(', ')})`
                        : ''}
                    </p>
                    {preview.overCapacity > 0 || addRoomOpen ? (
                      <>
                        {preview.overCapacity > 0 ? (
                          <p className="ticket-warn">
                            {preview.overCapacity} guest{preview.overCapacity === 1 ? '' : 's'} over the room capacity.{' '}
                            {preview.roomRequired
                              ? 'Add another room so everyone has a bed.'
                              : 'We suggest adding a room for them.'}{' '}
                            It is billed at the room rate on top of any excess pax fee.
                          </p>
                        ) : (
                          <p className="desk-note">Pick a free room to add. It is billed at the room rate.</p>
                        )}
                        {preview.roomOptions.length === 0 ? (
                          <p className="desk-note">No room is free right now. Mark a cleaned room as ready in Housekeeping first.</p>
                        ) : (
                          (() => {
                            const unitName = (unit) => `${unit.rooms?.name || ''} ${unit.name}`.trim()
                            const [recommended, ...others] = preview.roomOptions
                            const picked = preview.roomOptions.find((unit) => unit.id === roomPick) || recommended
                            const option = (unit, isRecommended) => {
                              const short = preview.overCapacity - Number(unit.capacity)
                              return (
                                <button
                                  key={unit.id}
                                  type="button"
                                  className={`room-option ${isRecommended ? 'recommended' : ''} ${picked.id === unit.id ? 'on' : ''}`}
                                  aria-pressed={picked.id === unit.id}
                                  onClick={() => setRoomPick(unit.id)}
                                >
                                  <span className="room-option-copy">
                                    {isRecommended ? <i>Recommended</i> : null}
                                    <b>{unitName(unit)}</b>
                                    <small>
                                      Sleeps {unit.capacity}
                                      {preview.overCapacity === 0
                                        ? ''
                                        : short > 0
                                          ? ` · ${short} still without a bed`
                                          : ` · covers the ${preview.overCapacity} extra`}
                                    </small>
                                  </span>
                                  <strong>{peso(unit.rate)}</strong>
                                </button>
                              )
                            }
                            return (
                              <div className="room-pick">
                                {option(recommended, true)}
                                {others.length ? (
                                  <>
                                    <button
                                      type="button"
                                      className="room-more"
                                      aria-expanded={showRooms}
                                      onClick={() => setShowRooms(!showRooms)}
                                    >
                                      {showRooms
                                        ? 'Hide other rooms'
                                        : `See ${others.length} other free room${others.length === 1 ? '' : 's'}`}
                                    </button>
                                    {showRooms ? (
                                      <div className="room-others">{others.map((unit) => option(unit, false))}</div>
                                    ) : null}
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  className="desk-btn"
                                  disabled={Boolean(busy)}
                                  onClick={async () => {
                                    const label = unitName(picked)
                                    const ok = await confirm({
                                      title: 'Add room',
                                      message: `Add ${label} (${peso(picked.rate)}) to ${booking.guest_name}'s bill?`,
                                      confirmLabel: 'Add room',
                                    })
                                    if (!ok) return
                                    const added = await ticketAction(
                                      'room',
                                      () => addBookingRoom(booking.id, picked.id),
                                      `${label} added to the bill.`,
                                    )
                                    if (added) {
                                      setRoomPick('')
                                      setShowRooms(false)
                                      setAddRoomOpen(false)
                                    }
                                  }}
                                >
                                  {busy === 'room' ? 'Adding…' : `Add ${unitName(picked)} · ${peso(picked.rate)}`}
                                </button>
                              </div>
                            )
                          })()
                        )}
                      </>
                    ) : null}
                    {preview.overCapacity === 0 ? (
                      <button type="button" className="room-more" onClick={() => setAddRoomOpen(!addRoomOpen)}>
                        {addRoomOpen ? 'Cancel adding a room' : 'Add a room'}
                      </button>
                    ) : null}
                    {preview.newArrivals > 0 && preview.due > 0 ? (
                      <p className="ticket-warn">
                        {preview.newArrivals} more guest{preview.newArrivals === 1 ? '' : 's'} arriving. Collect{' '}
                        {peso(preview.due)} below before they come in.
                      </p>
                    ) : preview.headcountChanged ? (
                      <button
                        type="button"
                        className="desk-ghost"
                        disabled={Boolean(busy) || preview.roomRequired}
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Update headcount',
                            message: `Set ${booking.guest_name}'s headcount to ${actualPax} pax? Excess pax fees are recalculated.`,
                            confirmLabel: 'Update headcount',
                          })
                          if (!ok) return
                          await ticketAction('headcount', () => setHeadcount(booking.id, actualPax), 'Headcount updated.')
                        }}
                      >
                        {busy === 'headcount' ? 'Updating…' : `Update headcount to ${actualPax}`}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="desk-note">Actual pax {booking.actual_pax || booking.pax} · excess {preview.excess}</p>
                )}

                {booking.status === 'checked_in' ? (
                  <div className="ticket-block">
                    <b>Extra hours</b>
                    <p className="desk-note">
                      Extra hours are billed and push the scheduled checkout back, so the automatic checkout waits.
                    </p>
                    <Counter label={`Hours to add · ${peso(hourRate)} / hr`} value={extraHours} onChange={setExtraHours} />
                    <button
                      type="button"
                      className="desk-ghost"
                      disabled={!extraHours || Boolean(busy)}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Add extra hours',
                          message: `Add ${extraHours} extra hour${extraHours === 1 ? '' : 's'} (${peso(extraHours * hourRate)}) to ${booking.guest_name}'s bill and extend checkout?`,
                          confirmLabel: 'Add to bill',
                        })
                        if (!ok) return
                        const added = await ticketAction('hours', () => addExtraHours(booking.id, extraHours), 'Extra hours added and checkout extended.')
                        if (added) setExtraHours(0)
                      }}
                    >
                      {busy === 'hours' ? 'Adding…' : 'Add extra hours'}
                    </button>
                  </div>
                ) : booking.status === 'confirmed' ? (
                  <Counter label={`Extra hours · ${peso(hourRate)} / hr`} value={extraHours} onChange={setExtraHours} />
                ) : null}

                {canEditBill ? (
                  <div className="ticket-block">
                    <b>Last-minute add-ons</b>
                    <p className="desk-note">
                      {preview.paid >= preview.bill && preview.due === 0
                        ? 'The bill is settled, so anything added now is collected on its own receipt.'
                        : 'Added to the remaining balance and printed on the same receipt.'}
                    </p>
                    {catalog?.rentals.length ? (
                      <div className="addon-row">
                        <select value={addon?.id || ''} onChange={(event) => setAddonId(event.target.value)} aria-label="Rental add-on">
                          {catalog.rentals.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {peso(item.price)}
                            </option>
                          ))}
                        </select>
                        {addonSingle ? (
                          <span className="qty qty-fixed" title="Unlimited play is a single flat charge">
                            <strong>× 1</strong>
                          </span>
                        ) : (
                          <span className="qty">
                            <button type="button" aria-label="Fewer" onClick={() => setAddonQty(Math.max(1, addonQty - 1))}>
                              −
                            </button>
                            <strong>{addonQty}</strong>
                            <button type="button" aria-label="More" onClick={() => setAddonQty(addonQty + 1)}>
                              +
                            </button>
                          </span>
                        )}
                        <button
                          type="button"
                          className="desk-ghost"
                          disabled={!addon || Boolean(busy)}
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Add rental',
                              message: `Add ${addonCount} × ${addon.name} (${peso(addon.price * addonCount)}) to ${booking.guest_name}'s bill?`,
                              confirmLabel: 'Add to bill',
                            })
                            if (!ok) return
                            const added = await ticketAction('addon', () => addBookingAddon(booking.id, addon.id, addonCount), `${addon.name} added to the bill.`)
                            if (added) setAddonQty(1)
                          }}
                        >
                          {busy === 'addon' ? 'Adding…' : 'Add'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <ul className="ticket-lines">
                  <li>
                    <span>Package</span>
                    <b>{peso(preview.bill)}</b>
                  </li>
                  {preview.chargeRows.map((row) => (
                    <li key={row.id}>
                      <span>
                        {row.description}
                        <small>{row.payment_id ? 'Settled' : row.kind === 'damage' ? 'Unpaid · cash only' : 'Unpaid'}</small>
                      </span>
                      <b>{peso(row.amount)}</b>
                    </li>
                  ))}
                  {preview.excessFee > 0 ? (
                    <li>
                      <span>Excess pax × {preview.excess}</span>
                      <b>{peso(preview.excessFee)}</b>
                    </li>
                  ) : null}
                  {preview.hoursFee > 0 ? (
                    <li>
                      <span>Extra hours</span>
                      <b>{peso(preview.hoursFee)}</b>
                    </li>
                  ) : null}
                  <li className="ticket-subtotal">
                    <span>Total bill</span>
                    <b>{peso(preview.total)}</b>
                  </li>
                  <li className="ticket-paid">
                    <span>Already paid</span>
                    <b>−{peso(preview.paid)}</b>
                  </li>
                </ul>
                <div className="ticket-due">
                  <span>Amount due</span>
                  <strong>{peso(preview.due)}</strong>
                </div>
                {preview.damageDue > 0 ? (
                  <p className="ticket-warn">
                    {peso(preview.damageDue)} of this is for damaged items and must be paid in cash.
                  </p>
                ) : null}
                {preview.due > 0 ? (
                  <div className="pay-grid">
                    <label>
                      Cash
                      <input type="number" min="0" value={cash} onChange={(event) => setCash(event.target.value)} placeholder="0" />
                    </label>
                    <label>
                      E-wallet / GCash
                      <input type="number" min="0" value={ewallet} onChange={(event) => setEwallet(event.target.value)} placeholder="0" />
                    </label>
                  </div>
                ) : null}

                {booking.status === 'confirmed' ? (
                  <>
                    <p className="desk-note">
                      Count heads, then settle the balance before handing over the room. Collect now and check in later,
                      or do both at once.
                    </p>
                    <div className="ticket-actions">
                      <button
                        type="button"
                        className="desk-ghost"
                        disabled={Boolean(busy) || preview.due <= 0 || preview.roomRequired}
                        onClick={() => settle('collect')}
                      >
                        {busy === 'collect' ? 'Collecting…' : preview.due > 0 ? 'Collect only' : 'Paid in full'}
                      </button>
                      <button
                        type="button"
                        className="desk-btn"
                        disabled={Boolean(busy) || preview.roomRequired}
                        onClick={() => settle('checkin')}
                      >
                        {busy === 'checkin' ? 'Checking in…' : preview.due > 0 ? 'Collect & check in' : 'Check in'}
                      </button>
                    </div>
                  </>
                ) : booking.status === 'checked_in' && preview.newArrivals > 0 && preview.due > 0 ? (
                  <>
                    <p className="desk-note">
                      The extra guests pay before they come in. Their headcount is saved once the payment is collected.
                    </p>
                    <button
                      type="button"
                      className="desk-btn"
                      disabled={Boolean(busy) || preview.roomRequired}
                      onClick={() => settle('admit')}
                    >
                      {busy === 'admit'
                        ? 'Collecting…'
                        : `Collect ${peso(preview.due)} & let ${preview.newArrivals} more in`}
                    </button>
                  </>
                ) : booking.status === 'checked_in' ? (
                  <div className="ticket-actions">
                    <button
                      type="button"
                      className="desk-ghost"
                      disabled={Boolean(busy) || preview.due <= 0 || preview.headcountChanged}
                      onClick={() => settle('collect')}
                    >
                      {busy === 'collect' ? 'Collecting…' : preview.due > 0 ? 'Collect only' : 'Nothing due'}
                    </button>
                    <button
                      type="button"
                      className="desk-btn"
                      disabled={Boolean(busy) || preview.headcountChanged}
                      onClick={() => settle('checkout')}
                    >
                      {busy === 'checkout' ? 'Checking out…' : preview.due > 0 ? 'Collect & check out' : 'Check out'}
                    </button>
                  </div>
                ) : booking.status === 'checked_out' ? (
                  <button type="button" className="desk-btn" disabled={Boolean(busy)} onClick={() => settle('checkout')}>
                    {busy === 'checkout' ? 'Collecting…' : 'Collect remaining & complete'}
                  </button>
                ) : (
                  <button type="button" className="desk-btn" disabled>
                    {STATUS_LABELS[booking.status] || booking.status}
                    {['pending_approval', 'awaiting_downpayment'].includes(booking.status) ? ' — not ready' : ''}
                  </button>
                )}
                {done ? <p className="desk-ok">{done}</p> : null}
                {error ? <p className="desk-err">{error}</p> : null}
                {receipt && receipt.booking.id === booking.id ? (
                  <button
                    type="button"
                    className="desk-ghost"
                    onClick={() => printReceipt(receipt.booking, receipt.payment, receipt.tender)}
                  >
                    Print {receipt.payment.type === 'onsite' ? 'add-on receipt' : 'receipt'} · {receipt.payment.receipt_no}
                  </button>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}

      {active === 'Housekeeping' && (
        <Housekeeping rooms={rooms} bookings={bookings} busy={busy} onChangeStatus={changeRoom} onOccupy={occupyRoomByHand} />
      )}

      {active === 'Supplies' && <SupplyLog guests={inside} onError={setError} onSaved={setDone} />}

      {active === 'Utility monitoring' && <UtilityMonitor canManage onError={setError} onSaved={setDone} />}

      {active === 'Damage reports' && (
        <DamageReports bookings={bookings} onError={setError} onSaved={setDone} onChanged={reload} />
      )}

      {active === 'Blacklist' && (
        <BlacklistPanel
          users={users}
          onError={setError}
          onSaved={async (message) => {
            setDone(message)
            await reload().catch(() => {})
          }}
        />
      )}

      {active === 'Receipts' && (
        <FolderList
          empty="No payments recorded yet."
          groups={groupByMonth(paidReceipts, (item) => item.paid_at)}
          renderItem={(item) => (
            <li key={item.id}>
              <div>
                <b>
                  {item.receipt_no || 'Receipt'} · {item.reference}
                </b>
                <small>
                  {item.guest_name} · {item.method} · {PAYMENT_TITLES[item.type] || item.type} · {prettyDateTime(item.paid_at)}
                </small>
                <small>{receiptLines(item.booking, item).map((line) => line.label).join(' · ')}</small>
              </div>
              <div className="receipt-row">
                <span className="pill">{peso(item.amount)}</span>
                <button type="button" className="desk-ghost" onClick={() => printReceipt(item.booking, item)}>
                  Print receipt
                </button>
              </div>
            </li>
          )}
        />
      )}
      {printing ? (
        <ReceiptPrinter
          key={printing.payment.id}
          booking={printing.booking}
          payment={printing.payment}
          tender={printing.tender}
          onClose={() => setPrinting(null)}
        />
      ) : null}
    </RoleLayout>
  )
}
