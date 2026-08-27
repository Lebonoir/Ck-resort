import { useEffect, useMemo, useState } from 'react'
import { ActionToast, RoleLayout, Stat } from '../shared/RoleLayout'
import RentalDispatch from '../shared/RentalDispatch'
import { FolderList, groupByMonth } from '../shared/FolderList'
import {
  addCharge,
  checkInBooking,
  checkOutBooking,
  createWalkIn,
  deleteReturnedDispatch,
  dispatchRental,
  getCatalog,
  listBookings,
  listDispatches,
  returnRental,
} from '../lib/api'
import { peso, prettyDate, rpcError, STATUS_LABELS, verifiedPaid } from '../lib/format'
import './front-desk.css'

const NAV = ['POS & Check-in', 'Rental dispatch', 'Receipts']

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

function receiptHtml(booking, result, catalog) {
  const lines = booking.quote_lines || []
  return `
    <html>
      <head>
        <title>${booking.reference} receipt</title>
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
        <p>St. Duyong, San Simon, Pampanga<br/>Official receipt ${result.payment_id ? '' : ''}</p>
        <p><b>${booking.reference}</b> · ${booking.guest_name}<br/>${booking.package_label}<br/>${booking.stay_date}</p>
        <table>
          ${lines.map((line) => `<tr><td>${line.label}</td><td class="right">${peso(line.amount)}</td></tr>`).join('')}
        </table>
        <p>Collected now: <b>${peso(result.due)}</b><br/>Change: ${peso(result.change)}</p>
        <p>Thank you for staying with us.</p>
        <script>window.print()</script>
      </body>
    </html>
  `
}

export default function FrontDeskCashier({ session, onSignOut }) {
  const [active, setActive] = useState('POS & Check-in')
  const [bookings, setBookings] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [logs, setLogs] = useState([])
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
    const [nextBookings, nextCatalog, nextLogs] = await Promise.all([listBookings(), getCatalog(), listDispatches()])
    setBookings(nextBookings)
    setCatalog(nextCatalog)
    setLogs(nextLogs)
    return nextBookings
  }

  useEffect(() => {
    reload().catch((err) => setError(rpcError(err)))
  }, [])

  const list = bookings.filter((item) =>
    `${item.reference} ${item.guest_name}`.toLowerCase().includes(query.toLowerCase()),
  )
  const booking = bookings.find((item) => item.id === selectedId)
  const arriving = bookings.filter((item) => item.status === 'confirmed')
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
    const due = Math.max(bill - paid + charges + excess * extraPaxRate + hoursFee, 0)
    return { excess, charges, due, paid, checkedIn }
  }, [booking, actualPax, extraHours, extraPaxRate, hourRate])

  function pick(item) {
    setWalkIn(false)
    setSelectedId(item.id)
    setActualPax(item.actual_pax || item.pax)
    setExtraHours(item.checkin_extra_hours || 0)
    setCash('')
    setEwallet('')
    setDone('')
    setError('')
  }

  async function loadWalkIn() {
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
    setError('')
    setDone('')
    setBusy('collect')
    try {
      const result = await checkInBooking(booking.id, {
        actualPax,
        extraHours,
        cash: Number(cash) || 0,
        ewallet: Number(ewallet) || 0,
      })
      setDone(`${booking.guest_name} is checked in. ${peso(result.due)} collected.`)
      setReceipt({ booking, result })
      await reload()
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function checkout() {
    if (!booking) return
    setError('')
    setDone('')
    setBusy('checkout')
    try {
      const result = await checkOutBooking(booking.id, {
        cash: Number(cash) || 0,
        ewallet: Number(ewallet) || 0,
      })
      const doneLabel = result.booking?.status === 'completed' ? 'Stay completed' : 'Checked out'
      setDone(`${booking.guest_name} · ${doneLabel}. ${peso(result.due)} collected.`)
      setReceipt({ booking, result })
      await reload()
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
      <div className="stats">
        <Stat label="Arriving" value={String(arriving.length)} hint="Still to check in" />
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
                { id: 'arriving', label: 'Arriving', items: list.filter((item) => item.status === 'confirmed'), defaultOpen: true },
                {
                  id: 'inside',
                  label: 'On property',
                  items: list.filter((item) => item.status === 'checked_in' || item.status === 'checked_out'),
                },
                {
                  id: 'waiting',
                  label: 'Awaiting',
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
                        {prettyDate(item.stay_date)} · {STATUS_LABELS[item.status]}
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
                    <p className="desk-note">Extra hours after arrival are added as charges. Scheduled checkout does not change.</p>
                    <Counter label={`Extra hours to add · ${peso(hourRate)} / hr`} value={extraHours} onChange={setExtraHours} />
                    <button
                      type="button"
                      className="desk-ghost"
                      disabled={!extraHours || Boolean(busy)}
                      onClick={async () => {
                        setError('')
                        setDone('')
                        setBusy('hours')
                        try {
                          await addCharge(booking.id, `Extra hour × ${extraHours}`, extraHours * hourRate)
                          setExtraHours(0)
                          const rows = await reload()
                          const next = rows.find((item) => item.id === booking.id)
                          if (next) setSelectedId(next.id)
                          setDone('Extra hours added to the bill.')
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
                    setError('')
                    setDone('')
                    setBusy('charge')
                    try {
                      await addCharge(booking.id, chargeLabel, Number(chargeAmount) || 0)
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
                    <span>Package remaining</span>
                    <b>{peso(Math.max(Number(booking.override_amount ?? booking.total_amount) - preview.paid, 0))}</b>
                  </li>
                  <li>
                    <span>On-site charges</span>
                    <b>{peso(preview.charges)}</b>
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
                      popup.document.write(receiptHtml(receipt.booking, receipt.result, catalog))
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
