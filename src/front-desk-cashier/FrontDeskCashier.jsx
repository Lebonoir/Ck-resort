import { useEffect, useMemo, useState } from 'react'
import { ActionToast, RoleLayout, Stat } from '../shared/RoleLayout'
import RentalDispatch from '../shared/RentalDispatch'
import Housekeeping from '../shared/Housekeeping'
import { useLiveData } from '../shared/useLiveData'
import { CountdownPill } from '../shared/Countdown'
import { FolderList, groupByMonth } from '../shared/FolderList'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  addCharge,
  addExtraHours,
  checkInBooking,
  checkOutBooking,
  createWalkIn,
  deleteReturnedDispatch,
  dispatchRental,
  getCatalog,
  listBookings,
  listDispatches,
  listRoomUnits,
  returnRental,
  setRoomStatus,
} from '../lib/api'
import {
  peso,
  prettyDate,
  rpcError,
  STATUS_LABELS,
  stayEndsAt,
  stayStartLabel,
  stayWindowLabel,
  verifiedPaid,
} from '../lib/format'
import '../resort-operations-staff/staff.css'
import './front-desk.css'

const NAV = [
  { section: 'Front desk', items: ['POS & Check-in', 'Receipts'] },
  { section: 'Operations', items: ['Rental dispatch', 'Housekeeping'] },
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ))
}

function receiptHtml(booking, result, tendered) {
  const packageLines = booking.quote_lines || []
  const chargeLines = (booking.booking_charges || []).map((row) => ({ label: row.description, amount: row.amount }))
  const lines = [...packageLines, ...chargeLines]
  const payment = (booking.payments || []).find((row) => row.id === result.payment_id)
  const receiptNo = payment?.receipt_no || result.payment_id || '—'
  const paidAt = payment?.paid_at ? new Date(payment.paid_at).toLocaleString('en-PH') : new Date().toLocaleString('en-PH')

  return `
    <html>
      <head>
        <title>${escapeHtml(booking.reference)} receipt</title>
        <style>
          body { font-family: Georgia, serif; padding: 24px; color: #10243a; }
          h1 { font-size: 22px; margin: 0 0 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          td { padding: 6px 0; border-bottom: 1px solid #eee; }
          .right { text-align: right; }
        </style>
      </head>
      <body>
        <h1>CK Resort & Events Place</h1>
        <p>St. Duyong, San Simon, Pampanga<br/>Official Receipt No. ${escapeHtml(receiptNo)} · ${escapeHtml(paidAt)}</p>
        <p><b>${escapeHtml(booking.reference)}</b> · ${escapeHtml(booking.guest_name)}<br/>${escapeHtml(booking.package_label)}<br/>${escapeHtml(booking.stay_date)}</p>
        <table>
          ${lines.map((line) => `<tr><td>${escapeHtml(line.label)}</td><td class="right">${peso(line.amount)}</td></tr>`).join('') || '<tr><td colspan="2">No itemized lines on file.</td></tr>'}
        </table>
        <p>
          Collected now: <b>${peso(result.due)}</b>
          ${tendered ? `<br/>Cash: ${peso(tendered.cash)} · E-wallet: ${peso(tendered.ewallet)}` : ''}
          <br/>Change: ${peso(result.change)}
        </p>
        <p>Thank you for staying with us.</p>
        <script>window.print()</script>
      </body>
    </html>
  `
}

export default function FrontDeskCashier({ session, onSignOut }) {
  const confirm = useConfirm()
  const [active, setActive] = useState('POS & Check-in')
  const [bookings, setBookings] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [logs, setLogs] = useState([])
  const [rooms, setRooms] = useState([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [walkIn, setWalkIn] = useState(false)
  const [walkName, setWalkName] = useState('')
  const [walkType, setWalkType] = useState('day')
  const [actualPax, setActualPax] = useState(20)
  const [extraHours, setExtraHours] = useState(0)
  const [cash, setCash] = useState('')
  const [ewallet, setEwallet] = useState('')
  const [chargeLabel, setChargeLabel] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState('')
  const [receipt, setReceipt] = useState(null)

  async function reload() {
    const [nextBookings, nextCatalog, nextLogs, nextRooms] = await Promise.all([
      listBookings(),
      getCatalog(),
      listDispatches(),
      listRoomUnits(),
    ])
    setBookings(nextBookings)
    setCatalog(nextCatalog)
    setLogs(nextLogs)
    setRooms(nextRooms)
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

  useEffect(() => {
    reload().catch((err) => setError(rpcError(err)))
  }, [])

  // Auto checkout, expiries and housekeeping land here without a refresh.
  useLiveData(() => reload().catch(() => {}), { channel: 'desk' })

  const list = bookings.filter((item) =>
    `${item.reference} ${item.guest_name}`.toLowerCase().includes(query.toLowerCase()),
  )
  const booking = bookings.find((item) => item.id === selectedId)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  // Arriving = confirmed and due today. Pending = confirmed for a later date, or still unpaid/unapproved.
  const arriving = bookings.filter((item) => item.status === 'confirmed' && item.stay_date === today)
  const upcoming = bookings.filter((item) => item.status === 'confirmed' && item.stay_date > today)
  const awaiting = bookings.filter((item) =>
    ['pending_approval', 'awaiting_downpayment'].includes(item.status),
  )
  const pending = [...upcoming, ...awaiting]
  const inside = bookings.filter((item) => item.status === 'checked_in')
  const extraPaxRate = catalog?.rates.find((row) => row.key === (booking?.tour_type === 'overnight' ? 'extra_pax_overnight' : 'extra_pax_tour'))?.amount || 200
  const hourRate = catalog?.rates.find((row) => row.key === 'extra_hour')?.amount || 1000

  const preview = useMemo(() => {
    if (!booking) return null
    const checkedIn = ['checked_in', 'checked_out'].includes(booking.status)
    const bill = Number(booking.override_amount ?? booking.total_amount)
    const paid = verifiedPaid(booking)
    const excess = checkedIn ? Number(booking.excess_pax || 0) : Math.max(actualPax - booking.pax, 0)
    const charges = (booking.booking_charges || []).reduce((sum, row) => sum + Number(row.amount), 0)
    const hoursFee = (checkedIn ? Number(booking.checkin_extra_hours || 0) : extraHours) * hourRate
    const excessFee = excess * extraPaxRate
    const total = bill + charges + excessFee + hoursFee
    const due = Math.max(total - paid, 0)
    return { excess, charges, excessFee, hoursFee, bill, total, due, paid, checkedIn }
  }, [booking, actualPax, extraHours, extraPaxRate, hourRate])

  function pick(item) {
    setWalkIn(false)
    setSelectedId(item.id)
    setActualPax(item.actual_pax || item.pax)
    // Once checked in the counter means "hours to add", so it starts at zero.
    const checkedIn = ['checked_in', 'checked_out'].includes(item.status)
    setExtraHours(checkedIn ? 0 : item.checkin_extra_hours || 0)
    setCash('')
    setEwallet('')
    setDone('')
    setError('')
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
        pax: walkType === 'overnight' ? 10 : 20,
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

  async function collect() {
    if (!booking) return
    const tendered = (Number(cash) || 0) + (Number(ewallet) || 0)
    const ok = await confirm({
      title: 'Collect & check in',
      message: `Check in ${booking.guest_name} and collect ${peso(preview?.due || 0)} now (tendered ${peso(tendered)})?`,
      confirmLabel: 'Collect & check in',
    })
    if (!ok) return
    setError('')
    setDone('')
    setBusy('collect')
    try {
      const tendered = { cash: Number(cash) || 0, ewallet: Number(ewallet) || 0 }
      const result = await checkInBooking(booking.id, {
        actualPax,
        extraHours,
        cash: tendered.cash,
        ewallet: tendered.ewallet,
      })
      setDone(`${booking.guest_name} is checked in. ${peso(result.due)} collected.`)
      const rows = await reload()
      const receiptBooking = rows.find((item) => item.id === booking.id) || booking
      setReceipt({ booking: receiptBooking, result, tendered })
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function checkout() {
    if (!booking) return
    const tendered = (Number(cash) || 0) + (Number(ewallet) || 0)
    const ok = await confirm({
      title: booking.status === 'checked_out' ? 'Complete stay' : 'Collect & check out',
      message: `Collect ${peso(preview?.due || 0)} (tendered ${peso(tendered)}) and ${booking.status === 'checked_out' ? 'complete' : 'check out'} ${booking.guest_name}?`,
      confirmLabel: booking.status === 'checked_out' ? 'Complete stay' : 'Check out',
    })
    if (!ok) return
    setError('')
    setDone('')
    setBusy('checkout')
    try {
      const tendered = { cash: Number(cash) || 0, ewallet: Number(ewallet) || 0 }
      const result = await checkOutBooking(booking.id, {
        cash: tendered.cash,
        ewallet: tendered.ewallet,
      })
      const doneLabel = result.booking?.status === 'completed' ? 'Stay completed' : 'Checked out'
      setDone(`${booking.guest_name} · ${doneLabel}. ${peso(result.due)} collected.`)
      const rows = await reload()
      const receiptBooking = rows.find((item) => item.id === booking.id) || booking
      setReceipt({ booking: receiptBooking, result, tendered })
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  const paidReceipts = bookings.flatMap((item) =>
    (item.payments || [])
      .filter((pay) => pay.status === 'paid')
      .map((pay) => ({ ...pay, reference: item.reference, guest_name: item.guest_name })),
  )

  return (
    <RoleLayout roleId="front-desk" name={session.name} nav={NAV} active={active} onNav={setActive} onSignOut={onSignOut}>
      <ActionToast
        busy={Boolean(busy)}
        tone={error ? 'error' : 'ok'}
        message={
          busy === 'collect'
            ? 'Collecting payment…'
            : busy === 'checkout'
              ? 'Checking out…'
              : busy === 'walkin'
                ? 'Loading walk-in…'
                : busy === 'charge'
                  ? 'Adding charge…'
                  : busy === 'hours'
                    ? 'Adding extra hours…'
                    : error || done
        }
      />
      <div className="stats stats-5">
        <Stat label="Arriving today" value={String(arriving.length)} hint="Confirmed for today" />
        <Stat label="Pending" value={String(pending.length)} hint="Future & unpaid" />
        <Stat label="On property" value={String(inside.length)} hint="Checked in" />
        <Stat label="Rentals out" value={String(logs.filter((item) => item.status === 'out').length)} hint="Awaiting return" />
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
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Look up booking ID or guest name" />
              <button type="button" className="desk-ghost" onClick={() => setWalkIn(true)}>
                Walk-in
              </button>
            </div>
            <FolderList
              empty="No bookings match that search."
              listClassName="desk-list"
              groups={[
                {
                  id: 'arriving',
                  label: 'Arriving today',
                  items: list.filter((item) => item.status === 'confirmed' && item.stay_date === today),
                  defaultOpen: true,
                },
                {
                  id: 'inside',
                  label: 'On property',
                  items: list.filter((item) => item.status === 'checked_in' || item.status === 'checked_out'),
                },
                {
                  id: 'pending',
                  label: 'Pending (upcoming)',
                  items: list.filter((item) => item.status === 'confirmed' && item.stay_date > today),
                },
                {
                  id: 'waiting',
                  label: 'Awaiting approval / payment',
                  items: list.filter((item) => item.status === 'pending_approval' || item.status === 'awaiting_downpayment'),
                },
                {
                  id: 'history',
                  label: 'History',
                  items: list.filter((item) =>
                    ['completed', 'cancelled', 'rejected', 'expired', 'no_show'].includes(item.status),
                  ),
                },
              ]}
              renderItem={(item) => (
                <li key={item.id}>
                  <button type="button" className={item.id === selectedId && !walkIn ? 'on' : ''} onClick={() => pick(item)}>
                    <b>
                      {item.guest_name}
                      <small>{item.reference}</small>
                    </b>
                    <span>
                      {item.package_label}
                      <small>
                        {prettyDate(item.stay_date)} · {stayStartLabel(item)} · {STATUS_LABELS[item.status]}
                      </small>
                    </span>
                  </button>
                </li>
              )}
            />
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
                <p className="desk-note">Full amount is due at the counter because no downpayment was collected yet.</p>
                <button type="button" className="desk-btn" disabled={!walkName.trim() || Boolean(busy)} onClick={loadWalkIn}>
                  {busy === 'walkin' ? 'Loading…' : 'Load walk-in to POS'}
                </button>
              </div>
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
                {preview.checkedIn ? (
                  <p className="desk-note">Actual pax {booking.actual_pax || booking.pax} · excess {preview.excess}</p>
                ) : (
                  <>
                    <Counter label="Pax on arrival" value={actualPax} min={1} onChange={setActualPax} />
                    <p className="desk-note">
                      Excess pax × {preview.excess} · {peso(extraPaxRate)} each
                    </p>
                  </>
                )}
                {preview.checkedIn ? (
                  <>
                    <p className="desk-note">
                      Extra hours are billed and push the scheduled checkout back, so the automatic checkout waits.
                    </p>
                    <Counter label={`Extra hours to add · ${peso(hourRate)} / hr`} value={extraHours} onChange={setExtraHours} />
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
                        setError('')
                        setDone('')
                        setBusy('hours')
                        try {
                          await addExtraHours(booking.id, extraHours)
                          setExtraHours(0)
                          const rows = await reload()
                          const next = rows.find((item) => item.id === booking.id)
                          if (next) setSelectedId(next.id)
                          setDone('Extra hours added and checkout extended.')
                        } catch (err) {
                          setError(rpcError(err))
                        } finally {
                          setBusy('')
                        }
                      }}
                    >
                      {busy === 'hours' ? 'Adding…' : 'Add extra hours'}
                    </button>
                  </>
                ) : (
                  <Counter label={`Extra hours · ${peso(hourRate)} / hr`} value={extraHours} onChange={setExtraHours} />
                )}
                <div className="pay-grid">
                  <input value={chargeLabel} onChange={(event) => setChargeLabel(event.target.value)} placeholder="On-site add-on" />
                  <input type="number" min="0" value={chargeAmount} onChange={(event) => setChargeAmount(event.target.value)} placeholder="Amount" />
                </div>
                <button
                  type="button"
                  className="desk-ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const amount = Number(chargeAmount) || 0
                    const ok = await confirm({
                      title: 'Add charge',
                      message: `Add ${chargeLabel.trim() || 'this add-on'} (${peso(amount)}) to ${booking.guest_name}'s bill?`,
                      confirmLabel: 'Add charge',
                    })
                    if (!ok) return
                    setError('')
                    setDone('')
                    setBusy('charge')
                    try {
                      await addCharge(booking.id, chargeLabel, amount)
                      setChargeLabel('')
                      setChargeAmount('')
                      const rows = await reload()
                      const next = rows.find((item) => item.id === booking.id)
                      if (next) setSelectedId(next.id)
                      setDone('Charge added to the bill.')
                    } catch (err) {
                      setError(rpcError(err))
                    } finally {
                      setBusy('')
                    }
                  }}
                >
                  {busy === 'charge' ? 'Adding…' : 'Add charge'}
                </button>
                <ul className="ticket-lines">
                  <li>
                    <span>Package</span>
                    <b>{peso(preview.bill)}</b>
                  </li>
                  {preview.charges > 0 ? (
                    <li>
                      <span>On-site charges</span>
                      <b>{peso(preview.charges)}</b>
                    </li>
                  ) : null}
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
                {booking.status === 'checked_in' || booking.status === 'checked_out' ? (
                  <button type="button" className="desk-btn" disabled={Boolean(busy)} onClick={checkout}>
                    {busy === 'checkout'
                      ? 'Collecting…'
                      : booking.status === 'checked_out'
                        ? 'Collect remaining & complete'
                        : 'Collect & check out'}
                  </button>
                ) : (
                  <button type="button" className="desk-btn" disabled={booking.status !== 'confirmed' || Boolean(busy)} onClick={collect}>
                    {busy === 'collect'
                      ? 'Collecting…'
                      : booking.status === 'confirmed'
                        ? 'Collect & check in'
                        : `${STATUS_LABELS[booking.status] || booking.status} — not ready`}
                  </button>
                )}
                {done ? <p className="desk-ok">{done}</p> : null}
                {error ? <p className="desk-err">{error}</p> : null}
                {receipt ? (
                  <button
                    type="button"
                    className="desk-ghost"
                    onClick={() => {
                      const popup = window.open('', 'receipt')
                      if (!popup) {
                        setError('Allow pop-ups for this site to print the receipt.')
                        return
                      }
                      popup.document.write(receiptHtml(receipt.booking, receipt.result, receipt.tendered))
                      popup.document.close()
                    }}
                  >
                    Print receipt
                  </button>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}

      {active === 'Rental dispatch' && (
        <RentalDispatch
          guests={inside}
          rentals={catalog?.rentals || []}
          logs={logs}
          onDispatch={async ({ guestId, itemId, qty }) => {
            setError('')
            try {
              await dispatchRental(guestId, itemId, qty)
              await reload()
              setDone('Rental logged as out.')
            } catch (err) {
              setError(rpcError(err))
            }
          }}
          onReturn={async (id) => {
            setError('')
            try {
              await returnRental(id)
              await reload()
              setDone('Rental marked returned.')
            } catch (err) {
              setError(rpcError(err))
            }
          }}
          onDeleteReturned={async (id) => {
            setError('')
            try {
              await deleteReturnedDispatch(id)
              await reload()
              setDone('Returned rental log removed.')
            } catch (err) {
              setError(rpcError(err))
            }
          }}
        />
      )}

      {active === 'Housekeeping' && (
        <Housekeeping rooms={rooms} bookings={bookings} busy={busy} onChangeStatus={changeRoom} />
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
                  {item.guest_name} · {item.method} · {item.type}
                </small>
              </div>
              <span className="pill">{peso(item.amount)}</span>
            </li>
          )}
        />
      )}
    </RoleLayout>
  )
}
