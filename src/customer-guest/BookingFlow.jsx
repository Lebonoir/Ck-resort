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
  guestBlocked,
  quoteBooking,
  startDownpayment,
  submitBooking,
} from '../lib/api'
import { peso, prettyDate, prettyDateTime, rpcError } from '../lib/format'
import { minPax as packageMinPax, suggestRoomSets, unitLabel } from '../lib/rooms'
import { RollingNumber } from '../shared/motion'
import MonthCalendar, { addDaysIso, manilaTodayIso } from '../shared/MonthCalendar'
import RoomPhoto from '../shared/RoomPhoto'
import AddOnsStep from './AddOnsStep'
import './booking.css'

const STEPS = ['Package & date', 'Rooms', 'Add-ons', 'Review & pay']
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

function sameIds(left, right) {
  return left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|')
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
  const [blocked, setBlocked] = useState(null)
  const [detailUnitId, setDetailUnitId] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState('')
  const [sent, setSent] = useState(null)
  const [summary, setSummary] = useState({ lines: [], total: 0, downpayment: 0, package_label: '' })
  const [booking, setBooking] = useState({
    tour_type: initialTourType,
    stay_date: '',
    pax: initialTourType === 'overnight' ? 10 : initialTourType === 'event' ? 20 : 30,
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
          // These two need a real session — guests browsing pre-signup have none.
          guestMode ? Promise.resolve(null) : getActiveBooking(),
          guestMode ? Promise.resolve(null) : guestBlocked(),
        ])
      })
      .then((result) => {
        if (!active || !result) return
        const [nextCatalog, dates, shut, stay, block] = result
        if (stay) {
          onHasActive?.(stay)
          return
        }
        if (block?.blocked) setBlocked(block)
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

  const taken = useMemo(() => {
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
  // A day or night tour is a 30-pax package and an overnight stay starts at
  // its smallest tier, so the counter cannot go below that.
  const minPax = packageMinPax(booking.tour_type, catalog, rules)
  const maxPax = Math.max(rules.max_pax?.[booking.tour_type] ?? 150, minPax)
  const dayOrNight = booking.tour_type === 'day' || booking.tour_type === 'night'
  const maxExtraHours = rules.max_extra_hours
  const overnight = booking.tour_type === 'overnight'
  const petsPerRoom = Number(rules.max_pets_per_room) || 0
  const maxPets = petsPerRoom > 0 ? petsPerRoom * Math.max(booking.room_unit_ids.length, 1) : 99

  // Rooms always have to sleep the whole group, so the guest picks one of the
  // sets that fits the headcount instead of adding rooms one by one. Overnight
  // sets come with the package; on other packages they are a paid add-on.
  // A room with a reported fault is closed until staff mark it fixed.
  const closedUnits = useMemo(() => (catalog?.units || []).filter((unit) => unit.under_repair), [catalog])
  const roomSets = useMemo(
    () =>
      catalog
        ? suggestRoomSets(
            catalog.units.filter((unit) => !unit.under_repair),
            catalog.rooms,
            booking.pax,
          )
        : [],
    [catalog, booking.pax],
  )

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
      if (taken.has(iso)) {
        return { className: 'busy', disabled: true, title: 'That slot is already booked' }
      }
      if (tooSoon(iso)) {
        return { className: 'past', disabled: true, title: 'Too close to the start time' }
      }
      return {}
    },
    [closed, taken, tooSoon],
  )

  // Switching package can pull the current picks outside the new limits.
  useEffect(() => {
    const fixes = {}
    if (booking.pax > maxPax) fixes.pax = maxPax
    else if (booking.pax < minPax) fixes.pax = minPax
    if (booking.extra_hours > maxExtraHours) fixes.extra_hours = maxExtraHours
    if (booking.pets > maxPets) fixes.pets = maxPets
    if (booking.stay_date && (tooSoon(booking.stay_date) || closed.has(booking.stay_date))) fixes.stay_date = ''
    if (Object.keys(fixes).length) setBooking((current) => ({ ...current, ...fixes }))
  }, [minPax, maxPax, maxExtraHours, maxPets, tooSoon, closed])

  // Keep the room set in step with the headcount. Overnight falls back to the
  // best fit (a set is required); other packages fall back to no room.
  useEffect(() => {
    if (!catalog) return
    if (!overnight && booking.room_unit_ids.length === 0) return
    const stillValid = roomSets.some((set) =>
      sameIds(
        set.units.map((unit) => unit.id),
        booking.room_unit_ids,
      ),
    )
    if (stillValid) return
    const fallback = overnight && roomSets.length ? roomSets[0].units.map((unit) => unit.id) : []
    if (sameIds(fallback, booking.room_unit_ids)) return
    setBooking((current) => ({ ...current, room_unit_ids: fallback }))
  }, [overnight, roomSets, catalog])

  function patch(next) {
    setBooking((current) => ({ ...current, ...next }))
    setError('')
  }

  function changeTour(tourType) {
    if (tourType === booking.tour_type) return
    // Room rules differ per package (included sets vs paid add-ons), so start clean.
    patch({ tour_type: tourType, room_unit_ids: [] })
  }

  // Mirrors the room block in quote_booking(): one or two rooms use the flat
  // package rate, a third room onward is billed at its own rate.
  function setPrice(units) {
    const rate = (key, fallback) => Number(catalog.rates.find((row) => row.key === key)?.amount ?? fallback)
    if (units.length === 1) return rate('room_pkg_1', 3000)
    const order = (unit) => (catalog.rooms.find((room) => room.id === unit.room_id)?.sort_order || 0) * 100 + (unit.sort_order || 0)
    const extra = [...units]
      .sort((left, right) => order(left) - order(right))
      .slice(2)
      .reduce((sum, unit) => sum + Number(unit.rate || 0), 0)
    return rate('room_pkg_2', 5000) + extra
  }

  async function sendRequest() {
    if (guestMode) {
      const ok = await confirm({
        title: 'Continue to sign up',
        message: `Book ${summary.package_label || 'this stay'} on ${prettyDate(booking.stay_date)} for ${peso(summary.total)}? Sign up or log in next — this exact booking is created right after, then you pay the 50% downpayment of ${peso(summary.downpayment)}.`,
        confirmLabel: 'Continue to sign up',
      })
      if (!ok) return
      onRequireAuth?.(payload)
      return
    }
    const ok = await confirm({
      title: 'Pay 50% downpayment',
      message: `Book ${summary.package_label || 'this stay'} on ${prettyDate(booking.stay_date)} and pay ${peso(summary.downpayment)} now through PayMongo? The downpayment is not refundable.`,
      confirmLabel: 'Continue to PayMongo',
    })
    if (!ok) return
    await submitNow()
  }

  async function openCheckout(created) {
    setSending('pay')
    try {
      const { checkoutUrl } = await startDownpayment(created.id)
      // replace() so Back does not land on the gateway's receipt page.
      window.location.replace(checkoutUrl)
    } catch (err) {
      // The booking exists and holds the date; the guest can retry from here.
      setError(rpcError(err))
      setSending('')
    }
  }

  async function submitNow() {
    setSending('book')
    setError('')
    try {
      const created = await submitBooking(payload)
      setSent(created)
      await openCheckout(created)
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
      setSending('')
    }
  }

  // Resuming a guest-built request right after login: fire the submit once,
  // automatically — the guest already confirmed it before being sent to sign up.
  const autoSubmitted = useRef(false)
  useEffect(() => {
    if (!autoSubmit || guestMode || !catalog || blocked || autoSubmitted.current) return
    autoSubmitted.current = true
    submitNow()
  }, [autoSubmit, guestMode, catalog, blocked])

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

  if (blocked) {
    return (
      <div className="book-done blocked">
        <div className="check-burst">!</div>
        <h2>Online booking is paused for this account</h2>
        <p>
          {blocked.reason || 'A previous reservation was marked as a no-show.'} Please call the resort at 0920 950 2510
          so the front desk can review it.
        </p>
        <button type="button" className="book-btn" onClick={onDone}>
          View my reservations
        </button>
      </div>
    )
  }

  if (sent) {
    return (
      <>
        <ActionToast
          busy={sending === 'pay'}
          tone={error ? 'error' : 'ok'}
          message={sending === 'pay' ? 'Opening PayMongo checkout…' : error || `${sent.reference} is on hold.`}
        />
        <div className="book-done">
          <div className="check-burst">✓</div>
          <h2>{sent.reference} is holding your date</h2>
          <p>
            Pay the 50% downpayment of {peso(sent.downpayment_amount)}
            {sent.payment_due_at ? ` by ${prettyDateTime(sent.payment_due_at)}` : ''} to confirm it. The hold is
            released if the payment is not completed in time.
          </p>
          {error ? <p className="otp-error">{error}</p> : null}
          <div className="action-row">
            <button type="button" className="book-btn" disabled={Boolean(sending)} onClick={() => openCheckout(sent)}>
              {sending === 'pay' ? 'Opening PayMongo…' : `Pay ${peso(sent.downpayment_amount)} now`}
            </button>
            <button type="button" className="ghost" onClick={onDone}>
              View my reservations
            </button>
          </div>
        </div>
      </>
    )
  }

  function renderSet(set, recommended) {
    const ids = set.units.map((unit) => unit.id)
    const on = sameIds(ids, booking.room_unit_ids)
    return (
      <button
        key={set.key}
        type="button"
        className={`room-set ${on ? 'on' : ''} ${recommended ? 'recommended' : ''}`}
        aria-pressed={on}
        onClick={() => {
          setDetailUnitId(ids[0])
          patch({ room_unit_ids: ids })
        }}
      >
        <span className={`set-photos count-${Math.min(set.units.length, 3)}`}>
          {set.units.slice(0, 3).map((unit) => (
            <RoomPhoto key={unit.id} src={unit.image_url} label={unitLabel(unit, catalog.rooms)} />
          ))}
        </span>
        <span className="set-copy">
          {recommended ? <em>Recommended</em> : null}
          <b>{set.units.map((unit) => unitLabel(unit, catalog.rooms)).join(' + ')}</b>
          <span>
            Sleeps {set.capacity}
            {set.spare > 0 ? ` · room for ${set.spare} more` : ' · exact fit'}
            {set.units.length > 1 ? ` · ${set.units.length} rooms` : ''}
          </span>
          <span className="set-price">{overnight ? 'Included' : `+ ${peso(setPrice(set.units))}`}</span>
        </span>
      </button>
    )
  }

  const detailUnit = (catalog.units || []).find((unit) => unit.id === detailUnitId) || null
  const detailRoom = detailUnit ? catalog.rooms.find((room) => room.id === detailUnit.room_id) : null
  const roomRate = (key, fallback) => catalog.rates.find((row) => row.key === key)?.amount || fallback
  const roomsMissing = overnight && booking.room_unit_ids.length === 0
  const canContinue = Boolean(booking.stay_date) && !(step === 1 && roomsMissing)

  return (
    <div className="book">
      <ActionToast
        busy={Boolean(sending)}
        tone={error ? 'error' : 'ok'}
        message={sending === 'book' ? 'Creating your booking…' : sending === 'pay' ? 'Opening PayMongo checkout…' : error}
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
                    onClick={() => changeTour(type.id)}
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
                    <span>
                      Guest pax ·{' '}
                      {dayOrNight ? `${minPax} included` : minPax > 1 ? `from ${minPax}` : `up to ${maxPax}`}
                    </span>
                    <div>
                      <button
                        type="button"
                        disabled={booking.pax <= minPax}
                        aria-label="Fewer guests"
                        onClick={() => patch({ pax: Math.max(minPax, booking.pax - 1) })}
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
                  {dayOrNight ? (
                    <p className="hint">
                      The package covers {minPax} people. Each person after that is{' '}
                      {peso(roomRate('extra_pax_tour', 200))}
                      {booking.pax > minPax
                        ? `: ${booking.pax - minPax} extra adds ${peso((booking.pax - minPax) * roomRate('extra_pax_tour', 200))}.`
                        : '.'}
                    </p>
                  ) : null}
                  {overnight ? (
                    <p className="hint">
                      Starts at {minPax} pax. Count everyone who will sleep over: the price follows the overnight rates
                      for your group size, and rooms are assigned to fit in the next step. Extra people who arrive on
                      the day are {peso(roomRate('extra_pax_overnight', 800))} each.
                    </p>
                  ) : null}
                  {overnight && (
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
            <div className="stack">
              <div className="room-intro">
                <b>{overnight ? `Rooms for ${booking.pax} pax` : `Add rooms for ${booking.pax} pax (optional)`}</b>
                <p>
                  {overnight
                    ? 'Overnight rooms come with the package, so there is nothing extra to pay here. We recommend the closest fit, and every other set that sleeps your whole group is listed below it.'
                    : `Rooms are matched to your headcount, so every set below sleeps all ${booking.pax} of you — the recommended one first, then every other option. ${peso(roomRate('room_pkg_1', 3000))} for one room, ${peso(roomRate('room_pkg_2', 5000))} for two; a third room onward is billed at its own rate.`}
                </p>
              </div>
              {roomSets.length === 0 ? (
                <p className="hint">No room set fits {booking.pax} pax online. Please call the resort for this group size.</p>
              ) : null}
              {closedUnits.length ? (
                <p className="hint room-closed">
                  {closedUnits.map((unit) => unitLabel(unit, catalog.rooms)).join(', ')}{' '}
                  {closedUnits.length === 1 ? 'is' : 'are'} closed for repair and cannot be booked right now.
                </p>
              ) : null}
              <div className="set-grid">
                {!overnight ? (
                  <button
                    type="button"
                    className={`room-set no-room ${booking.room_unit_ids.length === 0 ? 'on' : ''}`}
                    aria-pressed={booking.room_unit_ids.length === 0}
                    onClick={() => {
                      setDetailUnitId('')
                      patch({ room_unit_ids: [] })
                    }}
                  >
                    <span className="set-copy">
                      <b>No room</b>
                      <span>Pool, cottages and grounds only. You can still ask the front desk for a room on the day.</span>
                    </span>
                  </button>
                ) : null}
                {roomSets[0] ? renderSet(roomSets[0], true) : null}
              </div>
              {roomSets.length > 1 ? (
                <div className="set-more">
                  <p className="set-more-head">
                    <b>All other options</b>
                    <span>
                      {roomSets.length - 1} more set{roomSets.length === 2 ? '' : 's'} that sleep {booking.pax} pax
                    </span>
                  </p>
                  <div className="set-grid compact">{roomSets.slice(1).map((set) => renderSet(set, false))}</div>
                </div>
              ) : null}
              {overnight ? (
                <p className="hint">
                  Bringing more people on the day? Extra heads are {peso(roomRate('extra_pax_overnight', 800))} each. If
                  the group outgrows the room capacity, the front desk adds another room at its room rate.
                </p>
              ) : null}
            </div>
          )}

          {step === 2 && (
            <AddOnsStep catalog={catalog} booking={booking} patch={patch} maxPets={maxPets} petsPerRoom={petsPerRoom} />
          )}

          {step === 3 && (
            <div className="stack">
              <div className="room-intro">
                <b>
                  {prettyDate(booking.stay_date)} · {booking.pax} pax
                </b>
                <p>
                  {guestMode
                    ? 'Sign up or log in next. Your booking is created right after and you go straight to the 50% downpayment on PayMongo — no waiting for approval.'
                    : 'Your date is held as soon as you continue, and you pay the 50% downpayment on PayMongo right away. A confirmation is emailed once the payment goes through.'}
                </p>
              </div>
              <ul className="policy-list">
                <li>
                  <b>Downpayment</b>
                  <span>50% now, not refundable. The other 50% is paid at the front desk before check-in.</span>
                </li>
                <li>
                  <b>Rebooking</b>
                  <span>
                    Allowed up to {rules.rebook_min_days} day{rules.rebook_min_days === 1 ? '' : 's'} before your date
                    {Number(rules.rebook_fee_percent) > 0
                      ? `, with a fee of ${rules.rebook_fee_percent}% of the booking total`
                      : Number(rules.rebook_fee) > 0
                        ? `, with a ${peso(rules.rebook_fee)} fee`
                        : ''}
                    .
                  </span>
                </li>
                <li>
                  <b>No-show</b>
                  <span>A missed stay forfeits the downpayment and blocks the account from booking online.</span>
                </li>
                <li>
                  <b>Headcount</b>
                  <span>Guests are counted on arrival. Extra heads and damaged items are added to the bill.</span>
                </li>
              </ul>
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
              <button type="button" className="book-btn" disabled={!canContinue} onClick={() => setStep(step + 1)}>
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="book-btn"
                disabled={Boolean(sending) || !booking.stay_date || roomsMissing}
                onClick={sendRequest}
              >
                {sending
                  ? 'Working…'
                  : guestMode
                    ? 'Continue to sign up'
                    : `Pay ${peso(summary.downpayment)} downpayment`}
              </button>
            )}
          </div>
        </div>

        <aside className="quote">
          <p>Summary</p>
          {summary.lines.length === 0 ? (
            <small>Pick a date to see the estimate.</small>
          ) : (
            <ul>
              {summary.lines.map((line) => (
                <li key={line.label}>
                  <span>{line.label}</span>
                  <b>{Number(line.amount) ? peso(line.amount) : 'Included'}</b>
                </li>
              ))}
            </ul>
          )}
          <div className="totals">
            <div>
              <span>Total</span>
              <strong>
                <RollingNumber value={summary.total} format={peso} showDelta />
              </strong>
            </div>
            <div>
              <span>50% downpayment · due now</span>
              <strong>
                <RollingNumber value={summary.downpayment} format={peso} />
              </strong>
            </div>
          </div>

          {detailUnit ? (
            <div className="room-detail">
              <RoomPhoto src={detailUnit.image_url} label={unitLabel(detailUnit, catalog.rooms)} className="wide" />
              <p className="room-detail-kicker">Room details</p>
              <h4>
                {detailRoom?.name} · {detailUnit.name}
              </h4>
              <p className="room-detail-meta">
                Sleeps {detailUnit.capacity || '—'}
                {detailUnit.bed_count ? ` · ${detailUnit.bed_count} bed${detailUnit.bed_count === 1 ? '' : 's'}` : ''}
                {overnight ? ' · included' : ''}
              </p>
              {detailUnit.description ? <p>{detailUnit.description}</p> : null}
              {detailRoom?.description ? <p className="room-detail-note">{detailRoom.description}</p> : null}
              {!detailUnit.description && !detailRoom?.description ? (
                <p className="room-detail-note">No description saved for this room yet.</p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
