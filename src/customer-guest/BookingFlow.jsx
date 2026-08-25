import { useEffect, useMemo, useState } from 'react'
import { ActionToast } from '../shared/RoleLayout'
import { getActiveBooking, getCatalog, getOccupiedDates, quoteBooking, submitBooking } from '../lib/api'
import { peso, rpcError } from '../lib/format'
import { TweenNumber } from '../shared/motion'
import './booking.css'

const STEPS = ['Package & date', 'Rooms', 'Rentals', 'Review']
const TOUR_TYPES = [
  { id: 'day', label: 'Day Tour', hours: '8:00 AM – 4:00 PM' },
  { id: 'night', label: 'Night Tour', hours: '5:00 PM – 12:00 AM' },
  { id: 'overnight', label: 'Overnight Stay', hours: '22-hour stay' },
  { id: 'event', label: 'Event Package', hours: 'Day or night · sound system included' },
]
const OVERNIGHT_SHIFTS = [
  { id: '9:00 AM – 7:00 AM', label: '9:00 AM – 7:00 AM' },
  { id: '2:00 PM – 12:00 NN', label: '2:00 PM – 12:00 NN' },
  { id: '6:00 PM – 4:00 PM', label: '6:00 PM – 4:00 PM' },
]

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function manilaTodayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

function slotStartMs(iso, tour, shift, eventWhen) {
  let hour = 8
  if (tour === 'night' || (tour === 'event' && eventWhen === 'night')) hour = 17
  else if (tour === 'overnight') {
    if (String(shift || '').includes('2:00 PM')) hour = 14
    else if (String(shift || '').includes('6:00 PM')) hour = 18
    else hour = 9
  }
  return new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime()
}

function Calendar({ value, onChange, blocked, todayStarted }) {
  const start = new Date()
  const [cursor, setCursor] = useState(new Date(start.getFullYear(), start.getMonth(), 1))
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1).getDay()
  const total = daysInMonth(year, month)
  const cells = Array.from({ length: first }, () => null).concat(Array.from({ length: total }, (_, index) => index + 1))
  const today = manilaTodayIso()

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))}>
          ‹
        </button>
        <strong>{cursor.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))}>
          ›
        </button>
      </div>
      <div className="cal-grid labels">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((day, index) => {
          if (!day) return <span key={`e-${index}`} />
          const iso = isoDate(year, month, day)
          const taken = blocked.has(iso)
          const past = iso < today || (iso === today && todayStarted)
          const weekend = [0, 5, 6].includes(new Date(`${iso}T00:00:00`).getDay())
          return (
            <button
              key={iso}
              type="button"
              disabled={taken || past}
              className={`${value === iso ? 'picked' : ''} ${weekend ? 'wk' : ''} ${taken ? 'busy' : ''} ${past ? 'past' : ''}`}
              onClick={() => onChange(iso)}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function BookingFlow({ onDone, onHasActive, initialTourType = 'day' }) {
  const [step, setStep] = useState(0)
  const [catalog, setCatalog] = useState(null)
  const [occupied, setOccupied] = useState([])
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
  })

  useEffect(() => {
    let active = true
    Promise.all([
      getCatalog(),
      getOccupiedDates(new Date().toISOString().slice(0, 10), '2028-12-31'),
      getActiveBooking(),
    ])
      .then(([nextCatalog, dates, stay]) => {
        if (!active) return
        if (stay) {
          onHasActive?.(stay)
          return
        }
        setCatalog(nextCatalog)
        setOccupied(Array.isArray(dates) ? dates : [])
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
    setSending(true)
    setError('')
    try {
      const created = await submitBooking(payload)
      setSent(created)
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
        <ActionToast tone="ok" message={`${sent.reference} sent for approval.`} />
        <div className="book-done">
          <div className="check-burst">✓</div>
          <h2>Booking sent for approval</h2>
          <p>
            {sent.reference} is with the resort manager. After approval you will pay the 50% downpayment of{' '}
            {peso(sent.downpayment_amount)} through PayMongo.
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
                <Calendar
                  value={booking.stay_date}
                  onChange={(stay_date) => patch({ stay_date })}
                  blocked={blocked}
                  todayStarted={Date.now() >= slotStartMs(manilaTodayIso(), booking.tour_type, booking.overnight_shift, booking.event_when)}
                />
                <div className="stack">
                  <label className="counter">
                    <span>Guest pax</span>
                    <div>
                      <button type="button" onClick={() => patch({ pax: Math.max(1, booking.pax - 1) })}>
                        −
                      </button>
                      <strong>{booking.pax}</strong>
                      <button type="button" onClick={() => patch({ pax: Math.min(200, booking.pax + 1) })}>
                        +
                      </button>
                    </div>
                  </label>
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
                    <span>Extra hours</span>
                    <div>
                      <button type="button" onClick={() => patch({ extra_hours: Math.max(0, booking.extra_hours - 1) })}>
                        −
                      </button>
                      <strong>{booking.extra_hours}</strong>
                      <button type="button" onClick={() => patch({ extra_hours: booking.extra_hours + 1 })}>
                        +
                      </button>
                    </div>
                  </label>
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
                Your request is sent to the resort manager first. The 50% downpayment is collected through PayMongo
                only after approval. Totals are calculated on the server from current rates.
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
              <button type="button" className="book-btn" disabled={!booking.stay_date} onClick={() => setStep(step + 1)}>
                Continue
              </button>
            ) : (
              <button type="button" className="book-btn" disabled={sending || !booking.stay_date} onClick={sendRequest}>
                {sending ? 'Sending…' : 'Send booking request'}
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
              <span>50% DP after approval</span>
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
