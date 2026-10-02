import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionToast } from '../shared/RoleLayout'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  DEFAULT_BOOKING_RULES,
  getActiveBooking,
  getBookingRules,
  getCatalog,
  getClosedDates,
  getOccupiedDates,
  quoteBooking,
  startDownpayment,
  submitBooking,
} from '../lib/api'
import { peso, rpcError } from '../lib/format'
import { TweenNumber } from '../shared/motion'
import MonthCalendar, { addDaysIso, manilaTodayIso } from '../shared/MonthCalendar'
import './booking.css'

const STEPS = ['Package & date', 'Rooms', 'Rentals', 'Review']
export const TOUR_TYPES = [
  { id: 'day', label: 'Day Tour', hours: '8:00 AM – 4:00 PM' },
  { id: 'night', label: 'Night Tour', hours: '5:00 PM – 12:00 AM' },
  { id: 'overnight', label: 'Overnight Stay', hours: '22-hour stay' },
  { id: 'event', label: 'Event Package', hours: 'Day or night · sound system included' },
]
export const OVERNIGHT_SHIFTS = [
  { id: '9:00 AM – 7:00 AM', label: '9:00 AM – 7:00 AM' },
  { id: '2:00 PM – 12:00 NN', label: '2:00 PM – 12:00 NN' },
  { id: '6:00 PM – 4:00 PM', label: '6:00 PM – 4:00 PM' },
]

export function slotStartMs(iso, tour, shift, eventWhen) {
  let hour = 8
  if (tour === 'night' || (tour === 'event' && eventWhen === 'night')) hour = 17
  else if (tour === 'overnight') {
    if (String(shift || '').includes('2:00 PM')) hour = 14
    else if (String(shift || '').includes('6:00 PM')) hour = 18
    else hour = 9
  }
  return new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime()
}

export default function BookingFlow({
  onDone,
  onHasActive,
  initialTourType = 'day',
  initialBooking = null,
  initialStep = 0,
  // Guest mode: run the whole wizard without an account (rooms/rentals/rates
  // are public data). Submitting hands the built payload to onRequireAuth
  // instead of calling submitBooking, since that RPC needs a real session.
  guestMode = false,
  onRequireAuth = null,
  // Set once, right after auth, to resume a guest-built request: fires
  // submitBooking automatically instead of waiting for another click.
  autoSubmit = false,
}) {
  const confirm = useConfirm()
  const [step, setStep] = useState(initialStep)
  const [catalog, setCatalog] = useState(null)
  const [occupied, setOccupied] = useState([])
  const [closures, setClosures] = useState([])
  const [rules, setRules] = useState(DEFAULT_BOOKING_RULES)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(null)
  const [summary, setSummary] = useState({ lines: [], total: 0, downpayment: 0, package_label: '' })
  const [booking, setBooking] = useState({
    tour_type: initialTourType,
    stay_date: '',
    pax: initialTourType === 'overnight' ? 10 : 20,
    hours: 8,
    extra_hours: 0,
    overnight_shift: '9:00 AM – 7:00 AM',
    event_when: 'day',
    room_unit_ids: [],
    rentals: [],
    pets: 0,
    caterer_id: '',
    // Carries over the package/date/pax a guest already picked in the public
    // estimator (see GuestEstimator) so signing up doesn't throw that away.
    ...initialBooking,
  })

  const today = manilaTodayIso()

  useEffect(() => {
    let active = true
    getBookingRules()
      .then((next) => {
        if (!active) return
        setRules(next)
        const horizon = addDaysIso(today, next.max_advance_days)
        return Promise.all([
          getCatalog(),
          getOccupiedDates(today, horizon),
          getClosedDates(today, horizon),
          // getActiveBooking needs a real session — guests browsing pre-signup have none.
          guestMode ? Promise.resolve(null) : getActiveBooking(),
        ])
      })
      .then((result) => {
        if (!active || !result) return
        const [nextCatalog, dates, shut, stay] = result
        if (stay) {
          onHasActive?.(stay)
          return
        }
        setCatalog(nextCatalog)
        setOccupied(Array.isArray(dates) ? dates : [])
        setClosures(Array.isArray(shut) ? shut : [])
      })
      .catch((err) => setError(rpcError(err)))
    return () => {
      active = false
    }
  }, [])

  const payload = useMemo(
    () => ({
      ...booking,
      rentals: booking.rentals.filter((item) => item.qty > 0),
      caterer_id: booking.caterer_id || null,
    }),
    [booking],
  )

  useEffect(() => {
    if (!booking.stay_date) return undefined
    const timer = setTimeout(() => {
      quoteBooking(payload)
        .then(setSummary)
        .catch((err) => setError(rpcError(err)))
    }, 200)
    return () => clearTimeout(timer)
  }, [payload, booking.stay_date])

  const blocked = useMemo(() => {
    const slotsNeeded =
      booking.tour_type === 'overnight'
        ? ['day', 'night']
        : booking.tour_type === 'night' || (booking.tour_type === 'event' && booking.event_when === 'night')
          ? ['night']
          : ['day']
    const set = new Set()
    occupied.forEach((row) => {
      if (row.slots?.some((slot) => slotsNeeded.includes(slot))) set.add(row.date)
    })
    return set
  }, [occupied, booking.tour_type, booking.event_when])

  const closed = useMemo(() => new Map(closures.map((row) => [row.date, row.reason])), [closures])
  const maxDate = useMemo(() => addDaysIso(today, rules.max_advance_days), [today, rules.max_advance_days])
  const maxPax = rules.max_pax?.[booking.tour_type] ?? 150
  const maxExtraHours = rules.max_extra_hours

  // A slot must still be at least `min_lead_hours` away to be bookable.
  const tooSoon = useMemo(() => {
    const leadMs = rules.min_lead_hours * 3600 * 1000
    return (iso) =>
      slotStartMs(iso, booking.tour_type, booking.overnight_shift, booking.event_when) - leadMs < Date.now()
  }, [rules.min_lead_hours, booking.tour_type, booking.overnight_shift, booking.event_when])

  const dayState = useMemo(
    () => (iso) => {
      if (closed.has(iso)) {
        return { className: 'shut', disabled: true, title: `Resort closed · ${closed.get(iso) || 'closed'}` }
      }
      if (blocked.has(iso)) {
        return { className: 'busy', disabled: true, title: 'That slot is already booked' }
      }
      if (tooSoon(iso)) {
        return { className: 'past', disabled: true, title: 'Too close to the start time' }
      }
      return {}
    },
    [closed, blocked, tooSoon],
  )

  // Switching package can pull the current picks outside the new limits.
  useEffect(() => {
    const fixes = {}
    if (booking.pax > maxPax) fixes.pax = maxPax
    if (booking.extra_hours > maxExtraHours) fixes.extra_hours = maxExtraHours
    if (booking.stay_date && (tooSoon(booking.stay_date) || closed.has(booking.stay_date))) fixes.stay_date = ''
    if (Object.keys(fixes).length) setBooking((current) => ({ ...current, ...fixes }))
  }, [maxPax, maxExtraHours, tooSoon, closed])

  function patch(next) {
    setBooking((current) => ({ ...current, ...next }))
    setError('')
  }

  function toggleUnit(id, room) {
    const selected = booking.room_unit_ids.includes(id)
    if (selected) {
      let next = booking.room_unit_ids.filter((item) => item !== id)
      if (room.slug === 'gazebo') {
        const sunriseIds = (catalog?.units || [])
          .filter((unit) => catalog.rooms.find((item) => item.id === unit.room_id)?.slug === 'sunrise')
          .map((unit) => unit.id)
        next = next.filter((item) => !sunriseIds.includes(item))
      }
      patch({ room_unit_ids: next })
      return
    }
    if (room.slug === 'sunrise') {
      const gazeboOn = (catalog?.units || []).some(
        (unit) =>
          booking.room_unit_ids.includes(unit.id) &&
          catalog.rooms.find((item) => item.id === unit.room_id)?.slug === 'gazebo',
      )
      if (!gazeboOn) return
    }
    patch({ room_unit_ids: [...booking.room_unit_ids, id] })
  }

  async function sendRequest() {
    if (guestMode) {
      const ok = await confirm({
        title: 'Send booking request',
        message: `Submit ${summary.package_label || 'this stay'} on ${booking.stay_date} for ${peso(summary.total)}? Sign up or log in next — this exact request is sent right after, no need to fill it in again.`,
        confirmLabel: 'Continue to sign up',
      })
      if (!ok) return
      onRequireAuth?.(payload)
      return
    }
    const ok = await confirm({
      title: 'Send booking request',
      message: `Submit ${summary.package_label || 'this stay'} on ${booking.stay_date} for ${peso(summary.total)}? You'll pay the 50% downpayment next to reserve it.`,
      confirmLabel: 'Continue to payment',
    })
    if (!ok) return
    await submitNow()
  }

  async function submitNow() {
    setSending(true)
    setError('')
    try {
      const created = await submitBooking(payload)
      setSent(created)
      // No manager approval anymore: the booking already holds its slot, so go
      // straight to PayMongo. The webhook / verify call confirms it once paid.
      try {
        const { checkoutUrl } = await startDownpayment(created.id)
        window.location.replace(checkoutUrl)
      } catch (payErr) {
        setError(rpcError(payErr))
      }
    } catch (err) {
      const message = rpcError(err)
      if (/already have an active reservation/i.test(message)) {
        const stay = await getActiveBooking()
        if (stay) {
          onHasActive?.(stay)
          return
        }
      }
      setError(message)
    } finally {
      setSending(false)
    }
  }

  // Resuming a guest-built request right after login: fire the submit once,
  // automatically — the guest already confirmed it before being sent to sign up.
  const autoSubmitted = useRef(false)
  useEffect(() => {
    if (!autoSubmit || guestMode || !catalog || autoSubmitted.current) return
    autoSubmitted.current = true
    submitNow()
  }, [autoSubmit, guestMode, catalog])

  if (!catalog) {
    return (
      <>
        <ActionToast tone="error" message={error} />
        <div className="skeleton-page">
          <div className="skeleton skeleton-card" />
          <div className="book-grid">
            <div className="skeleton skeleton-card" style={{ minHeight: 280 }} />
            <div className="skeleton skeleton-card" style={{ minHeight: 280 }} />
          </div>
        </div>
      </>
    )
  }

  if (sent) {
    return (
      <>
        <ActionToast tone="ok" message={`${sent.reference} is held for you.`} />
        <ActionToast tone="error" message={error} />
        <div className="book-done">
          <div className="check-burst">✓</div>
          <h2>Almost reserved</h2>
          <p>
            {sent.reference} is held for you. It is confirmed as soon as the 50% downpayment of{' '}
            {peso(sent.downpayment_amount)} is paid through PayMongo. If checkout did not open, pay from My reservations.
          </p>
          <button type="button" className="book-btn" onClick={onDone}>
            View my reservations
          </button>
        </div>
      </>
    )
  }

  const gazeboSelected = (catalog.units || []).some(
    (unit) =>
      booking.room_unit_ids.includes(unit.id) &&
      catalog.rooms.find((item) => item.id === unit.room_id)?.slug === 'gazebo',
  )

  // A single small room is fine for a small group, but a large party needs
  // enough rooms selected to actually sleep everyone — not just one.
  const selectedCapacity = (catalog.units || [])
    .filter((unit) => booking.room_unit_ids.includes(unit.id))
    .reduce((sum, unit) => sum + (Number(unit.capacity) || 0), 0)
  const roomsCoverPax = selectedCapacity >= booking.pax

  return (
    <div className="book">
      <ActionToast
        busy={sending}
        tone={error ? 'error' : 'ok'}
        message={sending ? 'Sending booking request…' : error}
      />
      <ol className="steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'on' : index < step ? 'done' : ''}>
            <button type="button" onClick={() => index < step && setStep(index)}>
              <small>{String(index + 1).padStart(2, '0')}</small>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="book-grid">
        <div className="book-main">
          <div className="book-pane" key={step}>
          {step === 0 && (
            <>
              <div className="chip-row">
                {TOUR_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={booking.tour_type === type.id ? 'chip on' : 'chip'}
                    onClick={() => patch({ tour_type: type.id })}
                  >
                    <b>{type.label}</b>
                    <span>{type.hours}</span>
                  </button>
                ))}
              </div>
              <div className="split">
                <MonthCalendar
                  value={booking.stay_date}
                  onChange={(stay_date) => patch({ stay_date })}
                  minDate={today}
                  maxDate={maxDate}
                  dayState={dayState}
                  legend={[
                    { kind: 'open', label: 'Available' },
                    { kind: 'picked', label: 'Selected' },
                    { kind: 'busy', label: 'Occupied' },
                    { kind: 'shut', label: 'Closed' },
                  ]}
                />
                <div className="stack">
                  <label className="counter">
                    <span>Guest pax · up to {maxPax}</span>
                    <div>
                      <button
                        type="button"
                        disabled={booking.pax <= 1}
                        onClick={() => patch({ pax: Math.max(1, booking.pax - 1) })}
                      >
                        −
                      </button>
                      <strong>{booking.pax}</strong>
                      <button
                        type="button"
                        disabled={booking.pax >= maxPax}
                        onClick={() => patch({ pax: Math.min(maxPax, booking.pax + 1) })}
                      >
                        +
                      </button>
                    </div>
                  </label>
                  {booking.pax >= maxPax ? (
                    <p className="hint">
                      {maxPax} guests is the online maximum for this package. Call the resort for larger groups.
                    </p>
                  ) : null}
                  {booking.tour_type === 'overnight' && (
                    <div className="option-col">
                      <p>22-hour shift</p>
                      {OVERNIGHT_SHIFTS.map((shift) => (
                        <button
                          key={shift.id}
                          type="button"
                          className={booking.overnight_shift === shift.id ? 'option on' : 'option'}
                          onClick={() => patch({ overnight_shift: shift.id })}
                        >
                          {shift.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {booking.tour_type === 'event' && (
                    <div className="chip-row">
                      {['day', 'night'].map((when) => (
                        <button
                          key={when}
                          type="button"
                          className={booking.event_when === when ? 'chip on' : 'chip'}
                          onClick={() => patch({ event_when: when })}
                        >
                          {when === 'day' ? 'Day event' : 'Night event'}
                        </button>
                      ))}
                    </div>
                  )}
                  {(booking.tour_type === 'day' || booking.tour_type === 'night') && booking.pax > 20 && (
                    <div className="chip-row">
                      {[8, 12, 16].map((hours) => (
                        <button
                          key={hours}
                          type="button"
                          className={booking.hours === hours ? 'chip on' : 'chip'}
                          onClick={() => patch({ hours })}
                        >
                          {hours} hours
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="counter">
                    <span>Extra hours · up to {maxExtraHours}</span>
                    <div>
                      <button
                        type="button"
                        disabled={booking.extra_hours <= 0}
                        onClick={() => patch({ extra_hours: Math.max(0, booking.extra_hours - 1) })}
                      >
                        −
                      </button>
                      <strong>{booking.extra_hours}</strong>
                      <button
                        type="button"
                        disabled={booking.extra_hours >= maxExtraHours}
                        onClick={() => patch({ extra_hours: Math.min(maxExtraHours, booking.extra_hours + 1) })}
                      >
                        +
                      </button>
                    </div>
                  </label>
                  <p className="hint">
                    Bookings open {rules.max_advance_days} days ahead and need at least {rules.min_lead_hours} hour
                    {rules.min_lead_hours === 1 ? '' : 's'} of lead time.
                  </p>
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <div className="room-grid">
              {catalog.rooms.map((room) => {
                const units = catalog.units.filter((unit) => unit.room_id === room.id)
                const locked = room.slug === 'sunrise' && !gazeboSelected
                return units.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    disabled={locked}
                    className={`room ${booking.room_unit_ids.includes(unit.id) ? 'on' : ''} ${locked ? 'locked' : ''}`}
                    onClick={() => toggleUnit(unit.id, room)}
                  >
                    <b>
                      {room.name} · {unit.name}
                    </b>
                    <span>
                      {locked
                        ? 'Select a Gazebo Suite room first'
                        : `${peso(unit.rate)} · ${unit.capacity || '—'} pax`}
                    </span>
                  </button>
                ))
              })}
            </div>
          )}

          {step === 2 && (
            <div className="stack">
              {catalog.rentals.map((item) => {
                const current = booking.rentals.find((row) => row.id === item.id)?.qty || 0
                return (
                  <label key={item.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={current > 0}
                      onChange={(event) => {
                        const rest = booking.rentals.filter((row) => row.id !== item.id)
                        patch({
                          rentals: event.target.checked ? [...rest, { id: item.id, qty: 1 }] : rest,
                        })
                      }}
                    />
                    <span>{item.name}</span>
                    <b>{peso(item.price)}</b>
                  </label>
                )
              })}
              <label className="counter">
                <span>Pet count · {peso(catalog.rates.find((row) => row.key === 'pet')?.amount || 200)} each</span>
                <div>
                  <button type="button" onClick={() => patch({ pets: Math.max(0, booking.pets - 1) })}>
                    −
                  </button>
                  <strong>{booking.pets}</strong>
                  <button type="button" onClick={() => patch({ pets: booking.pets + 1 })}>
                    +
                  </button>
                </div>
              </label>
              <label className="select-row">
                <span>Caterer</span>
                <select value={booking.caterer_id} onChange={(event) => patch({ caterer_id: event.target.value })}>
                  <option value="">No catering yet</option>
                  {catalog.caterers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="stack">
              <p className="hint">
                {guestMode
                  ? "You'll sign up or log in next — this exact request is sent right after, nothing to refill. Your slot is then held and you go straight to PayMongo for the 50% downpayment — it is reserved as soon as that is paid."
                  : 'Your slot is held and you go straight to PayMongo for the 50% downpayment — it is reserved as soon as that is paid. Totals are calculated on the server from current rates.'}
              </p>
              {error ? <p className="otp-error">{error}</p> : null}
            </div>
          )}

          {error && step !== 3 ? <p className="otp-error">{error}</p> : null}
          </div>

          <div className="book-nav">
            {step > 0 ? (
              <button type="button" className="ghost" onClick={() => setStep(step - 1)}>
                Back
              </button>
            ) : (
              <span />
            )}
            {step < 3 ? (
              <button
                type="button"
                className="book-btn"
                disabled={!booking.stay_date || (step === 1 && !roomsCoverPax)}
                onClick={() => setStep(step + 1)}
              >
                Continue
              </button>
            ) : (
              <button type="button" className="book-btn" disabled={sending || !booking.stay_date} onClick={sendRequest}>
                {sending ? 'Sending…' : guestMode ? 'Continue to sign up' : 'Send booking request'}
              </button>
            )}
          </div>
        </div>

        <aside className="quote">
          <p>Summary</p>
          {step === 1 &&
            (roomsCoverPax ? (
              <p className="hint room-capacity-hint">{`Selected rooms sleep ${selectedCapacity} of your ${booking.pax} guests.`}</p>
            ) : (
              <p className="hint hint-warn room-capacity-hint">
                <svg className="hint-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5v5" />
                  <path d="M12 15.5h.01" />
                </svg>
                <span>
                  {`Selected rooms sleep ${selectedCapacity} of your ${booking.pax} guests. Pick ${
                    booking.pax - selectedCapacity
                  } more pax worth of rooms to continue.`}
                </span>
              </p>
            ))}
          {summary.lines.length === 0 ? (
            <small>Pick a date to see the estimate.</small>
          ) : (
            <ul>
              {summary.lines.map((line) => (
                <li key={line.label}>
                  <span>{line.label}</span>
                  <b>{line.amount ? peso(line.amount) : 'Included'}</b>
                </li>
              ))}
            </ul>
          )}
          <div className="totals">
            <div>
              <span>Total</span>
              <strong>
                <TweenNumber value={summary.total} format={peso} />
              </strong>
            </div>
            <div>
              <span>50% DP</span>
              <strong>
                <TweenNumber value={summary.downpayment} format={peso} />
              </strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
