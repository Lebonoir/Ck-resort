import { useEffect, useMemo, useState } from 'react'
import { useConfirm } from '../shared/ConfirmDialog'
import { approveBooking, cancelBooking, rejectBooking } from '../lib/api'
import {
  peso,
  prettyDate,
  prettyDateTime,
  rpcError,
  STATUS_LABELS,
  statusTone,
  stayWindowLabel,
  verifiedPaid,
} from '../lib/format'

const QUEUES = [
  { id: 'confirmed', label: 'Confirmed', statuses: ['confirmed'] },
  { id: 'awaiting', label: 'Awaiting payment', statuses: ['awaiting_downpayment', 'pending_approval'] },
  { id: 'stay', label: 'On property', statuses: ['checked_in', 'checked_out'] },
  { id: 'closed', label: 'Closed', statuses: ['completed', 'cancelled', 'rejected', 'expired', 'no_show'] },
]

function queueOf(status) {
  return QUEUES.find((queue) => queue.statuses.includes(status))?.id || 'closed'
}

// Short pill text; the full label for an unpaid hold is too long for a list row.
function pillLabel(status) {
  if (status === 'awaiting_downpayment') return 'Unpaid'
  if (status === 'pending_approval') return 'Pending'
  return STATUS_LABELS[status] || status
}

// The stored label carries the head count ("Day Tour · 20 pax"); pax has its own field.
function packageName(row) {
  return String(row.package_label || row.tour_type).replace(/\s*·\s*\d+\s*pax\b/i, '')
}

/**
 * Reservations: one queue at a time on the left, the selected booking's money
 * and stay details on the right. Approve/reject only shows for old-flow
 * bookings that still wait for approval.
 */
export default function ReservationsPanel({
  bookings,
  selectedId,
  onSelect,
  onReload,
  busy,
  setBusy,
  error,
  saved,
  setError,
  setSaved,
}) {
  const confirm = useConfirm()
  const item = bookings.find((row) => row.id === selectedId)
  const [queue, setQueue] = useState(() => (item ? queueOf(item.status) : 'confirmed'))
  const [query, setQuery] = useState('')
  const [override, setOverride] = useState('')
  const [reason, setReason] = useState('')

  const counts = useMemo(() => {
    const map = Object.fromEntries(QUEUES.map((entry) => [entry.id, 0]))
    for (const row of bookings) map[queueOf(row.status)] += 1
    return map
  }, [bookings])

  // Follow the selected booking when an action moves it to another queue.
  useEffect(() => {
    if (item) setQueue(queueOf(item.status))
  }, [item?.id, item?.status])

  useEffect(() => {
    setOverride('')
    setReason('')
  }, [selectedId])

  const needle = query.trim().toLowerCase()
  const rows = bookings.filter((row) => {
    if (needle) {
      return [row.guest_name, row.reference, row.guest_contact].some((value) =>
        String(value || '').toLowerCase().includes(needle),
      )
    }
    return queueOf(row.status) === queue
  })

  async function run(kind, action, message) {
    setError('')
    setSaved('')
    setBusy(kind)
    try {
      await action()
      setSaved(message)
      await onReload()
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function cancel() {
    const kept = verifiedPaid(item)
    const ok = await confirm({
      title: 'Cancel reservation',
      message: `Cancel ${item.reference} for ${item.guest_name}? ${kept > 0 ? `The ${peso(kept)} downpayment is kept.` : 'No payment was collected.'}`,
      confirmLabel: 'Cancel reservation',
      danger: true,
    })
    if (ok) run('cancel', () => cancelBooking(item.id), `${item.reference} cancelled.`)
  }

  async function approve() {
    const ok = await confirm({
      title: 'Approve reservation',
      message: `Approve ${item.reference} for ${item.guest_name}? The guest will be asked to pay a 50% downpayment.`,
      confirmLabel: 'Approve',
    })
    if (ok) {
      run(
        'approve',
        () => approveBooking(item.id, override ? Number(override) : null),
        `${item.reference} approved. Guest can now pay 50%.`,
      )
    }
  }

  async function reject() {
    const ok = await confirm({
      title: 'Reject reservation',
      message: `Reject ${item.reference}? The guest will be notified.`,
      confirmLabel: 'Reject',
      danger: true,
    })
    if (ok) run('reject', () => rejectBooking(item.id, reason || 'Slot not available'), `${item.reference} rejected.`)
  }

  const total = item ? Number(item.override_amount || item.total_amount) || 0 : 0
  const paid = item ? verifiedPaid(item) : 0
  const balance = Math.max(total - paid, 0)
  const charges = item?.booking_charges || []

  return (
    <div className="admin-split res-split">
      <section className="admin-card">
        <div className="res-head">
          <h3>Bookings</h3>
          <span className="admin-note">{bookings.length} total</span>
        </div>
        <label className="res-search">
          <span>Search all bookings</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Guest, reference or contact"
          />
        </label>
        {needle ? (
          <p className="admin-note">
            {rows.length} {rows.length === 1 ? 'match' : 'matches'} across every queue
          </p>
        ) : (
          <div className="res-tabs" role="tablist" aria-label="Booking queues">
            {QUEUES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={queue === entry.id}
                className={queue === entry.id ? 'on' : ''}
                onClick={() => setQueue(entry.id)}
              >
                {entry.label}
                <span>{counts[entry.id]}</span>
              </button>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="res-empty">
            {needle
              ? 'No booking matches that search.'
              : queue === 'awaiting'
                ? 'No unpaid holds. New bookings wait here until the 50% is paid.'
                : queue === 'stay'
                  ? 'No guests on property right now.'
                  : queue === 'confirmed'
                    ? 'No confirmed bookings waiting to arrive.'
                    : 'No closed bookings yet.'}
          </p>
        ) : (
          <ul className="res-list">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === selectedId ? 'on' : ''}
                  aria-current={row.id === selectedId}
                  onClick={() => {
                    if (row.id !== selectedId) setError('')
                    onSelect(row.id)
                  }}
                >
                  <span className="res-who">
                    <b>{row.guest_name}</b>
                    <small>
                      {row.reference} · {packageName(row)} · {row.pax} pax
                    </small>
                  </span>
                  <span className="res-when">
                    <span>{prettyDate(row.stay_date)}</span>
                    <i className={`pill ${statusTone(row.status)}`}>{pillLabel(row.status)}</i>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {item ? (
        <section className="admin-card res-detail">
          <header className="res-detail-head">
            <div>
              <h3>{item.guest_name}</h3>
              <p className="admin-note">
                {item.reference}
                {item.is_walk_in ? ' · Walk-in' : ''} · booked {prettyDateTime(item.created_at)}
              </p>
            </div>
            <span className={`pill ${statusTone(item.status)}`}>{STATUS_LABELS[item.status] || item.status}</span>
          </header>

          <div className="res-money">
            <div className="res-money-top">
              <span>
                <small>Paid</small>
                <b>{peso(paid)}</b>
              </span>
              <span>
                <small>{balance > 0 ? 'Balance' : 'Total'}</small>
                <b>{peso(balance > 0 ? balance : total)}</b>
              </span>
            </div>
            <span className="analytics-track">
              <span className="analytics-fill" style={{ width: `${total > 0 ? Math.min((paid / total) * 100, 100) : 0}%` }} />
            </span>
            <p className="admin-note">
              {peso(total)} total · 50% downpayment {peso(item.downpayment_amount)}
              {item.override_amount ? ' · custom total' : ''}
            </p>
          </div>

          <dl className="res-facts">
            <div>
              <dt>Package</dt>
              <dd>{packageName(item)}</dd>
            </div>
            <div>
              <dt>Stay date</dt>
              <dd>{prettyDate(item.stay_date)}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{stayWindowLabel(item)}</dd>
            </div>
            <div>
              <dt>Guests</dt>
              <dd>
                {item.pax} pax{item.pets > 0 ? ` · ${item.pets} ${item.pets === 1 ? 'pet' : 'pets'}` : ''}
              </dd>
            </div>
            {item.guest_contact ? (
              <div>
                <dt>Contact</dt>
                <dd>{item.guest_contact}</dd>
              </div>
            ) : null}
            {item.payment_due_at && item.status === 'awaiting_downpayment' ? (
              <div>
                <dt>Pay by</dt>
                <dd>{prettyDateTime(item.payment_due_at)}</dd>
              </div>
            ) : null}
            {Number(item.credit_held) > 0 ? (
              <div>
                <dt>Credit held</dt>
                <dd>{peso(item.credit_held)}</dd>
              </div>
            ) : null}
            {item.original_stay_date ? (
              <div>
                <dt>Rebooked from</dt>
                <dd>{prettyDate(item.original_stay_date)}</dd>
              </div>
            ) : null}
            {item.rejection_reason ? (
              <div>
                <dt>Rejection reason</dt>
                <dd>{item.rejection_reason}</dd>
              </div>
            ) : null}
          </dl>

          {charges.length ? (
            <div className="res-charges">
              <h4>Added charges</h4>
              <ul>
                {charges.map((row) => (
                  <li key={row.id}>
                    <span>{row.description}</span>
                    <b>{peso(row.amount)}</b>
                    <i className={`pill ${row.payment_id ? 'ok' : 'warn'}`}>{row.payment_id ? 'Settled' : 'Unpaid'}</i>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {item.status === 'pending_approval' ? (
            <div className="res-approve">
              <label>
                Custom total (optional)
                <input
                  type="number"
                  min="0"
                  value={override}
                  onChange={(event) => setOverride(event.target.value)}
                  placeholder={String(item.total_amount)}
                />
              </label>
              <label>
                Rejection reason
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional note" />
              </label>
              <div className="action-row">
                <button type="button" className="book-btn" disabled={Boolean(busy)} onClick={approve}>
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button type="button" className="desk-ghost" disabled={Boolean(busy)} onClick={reject}>
                  {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            </div>
          ) : null}

          {['awaiting_downpayment', 'confirmed'].includes(item.status) ? (
            <footer className="res-foot">
              <p className="admin-note">
                {item.status === 'confirmed'
                  ? 'Cancelling keeps the downpayment: it is not refundable.'
                  : 'This hold releases itself if the downpayment is not paid in time.'}
              </p>
              <button type="button" className="res-cancel" disabled={Boolean(busy)} onClick={cancel}>
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel reservation'}
              </button>
            </footer>
          ) : null}

          {error || saved ? <p className={`flash inline-flash ${error ? 'error' : 'ok'}`}>{error || saved}</p> : null}
        </section>
      ) : (
        <section className="admin-card res-detail">
          <h3>No booking selected</h3>
          <p className="admin-note">Pick a booking on the left to see its payments, stay details and actions.</p>
        </section>
      )}
    </div>
  )
}
