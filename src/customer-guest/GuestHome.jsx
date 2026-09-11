import { Panel } from '../shared/RoleLayout'
import { CountdownPill } from '../shared/Countdown'
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

const MS_PER_DAY = 86400000

function startOfStay(booking) {
  return new Date(`${booking.stay_date}T00:00:00+08:00`)
}

function daysUntil(booking) {
  const today = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })}T00:00:00+08:00`)
  return Math.round((startOfStay(booking) - today) / MS_PER_DAY)
}

/** Stat row, next-stay card, payment summary and partner caterers. */
export default function GuestHome({ bookings, catalog, reviewedCount, onPay, onView, busyId, busyKind }) {
  const active = bookings.find((row) => GUEST_ACTIVE_STATUSES.includes(row.status))
  const completed = bookings.filter((row) => row.status === 'completed')
  const totalSpent = bookings.reduce((sum, row) => sum + verifiedPaid(row), 0)

  const countdown = active ? daysUntil(active) : null
  const nextLabel =
    countdown === null
      ? 'None booked'
      : countdown > 1
        ? `${countdown} days`
        : countdown === 1
          ? 'Tomorrow'
          : countdown === 0
            ? 'Today'
            : 'In progress'

  const partners = (catalog?.caterers || []).filter((row) => row.is_partner)

  const bill = active ? Number(active.override_amount ?? active.total_amount) : 0
  const paid = active ? verifiedPaid(active) : 0
  const balance = Math.max(bill - paid, 0)
  const payments = (active?.payments || []).filter((row) => row.status === 'paid')

  return (
    <>
      <section className="journey-band">
        <div className="band-head">
          <div>
            <p className="band-kicker">Your CK Resort</p>
            <h3>Stay summary</h3>
          </div>
        </div>
        <div className="journey-grid">
          <div className="journey-tile">
            <span className="journey-label">Next stay</span>
            <strong>{nextLabel}</strong>
            <small>{active ? active.reference : 'Nothing booked yet'}</small>
          </div>
          <div className="journey-tile">
            <span className="journey-label">Visits</span>
            <strong>{completed.length}</strong>
            <small>Completed stays</small>
          </div>
          <div className="journey-tile">
            <span className="journey-label">Total spent</span>
            <strong>{peso(totalSpent)}</strong>
            <small>Verified payments</small>
          </div>
          <div className="journey-tile">
            <span className="journey-label">Ratings given</span>
            <strong>{reviewedCount}</strong>
            <small>Thanks for the feedback</small>
          </div>
        </div>
      </section>

      {active ? (
        <div className="grid-2 home-split">
          <Panel title="Your next stay" className="next-stay">
            <div className="next-stay-head">
              <div>
                <b>{active.reference}</b>
                <small>{active.package_label}</small>
              </div>
              <span className={`pill ${active.status === 'confirmed' ? 'ok' : 'warn'}`}>
                {STATUS_LABELS[active.status] || active.status}
              </span>
            </div>

            {active.status === 'checked_in' ? (
              <CountdownPill until={stayEndsAt(active)} label="Checkout in" doneLabel="Checking out…" />
            ) : countdown !== null && countdown >= 0 ? (
              <CountdownPill until={startOfStay(active)} label="Arrival in" doneLabel="Today is the day" />
            ) : null}

            <dl className="stay-details">
              <div>
                <dt>Date</dt>
                <dd>{prettyDate(active.stay_date)}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{stayWindowLabel(active)}</dd>
              </div>
              <div>
                <dt>Guests</dt>
                <dd>{active.actual_pax || active.pax} pax</dd>
              </div>
            </dl>

            <div className="action-row">
              <button type="button" className="ghost" onClick={onView}>
                View reservation
              </button>
              {active.status === 'awaiting_downpayment' ? (
                <button
                  type="button"
                  className="book-btn"
                  disabled={Boolean(busyId)}
                  onClick={() => onPay(active)}
                >
                  {busyKind === 'pay' && busyId === active.id
                    ? 'Opening PayMongo…'
                    : `Pay ${peso(active.downpayment_amount)}`}
                </button>
              ) : null}
            </div>
          </Panel>

          <Panel title="Payment summary" className="pay-summary">
            <ul className="ticket-lines">
              <li>
                <span>Total bill</span>
                <b>{peso(bill)}</b>
              </li>
              <li>
                <span>Paid so far</span>
                <b>{peso(paid)}</b>
              </li>
              <li className="ticket-subtotal">
                <span>{balance > 0 ? 'Remaining balance' : 'Fully settled'}</span>
                <b>{peso(balance)}</b>
              </li>
            </ul>
            <div className="pay-meter" aria-hidden="true">
              <span style={{ width: `${bill ? Math.min((paid / bill) * 100, 100) : 0}%` }} />
            </div>
            <p className="hint">
              {balance > 0
                ? 'The remaining balance is settled at the front desk on arrival.'
                : 'Nothing left to pay. See you at the resort.'}
            </p>
            {payments.length ? (
              <ul className="list receipt-mini">
                {payments.map((row) => (
                  <li key={row.id}>
                    <div>
                      <b>{row.receipt_no || 'Receipt'}</b>
                      <small>
                        {row.method} · {prettyDateTime(row.paid_at)}
                      </small>
                    </div>
                    <span className="pill">{peso(row.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {partners.length ? (
        <section className="caterer-band">
          <div className="band-head">
            <div>
              <p className="band-kicker">No corkage fee</p>
              <h3>Partner caterers</h3>
            </div>
            <span className="band-note">Outside catering adds ₱1,500 minimum</span>
          </div>
          <ul className="caterer-grid">
            {partners.map((row) => (
              <li key={row.id}>
                <span className="caterer-mark" aria-hidden="true">
                  {row.name.charAt(0)}
                </span>
                {row.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
