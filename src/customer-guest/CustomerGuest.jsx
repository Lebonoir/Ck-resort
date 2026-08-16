import { useEffect, useState } from 'react'
import { Panel, RoleLayout, Stat } from '../shared/RoleLayout'
import BookingFlow from './BookingFlow'
import {
  cancelBooking,
  getCatalog,
  listBookings,
  listNotifications,
  markNotificationRead,
  startDownpayment,
  verifyDownpayment,
} from '../lib/api'
import { peso, prettyDate, rpcError, STATUS_LABELS } from '../lib/format'
import './booking.css'

const NAV = ['Home', 'Book a stay', 'My reservations', 'Notifications']

export default function CustomerGuest({ session, onSignOut }) {
  const [active, setActive] = useState('Home')
  const [catalog, setCatalog] = useState(null)
  const [bookings, setBookings] = useState([])
  const [notes, setNotes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function reload() {
    try {
      const [nextCatalog, nextBookings, nextNotes] = await Promise.all([
        getCatalog(),
        listBookings(),
        listNotifications(),
      ])
      setCatalog(nextCatalog)
      setBookings(nextBookings)
      setNotes(nextNotes)
    } catch (err) {
      setError(rpcError(err))
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function pay(booking) {
    setBusy(booking.id)
    setError('')
    try {
      const { checkoutUrl } = await startDownpayment(booking.id)
      window.location.href = checkoutUrl
    } catch (err) {
      setError(rpcError(err))
      setBusy('')
    }
  }

  async function verify(booking) {
    setBusy(booking.id)
    setError('')
    try {
      const result = await verifyDownpayment(booking.id)
      if (!result.paid) setError('Payment is not completed yet. Finish checkout, then tap Verify.')
      await reload()
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  const day = catalog?.rates.find((row) => row.key === 'day_20')?.amount || 6000
  const night = catalog?.rates.find((row) => row.key === 'night_20')?.amount || 7000
  const overnight = catalog?.overnight?.[0]?.amount || 12000
  const eventRate = catalog?.events?.[0]?.day_amount || 10000

  return (
    <RoleLayout
      roleId="guest"
      name={session.name}
      nav={NAV}
      active={active}
      onNav={setActive}
      onSignOut={onSignOut}
      unread={notes.filter((item) => !item.is_read).length}
    >
      {error ? <p className="flash error">{error}</p> : null}

      {active === 'Home' && (
        <>
          <div className="stats">
            <Stat label="Day tour from" value={peso(day)} hint="20 pax · 8:00 AM – 4:00 PM" />
            <Stat label="Night tour from" value={peso(night)} hint="20 pax · 5:00 PM – 12:00 AM" />
            <Stat label="Overnight from" value={peso(overnight)} hint="10 pax · 22 hours" />
            <Stat label="Event from" value={peso(eventRate)} hint="Day event · max 50 pax" />
          </div>
          <div className="grid-2">
            <Panel title="Guest booking">
              <p className="note">
                Pick a package and date, add rooms, then rentals and catering. A 50% downpayment is due only after the
                manager approves your request.
              </p>
              <button type="button" className="book-btn" onClick={() => setActive('Book a stay')}>
                Start booking
              </button>
            </Panel>
            <Panel title="Rates">
              <div className="flyers">
                <img src="/flyers/packages.png" alt="CK Resort packages and prices" />
                <img src="/flyers/charges.png" alt="CK Resort other charges and catering" />
              </div>
            </Panel>
          </div>
        </>
      )}

      {active === 'Book a stay' && <BookingFlow onDone={() => { setActive('My reservations'); reload() }} />}

      {active === 'My reservations' && (
        <Panel title="Your bookings">
          {bookings.length === 0 ? <p className="note">No reservations yet.</p> : null}
          <ul className="list">
            {bookings.map((item) => (
              <li key={item.id}>
                <div>
                  <b>
                    {item.reference} · {item.package_label}
                  </b>
                  <small>
                    {prettyDate(item.stay_date)} · {item.pax} pax · {peso(item.override_amount || item.total_amount)}
                  </small>
                  {item.rejection_reason ? <small>{item.rejection_reason}</small> : null}
                  {item.status === 'awaiting_downpayment' ? (
                    <div className="action-row">
                      <button type="button" className="book-btn" disabled={busy === item.id} onClick={() => pay(item)}>
                        {busy === item.id ? 'Opening PayMongo…' : `Pay ${peso(item.downpayment_amount)}`}
                      </button>
                      <button type="button" className="ghost" onClick={() => verify(item)}>
                        I already paid
                      </button>
                    </div>
                  ) : null}
                  {['pending_approval', 'awaiting_downpayment'].includes(item.status) ? (
                    <button
                      type="button"
                      className="text-link"
                      onClick={async () => {
                        if (!window.confirm('Cancel this booking?')) return
                        try {
                          await cancelBooking(item.id)
                          await reload()
                        } catch (err) {
                          setError(rpcError(err))
                        }
                      }}
                    >
                      Cancel request
                    </button>
                  ) : null}
                </div>
                <span className={`pill status-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {active === 'Notifications' && (
        <Panel title="Updates">
          <ul className="list">
            {notes.length === 0 ? <li className="empty-row">No notifications yet.</li> : null}
            {notes.map((item) => (
              <li key={item.id}>
                <div>
                  <b>{item.title}</b>
                  <small>{item.body}</small>
                </div>
                {!item.is_read ? (
                  <button
                    type="button"
                    className="desk-ghost"
                    onClick={async () => {
                      await markNotificationRead(item.id)
                      await reload()
                    }}
                  >
                    Mark read
                  </button>
                ) : (
                  <span className="pill">Read</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </RoleLayout>
  )
}
