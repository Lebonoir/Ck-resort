import { useEffect, useRef, useState } from 'react'
import { ActionToast, BellIcon, Panel, RoleLayout } from '../shared/RoleLayout'
import { Lightbox } from '../shared/motion'
import BookingFlow from './BookingFlow'
import RatingsPanel from './RatingsPanel'
import GuestHome from './GuestHome'
import { useLiveData } from '../shared/useLiveData'
import { CountdownPill } from '../shared/Countdown'
import { FolderList } from '../shared/FolderList'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  cancelBooking,
  deleteNotification,
  getActiveBooking,
  getCatalog,
  listBookings,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  reviewableStays,
  startDownpayment,
  verifyDownpayment,
} from '../lib/api'
import {
  GUEST_ACTIVE_STATUSES,
  paymentStatusLabel,
  peso,
  prettyDate,
  prettyDateTime,
  rpcError,
  STATUS_LABELS,
  stayEndsAt,
  stayWindowLabel,
} from '../lib/format'
import './booking.css'

const NAV = [
  { section: 'Stay', items: ['Home', 'Book a stay'] },
  { section: 'Account', items: ['My reservations', 'Ratings'] },
]

const PACKAGES = [
  { id: 'day', label: 'Day tour from', hint: '20 pax · 8:00 AM – 4:00 PM', rateKey: 'day' },
  { id: 'night', label: 'Night tour from', hint: '20 pax · 5:00 PM – 12:00 AM', rateKey: 'night' },
  { id: 'overnight', label: 'Overnight from', hint: '10 pax · 22 hours', rateKey: 'overnight' },
  { id: 'event', label: 'Event from', hint: 'Day event · max 50 pax', rateKey: 'event' },
]

function roomSummary(booking, catalog) {
  if (Array.isArray(booking.rooms) && booking.rooms.length && typeof booking.rooms[0] === 'string') {
    return booking.rooms.join(', ')
  }
  const ids = (booking.booking_rooms || []).map((row) => row.room_unit_id)
  const names = (catalog?.units || [])
    .filter((unit) => ids.includes(unit.id))
    .map((unit) => {
      const room = catalog?.rooms?.find((item) => item.id === unit.room_id)
      return `${room?.name || ''} ${unit.name}`.trim()
    })
    .filter(Boolean)
  return names.length ? names.join(', ') : 'None selected'
}

function addOnSummary(booking, catalog) {
  const bits = []
  if (Array.isArray(booking.rental_items) && booking.rental_items.length) {
    bits.push(booking.rental_items.map((item) => `${item.name} × ${item.qty}`).join(', '))
  } else {
    for (const row of booking.booking_rentals || []) {
      const item = catalog?.rentals?.find((rental) => rental.id === row.rental_id)
      bits.push(`${item?.name || 'Rental'} × ${row.qty}`)
    }
  }
  if (Number(booking.pets) > 0) bits.push(`Pets × ${booking.pets}`)
  for (const row of booking.booking_charges || []) bits.push(row.description)
  return bits.length ? bits.join(' · ') : 'None'
}

function NotificationBell({ notes, onRead, onReadAll, onDelete }) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const unread = notes.filter((item) => !item.is_read)
  const earlier = notes.filter((item) => item.is_read)

  useEffect(() => {
    function onPointer(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    if (!open) return undefined
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="bell-btn"
        aria-label={unread.length ? `${unread.length} unread notifications` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon />
        {unread.length ? <span className="bell-dot">{unread.length > 9 ? '9+' : unread.length}</span> : null}
      </button>
      {open ? (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-panel-head">
            <h2>Notifications</h2>
            {unread.length ? (
              <button type="button" onClick={() => onReadAll()}>
                Mark all as read
              </button>
            ) : null}
          </div>
          <FolderList
            empty="No notifications yet."
            groups={[
              { id: 'unread', label: 'Unread', items: unread, defaultOpen: true },
              { id: 'earlier', label: 'Earlier', items: earlier, defaultOpen: unread.length === 0 },
            ]}
            renderItem={(item) => (
              <li key={item.id}>
                <div>
                  <b>{item.title}</b>
                  <small>{item.body}</small>
                </div>
                <div className="action-row">
                  {!item.is_read ? (
                    <button type="button" className="desk-ghost" onClick={() => onRead(item.id)}>
                      Read
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="text-link danger"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete notification',
                        message: 'Remove this notification from your list?',
                        confirmLabel: 'Delete',
                        danger: true,
                      })
                      if (ok) onDelete(item.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )}
          />
        </div>
      ) : null}
    </div>
  )
}

function ActiveStay({ booking, catalog, onView }) {
  const total = Number(booking.override_amount ?? booking.total_amount)
  return (
    <div className="stay-card">
      <p className="stay-kicker">You already have a reservation</p>
      <h2>{booking.reference}</h2>
      <p className="note">A new booking can be made after this one is completed, cancelled, rejected, expired, or marked no-show.</p>
      <dl className="stay-details">
        <div>
          <dt>Package</dt>
          <dd>{booking.package_label}</dd>
        </div>
        <div>
          <dt>Date and time</dt>
          <dd>
            {prettyDate(booking.stay_date)} · {stayWindowLabel(booking)}
          </dd>
        </div>
        <div>
          <dt>Guests</dt>
          <dd>{booking.actual_pax || booking.pax} pax</dd>
        </div>
        <div>
          <dt>Rooms</dt>
          <dd>{roomSummary(booking, catalog)}</dd>
        </div>
        <div>
          <dt>Add-ons</dt>
          <dd>{addOnSummary(booking, catalog)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{peso(total)}</dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>{paymentStatusLabel(booking)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[booking.status] || booking.status}</dd>
        </div>
        {booking.status === 'checked_in' ? (
          <div>
            <dt>Time left</dt>
            <dd>
              <CountdownPill
                until={stayEndsAt(booking)}
                label="Checkout in"
                doneLabel="Checking out…"
              />
            </dd>
          </div>
        ) : null}
      </dl>
      <button type="button" className="book-btn" onClick={onView}>
        View reservation
      </button>
    </div>
  )
}

export default function CustomerGuest({ session, onSignOut }) {
  const confirm = useConfirm()
  const [active, setActive] = useState('Home')
  const [initialPackage, setInitialPackage] = useState('day')
  const [catalog, setCatalog] = useState(null)
  const [bookings, setBookings] = useState([])
  const [notes, setNotes] = useState([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [focusId, setFocusId] = useState('')
  const [noticeId, setNoticeId] = useState('')
  const [activeStay, setActiveStay] = useState(null)
  const [reviewable, setReviewable] = useState([])

  async function reload() {
    try {
      const [nextCatalog, nextBookings, nextNotes, nextReviewable] = await Promise.all([
        getCatalog(),
        listBookings(),
        listNotifications(),
        reviewableStays(),
      ])
      setCatalog(nextCatalog)
      setBookings(nextBookings)
      setNotes(nextNotes)
      setReviewable(nextReviewable)
      const stay = nextBookings.find((row) => GUEST_ACTIVE_STATUSES.includes(row.status)) || null
      setActiveStay(stay)
      return nextBookings
    } catch (err) {
      setError(rpcError(err))
      return []
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // Status changes (approval, auto checkout, completion) arrive on their own.
  useLiveData(reload, { tables: ['bookings', 'notifications'], channel: 'guest' })

  useEffect(() => {
    if (active !== 'My reservations' || !focusId) return
    document.querySelector('.list li.focus')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [active, focusId])

  const currentStay = activeStay || bookings.find((row) => GUEST_ACTIVE_STATUSES.includes(row.status))

  function viewReservation(booking) {
    setFocusId(booking.id)
    setActive('My reservations')
  }

  async function openBooking(tourType = 'day') {
    setError('')
    let stay = bookings.find((row) => GUEST_ACTIVE_STATUSES.includes(row.status))
    try {
      const fromServer = await getActiveBooking()
      if (fromServer) stay = fromServer
      else if (!stay) {
        const rows = await reload()
        stay = rows.find((row) => GUEST_ACTIVE_STATUSES.includes(row.status))
      }
    } catch {
      // SQL may not be applied yet; fall back to loaded bookings.
    }
    if (stay) {
      setActiveStay(stay)
      setActive('Book a stay')
      return
    }
    setActiveStay(null)
    setInitialPackage(tourType)
    setActive('Book a stay')
  }

  async function pay(booking) {
    const ok = await confirm({
      title: 'Pay downpayment',
      message: `Open PayMongo to pay ${peso(booking.downpayment_amount)} for ${booking.reference}?`,
      confirmLabel: 'Continue to PayMongo',
    })
    if (!ok) return
    setBusy(`pay:${booking.id}`)
    setError('')
    setSaved('')
    setNoticeId(booking.id)
    try {
      const { checkoutUrl } = await startDownpayment(booking.id)
      setSaved('Opening PayMongo checkout…')
      // replace() instead of href= so the workspace is not left behind the
      // gateway in history — Back would otherwise land on PayMongo's receipt.
      window.location.replace(checkoutUrl)
    } catch (err) {
      setError(rpcError(err))
      setBusy('')
    }
  }

  async function verify(booking) {
    setBusy(`verify:${booking.id}`)
    setError('')
    setSaved('')
    setNoticeId(booking.id)
    try {
      const result = await verifyDownpayment(booking.id)
      if (!result.paid) {
        setError('Payment is not completed yet. Finish checkout, then tap Verify.')
      } else {
        setSaved(`${booking.reference} payment confirmed.`)
      }
      await reload()
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function cancel(booking) {
    const ok = await confirm({
      title: 'Cancel reservation',
      message: `Cancel ${booking.reference}? This cannot be undone.`,
      confirmLabel: 'Cancel reservation',
      danger: true,
    })
    if (!ok) return
    setBusy(`cancel:${booking.id}`)
    setError('')
    setSaved('')
    setNoticeId(booking.id)
    try {
      await cancelBooking(booking.id)
      setSaved(`${booking.reference} cancelled.`)
      await reload()
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  const busyKind = busy.includes(':') ? busy.split(':')[0] : ''
  const busyId = busy.includes(':') ? busy.slice(busy.indexOf(':') + 1) : busy

  // Completed stays that no longer appear in the unrated list have been rated.
  const reviewedCount = Math.max(
    bookings.filter((row) => row.status === 'completed').length - reviewable.length,
    0,
  )

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
      onNav={(item) => {
        if (item === 'Book a stay') {
          openBooking(initialPackage)
          return
        }
        setActive(item)
      }}
      onSignOut={onSignOut}
      unread={notes.filter((item) => !item.is_read).length}
      headerExtra={
        <NotificationBell
          notes={notes}
          onRead={async (id) => {
            await markNotificationRead(id)
            await reload()
          }}
          onReadAll={async () => {
            try {
              await markAllNotificationsRead()
              await reload()
            } catch (err) {
              setError(rpcError(err))
            }
          }}
          onDelete={async (id) => {
            try {
              await deleteNotification(id)
              await reload()
            } catch (err) {
              setError(rpcError(err))
            }
          }}
        />
      }
    >
      <ActionToast
        busy={Boolean(busy)}
        tone={error ? 'error' : 'ok'}
        message={
          busyKind === 'pay'
            ? 'Opening PayMongo…'
            : busyKind === 'verify'
              ? 'Checking payment…'
              : busyKind === 'cancel'
                ? 'Cancelling reservation…'
                : error || saved
        }
      />

      {active === 'Home' && (
        <>
          <section className="hero-band">
            <div className="hero-band-copy">
              <p className="band-kicker">Choose your escape</p>
              <h2>Book the pool, the cabanas, the whole place.</h2>
              <p className="band-lede">
                Pick a package and date, add rooms, then rentals and catering. A 50% downpayment is only due once the
                manager approves your request.
              </p>
            </div>
            <div className="pkg-grid">
              {PACKAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`pkg-card pkg-${item.id}`}
                  onClick={() => openBooking(item.id)}
                >
                  <span className="pkg-glow" aria-hidden="true" />
                  <span className="pkg-name">{item.label.replace(' from', '')}</span>
                  <span className="pkg-price">{peso(prices[item.rateKey])}</span>
                  <span className="pkg-hint">{item.hint}</span>
                  <span className="pkg-cta">Book this →</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rates-band">
            <div className="band-head">
              <div>
                <p className="band-kicker">Full price list</p>
                <h3>Rates &amp; other charges</h3>
              </div>
              <span className="band-note">Tap an image to enlarge</span>
            </div>
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
          </section>

          <GuestHome
            bookings={bookings}
            catalog={catalog}
            reviewedCount={reviewedCount}
            busyId={busyId}
            busyKind={busyKind}
            onPay={pay}
            onView={() => setActive('My reservations')}
          />
        </>
      )}

      {active === 'Book a stay' && (
        currentStay ? (
          <ActiveStay booking={currentStay} catalog={catalog} onView={() => viewReservation(currentStay)} />
        ) : (
          <BookingFlow
            key={initialPackage}
            initialTourType={initialPackage}
            onHasActive={(booking) => setActiveStay(booking)}
            onDone={() => {
              setActive('My reservations')
              reload()
            }}
          />
        )
      )}

      {active === 'Ratings' && (
        <RatingsPanel
          stays={reviewable}
          onDone={reload}
          onError={setError}
          onSaved={setSaved}
        />
      )}

      {active === 'My reservations' && (
        <Panel title="Your bookings">
          <FolderList
            empty="No reservations yet."
            groups={[
              {
                id: 'active',
                label: 'Active',
                items: bookings.filter((item) => GUEST_ACTIVE_STATUSES.includes(item.status)),
                defaultOpen: true,
              },
              {
                id: 'past',
                label: 'Past',
                items: bookings.filter((item) => !GUEST_ACTIVE_STATUSES.includes(item.status)),
                defaultOpen: !bookings.some((item) => GUEST_ACTIVE_STATUSES.includes(item.status)),
              },
            ]}
            renderItem={(item) => (
              <li key={item.id} className={item.id === focusId ? 'focus' : ''}>
                <div>
                  <b>
                    {item.reference} · {item.package_label}
                  </b>
                  <small>
                    {prettyDate(item.stay_date)} · {item.pax} pax · {peso(item.override_amount || item.total_amount)}
                  </small>
                  {item.rejection_reason ? <small>{item.rejection_reason}</small> : null}
                  {item.status === 'awaiting_downpayment' && item.payment_due_at ? (
                    <small>Pay by {prettyDateTime(item.payment_due_at)}</small>
                  ) : null}
                  {item.status === 'no_show' && Number(item.credit_held) > 0 ? (
                    <small>Downpayment held as credit: {peso(item.credit_held)}</small>
                  ) : null}
                  {item.status === 'awaiting_downpayment' ? (
                    <div className="action-row">
                      <button type="button" className="book-btn" disabled={Boolean(busy)} onClick={() => pay(item)}>
                        {busyKind === 'pay' && busyId === item.id
                          ? 'Opening PayMongo…'
                          : `Pay ${peso(item.downpayment_amount)}`}
                      </button>
                      <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => verify(item)}>
                        {busyKind === 'verify' && busyId === item.id ? 'Checking…' : 'I already paid'}
                      </button>
                    </div>
                  ) : null}
                  {['pending_approval', 'awaiting_downpayment'].includes(item.status) ? (
                    <button type="button" className="text-link" disabled={Boolean(busy)} onClick={() => cancel(item)}>
                      {busyKind === 'cancel' && busyId === item.id ? 'Cancelling…' : 'Cancel request'}
                    </button>
                  ) : null}
                  {(error || saved) && noticeId === item.id ? (
                    <p className={`flash inline-flash ${error ? 'error' : 'ok'}`}>{error || saved}</p>
                  ) : null}
                </div>
                <span className={`pill status-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
              </li>
            )}
          />
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
