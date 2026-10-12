import { useState } from 'react'
import { CountdownPill } from '../shared/Countdown'
import { manilaTodayIso } from '../shared/MonthCalendar'
import {
  GUEST_ACTIVE_STATUSES,
  peso,
  prettyDate,
  prettyDateTime,
  STATUS_LABELS,
  stayEndsAt,
  stayWindowLabel,
  verifiedPaid,
} from '../lib/format'
import { rebookDeadline, rebookFee } from './RebookDialog'
import './reservations.css'

const PAST_FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'completed', label: 'Completed', match: (row) => row.status === 'completed' },
  { id: 'other', label: 'Cancelled & missed', match: (row) => row.status !== 'completed' },
]

function daysUntil(iso) {
  const day = 24 * 3600 * 1000
  return Math.round((new Date(`${iso}T00:00:00`) - new Date(`${manilaTodayIso()}T00:00:00`)) / day)
}

function whenLabel(booking) {
  if (booking.status === 'checked_in') return 'On property now'
  if (booking.status === 'checked_out') return 'Stay ended'
  const days = daysUntil(booking.stay_date)
  if (days > 1) return `In ${days} days`
  if (days === 1) return 'Tomorrow'
  if (days === 0) return 'Today'
  return 'Date passed'
}

function roomNames(booking, catalog) {
  const ids = (booking.booking_rooms || []).map((row) => row.room_unit_id)
  return (catalog?.units || [])
    .filter((unit) => ids.includes(unit.id))
    .map((unit) => `${catalog.rooms?.find((room) => room.id === unit.room_id)?.name || ''} ${unit.name}`.trim())
}

function rentalNames(booking, catalog) {
  const bits = (booking.booking_rentals || []).map((row) => {
    const item = catalog?.rentals?.find((rental) => rental.id === row.rental_id)
    return `${item?.name || 'Rental'} × ${row.qty}`
  })
  if (Number(booking.pets) > 0) bits.push(`Pets × ${booking.pets}`)
  return bits
}

function money(booking) {
  const charges = (booking.booking_charges || []).reduce((sum, row) => sum + Number(row.amount), 0)
  const total = Number(booking.override_amount ?? booking.total_amount) + charges
  const paid = verifiedPaid(booking)
  return { total, paid, balance: Math.max(total - paid, 0), percent: total > 0 ? Math.min((paid / total) * 100, 100) : 0 }
}

// One plain sentence about what the guest should do next.
function nextStep(booking, bill) {
  switch (booking.status) {
    case 'awaiting_downpayment':
      return `Pay the ${peso(booking.downpayment_amount)} downpayment${booking.payment_due_at ? ` by ${prettyDateTime(booking.payment_due_at)}` : ''} to confirm this date. The hold is released after that.`
    case 'pending_approval':
      return 'Waiting for the resort to review this request.'
    case 'confirmed':
      return bill.balance > 0
        ? `You are confirmed. Bring ${peso(bill.balance)} for the front desk — the balance is settled before check-in.`
        : 'You are confirmed and fully paid. Show this reference at the front desk.'
    case 'checked_in':
      return bill.balance > 0
        ? `Enjoy your stay. ${peso(bill.balance)} was added to your bill and is settled at the front desk.`
        : 'Enjoy your stay. Nothing is left to pay.'
    case 'checked_out':
      return `Your stay has ended. ${peso(bill.balance)} is still to be settled at the front desk.`
    default:
      return ''
  }
}

function ActiveCard({ booking, catalog, rules, focus, busy, busyKind, notice, onPay, onVerify, onCancel, onRebook }) {
  const bill = money(booking)
  const date = new Date(`${booking.stay_date}T00:00:00`)
  const rooms = roomNames(booking, catalog)
  const extras = rentalNames(booking, catalog)
  const charges = booking.booking_charges || []
  const working = busy && busy.endsWith(booking.id)
  const deadline = rebookDeadline(booking, rules.rebook_min_days)
  const canRebook = booking.status === 'confirmed' && Date.now() <= deadline.getTime()
  const canCancel =
    ['pending_approval', 'awaiting_downpayment'].includes(booking.status) ||
    (booking.status === 'confirmed' && Date.now() < rebookDeadline(booking, 0).getTime())

  return (
    <article className={`resv-card status-${booking.status} ${focus ? 'focus' : ''}`}>
      <div className="resv-stub">
        <span className="resv-month">{date.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}</span>
        <b className="resv-day">{date.getDate()}</b>
        <span className="resv-weekday">{date.toLocaleDateString('en-PH', { weekday: 'long' })}</span>
        <span className="resv-window">{stayWindowLabel(booking)}</span>
        <span className="resv-when">{whenLabel(booking)}</span>
      </div>

      <div className="resv-main">
        <header>
          <div>
            <p className="resv-ref">{booking.reference}</p>
            <h3>{booking.package_label}</h3>
          </div>
          <span className={`resv-status status-${booking.status}`}>{STATUS_LABELS[booking.status] || booking.status}</span>
        </header>

        <p className="resv-next">{nextStep(booking, bill)}</p>

        {booking.status === 'checked_in' ? (
          <CountdownPill until={stayEndsAt(booking)} label="Checkout in" doneLabel="Checking out…" />
        ) : null}

        <dl className="resv-facts">
          <div>
            <dt>Guests</dt>
            <dd>{booking.actual_pax || booking.pax} pax</dd>
          </div>
          <div>
            <dt>Rooms</dt>
            <dd>{rooms.length ? rooms.join(', ') : 'No room'}</dd>
          </div>
          <div>
            <dt>Add-ons</dt>
            <dd>{extras.length ? extras.join(', ') : 'None'}</dd>
          </div>
          {booking.original_stay_date ? (
            <div>
              <dt>Rebooked from</dt>
              <dd>{prettyDate(booking.original_stay_date)}</dd>
            </div>
          ) : null}
        </dl>

        <section className="resv-pay" aria-label="Payment">
          <div className="resv-bar" role="img" aria-label={`${Math.round(bill.percent)}% paid`}>
            <span style={{ transform: `scaleX(${bill.percent / 100})` }} />
          </div>
          <div className="resv-figures">
            <div>
              <span>Total</span>
              <b>{peso(bill.total)}</b>
            </div>
            <div>
              <span>Paid</span>
              <b className="paid">{peso(bill.paid)}</b>
            </div>
            <div>
              <span>{booking.status === 'awaiting_downpayment' ? 'Due now' : 'Balance at check-in'}</span>
              <b>{peso(booking.status === 'awaiting_downpayment' ? booking.downpayment_amount : bill.balance)}</b>
            </div>
          </div>
          {charges.length ? (
            <ul className="resv-charges">
              {charges.map((row) => (
                <li key={row.id}>
                  <span>{row.description}</span>
                  <b>{peso(row.amount)}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {notice ? <p className={`flash inline-flash ${notice.tone}`}>{notice.text}</p> : null}

        <footer className="resv-actions">
          {booking.status === 'awaiting_downpayment' ? (
            <>
              <button type="button" className="resv-primary" disabled={Boolean(busy)} onClick={() => onPay(booking)}>
                {working && busyKind === 'pay' ? 'Opening PayMongo…' : `Pay ${peso(booking.downpayment_amount)}`}
              </button>
              <button type="button" className="resv-ghost" disabled={Boolean(busy)} onClick={() => onVerify(booking)}>
                {working && busyKind === 'verify' ? 'Checking…' : 'I already paid'}
              </button>
            </>
          ) : null}
          {booking.status === 'confirmed' ? (
            <span className="resv-rebook">
              <button type="button" className="resv-ghost" disabled={Boolean(busy) || !canRebook} onClick={() => onRebook(booking)}>
                Rebook
              </button>
              <small>
                {canRebook
                  ? `Until ${prettyDateTime(deadline.toISOString())}${rebookFee(booking, rules) > 0 ? ` · ${Number(rules.rebook_fee_percent) > 0 ? `${rules.rebook_fee_percent}% fee, ` : ''}${peso(rebookFee(booking, rules))}` : ''}`
                  : `Closed ${rules.rebook_min_days} day${rules.rebook_min_days === 1 ? '' : 's'} before the stay`}
              </small>
            </span>
          ) : null}
          {canCancel ? (
            <button type="button" className="resv-cancel" disabled={Boolean(busy)} onClick={() => onCancel(booking)}>
              {working && busyKind === 'cancel' ? 'Cancelling…' : booking.status === 'confirmed' ? 'Cancel reservation' : 'Cancel request'}
            </button>
          ) : null}
        </footer>
        {booking.status === 'confirmed' && canCancel ? (
          <p className="resv-fine">Cancelling does not refund the downpayment.</p>
        ) : null}
      </div>
    </article>
  )
}

/**
 * Guest "My reservations": the current booking as a full ticket (date, what
 * is booked, money, next step, actions) and past stays as a compact history.
 */
export default function Reservations({
  bookings,
  catalog,
  rules,
  loading = false,
  focusId,
  busy,
  busyKind,
  noticeId,
  error,
  saved,
  onPay,
  onVerify,
  onCancel,
  onRebook,
  onBook,
}) {
  const [filter, setFilter] = useState('all')
  const current = bookings.filter((row) => GUEST_ACTIVE_STATUSES.includes(row.status))
  const past = bookings.filter((row) => !GUEST_ACTIVE_STATUSES.includes(row.status))
  const shown = past.filter(PAST_FILTERS.find((item) => item.id === filter).match)

  if (loading) {
    return (
      <div className="resv">
        <div className="skeleton skeleton-card" style={{ minHeight: 300 }} />
        <div className="skeleton skeleton-card" style={{ minHeight: 120 }} />
      </div>
    )
  }

  return (
    <div className="resv">
      <section className="resv-section">
        <div className="resv-head">
          <h2>Current booking</h2>
          <span>{current.length ? 'One booking at a time' : 'Nothing booked'}</span>
        </div>
        {current.length === 0 ? (
          <div className="resv-empty">
            <div>
              <b>No stay on the calendar yet</b>
              <p>Pick a package and a date, pay the 50% downpayment, and your booking shows up here with everything you need for check-in.</p>
            </div>
            <button type="button" className="resv-primary" onClick={onBook}>
              Book a stay
            </button>
          </div>
        ) : (
          current.map((booking) => (
            <ActiveCard
              key={booking.id}
              booking={booking}
              catalog={catalog}
              rules={rules}
              focus={booking.id === focusId}
              busy={busy}
              busyKind={busyKind}
              notice={
                (error || saved) && noticeId === booking.id
                  ? { tone: error ? 'error' : 'ok', text: error || saved }
                  : null
              }
              onPay={onPay}
              onVerify={onVerify}
              onCancel={onCancel}
              onRebook={onRebook}
            />
          ))
        )}
      </section>

      <section className="resv-section">
        <div className="resv-head">
          <h2>Past stays</h2>
          {past.length ? (
            <div className="resv-filters" role="tablist" aria-label="Filter past stays">
              {PAST_FILTERS.map((item) => {
                const count = past.filter(item.match).length
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    className={filter === item.id ? 'on' : ''}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                    <i>{count}</i>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        {past.length === 0 ? (
          <p className="resv-none">Finished, cancelled and expired bookings are kept here.</p>
        ) : shown.length === 0 ? (
          <p className="resv-none">Nothing in this group.</p>
        ) : (
          <ul className="resv-history">
            {shown.map((row) => {
              const paid = verifiedPaid(row)
              return (
                <li key={row.id} className={row.id === focusId ? 'focus' : ''}>
                  <span className="resv-history-date">
                    <b>{new Date(`${row.stay_date}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</b>
                    <small>{row.stay_date.slice(0, 4)}</small>
                  </span>
                  <span className="resv-history-main">
                    <b>{row.package_label}</b>
                    <small>
                      {row.reference} · {row.pax} pax
                      {row.rejection_reason ? ` · ${row.rejection_reason}` : ''}
                      {row.status === 'no_show' && Number(row.credit_held) > 0 ? ` · ${peso(row.credit_held)} held as credit` : ''}
                    </small>
                  </span>
                  <span className="resv-history-paid">
                    <b>{peso(paid)}</b>
                    <small>{paid > 0 ? 'paid' : 'not charged'}</small>
                  </span>
                  <span className={`resv-status small status-${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
