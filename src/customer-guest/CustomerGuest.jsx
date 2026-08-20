import { useEffect, useState } from 'react'
import { Panel, RoleLayout, Stat } from '../shared/RoleLayout'
import { Lightbox } from '../shared/motion'
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

const PACKAGES = [
  { id: 'day', label: 'Day tour from', hint: '20 pax · 8:00 AM – 4:00 PM', rateKey: 'day' },
  { id: 'night', label: 'Night tour from', hint: '20 pax · 5:00 PM – 12:00 AM', rateKey: 'night' },
  { id: 'overnight', label: 'Overnight from', hint: '10 pax · 22 hours', rateKey: 'overnight' },
  { id: 'event', label: 'Event from', hint: 'Day event · max 50 pax', rateKey: 'event' },
]

export default function CustomerGuest({ session, onSignOut }) {
  const [active, setActive] = useState('Home')
  const [initialPackage, setInitialPackage] = useState('day')
  const [catalog, setCatalog] = useState(null)
  const [bookings, setBookings] = useState([])
  const [notes, setNotes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)

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

  function openBooking(tourType = 'day') {
    setInitialPackage(tourType)
    setActive('Book a stay')
  }

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

  const prices = {
    day: catalog?.rates.find((row) => row.key === 'day_20')?.amount || 6000,
    night: catalog?.rates.find((row) => row.key === 'night_20')?.amount || 7000,
    overnight: catalog?.overnight?.[0]?.amount || 12000,
    event: catalog?.events?.[0]?.day_amount || 10000,
  }

  return (
    <>
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
            {PACKAGES.map((item) => (
              <Stat
                key={item.id}
                label={item.label}
                value={peso(prices[item.rateKey])}
                hint={`${item.hint} · Tap to book`}
                onClick={() => openBooking(item.id)}
              />
            ))}
          </div>
          <div className="grid-2 home-split">
            <Panel title="Guest booking" className="booking-intro">
              <p className="note">
                Pick a package and date, add rooms, then rentals and catering. A 50% downpayment is due only after the
                manager approves your request.
              </p>
              <button type="button" className="book-btn" onClick={() => openBooking('day')}>
                Start booking
              </button>
            </Panel>
            <Panel title="Rates" className="rates-panel">
              <div className="rates-glow" aria-hidden="true" />
              <div className="flyers">
                <button
                  type="button"
                  className="flyer-hit"
                  onClick={() =>
                    setPreview({
                      src: '/flyers/packages.png',
                      alt: 'CK Resort packages and prices',
                      caption: 'Packages & rates',
                    })
                  }
                >
                  <img src="/flyers/packages.png" alt="CK Resort packages and prices" />
                </button>
                <button
                  type="button"
                  className="flyer-hit"
                  onClick={() =>
                    setPreview({
                      src: '/flyers/charges.png',
                      alt: 'CK Resort other charges and catering',
                      caption: 'Other charges & catering',
                    })
                  }
                >
                  <img src="/flyers/charges.png" alt="CK Resort other charges and catering" />
                </button>
              </div>
            </Panel>
          </div>
        </>
      )}

      {active === 'Book a stay' && (
        <BookingFlow
          key={initialPackage}
          initialTourType={initialPackage}
          onDone={() => {
            setActive('My reservations')
            reload()
          }}
        />
      )}

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
    {preview ? (
      <Lightbox
        src={preview.src}
        alt={preview.alt}
        caption={preview.caption}
        onClose={() => setPreview(null)}
      />
    ) : null}
    </>
  )
}
