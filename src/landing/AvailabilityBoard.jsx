import { useEffect, useMemo, useState } from 'react'
import MonthCalendar, { addDaysIso, manilaTodayIso } from '../shared/MonthCalendar'
import { Reveal } from '../shared/motion'
import { DEFAULT_BOOKING_RULES, getBookingRules, getClosedDates, getOccupiedDates } from '../lib/api'
import { prettyDate } from '../lib/format'
import { slotStartMs } from '../customer-guest/BookingFlow'

const PACKAGES = [
  { id: 'day', label: 'Day Tour', hours: '8:00 AM – 4:00 PM', needs: ['day'] },
  { id: 'night', label: 'Night Tour', hours: '5:00 PM – 12:00 AM', needs: ['night'] },
  { id: 'overnight', label: 'Overnight', hours: '22-hour stay', needs: ['day', 'night'] },
  { id: 'event', label: 'Event', hours: 'Day event · 8:00 AM – 4:00 PM', needs: ['day'] },
]

/**
 * Public availability calendar: anyone can see which dates are open, taken
 * or closed before creating an account. Picking an open date hands it to the
 * estimator so the visitor continues with that date already chosen.
 */
export default function AvailabilityBoard({ onPlan }) {
  const [rules, setRules] = useState(DEFAULT_BOOKING_RULES)
  const [occupied, setOccupied] = useState([])
  const [closures, setClosures] = useState([])
  const [tour, setTour] = useState('day')
  const [date, setDate] = useState('')
  const [state, setState] = useState('loading')
  const today = manilaTodayIso()

  useEffect(() => {
    let alive = true
    getBookingRules()
      .then((next) => {
        if (!alive) return null
        setRules(next)
        const horizon = addDaysIso(today, next.max_advance_days)
        return Promise.all([getOccupiedDates(today, horizon), getClosedDates(today, horizon)])
      })
      .then((result) => {
        if (!alive || !result) return
        setOccupied(Array.isArray(result[0]) ? result[0] : [])
        setClosures(Array.isArray(result[1]) ? result[1] : [])
        setState('ready')
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [])

  // date -> Set of taken slots ('day' | 'night')
  const takenSlots = useMemo(() => {
    const map = new Map()
    occupied.forEach((row) => {
      if (!map.has(row.date)) map.set(row.date, new Set())
      ;(row.slots || []).forEach((slot) => map.get(row.date).add(slot))
    })
    return map
  }, [occupied])
  const closed = useMemo(() => new Map(closures.map((row) => [row.date, row.reason])), [closures])
  const selected = PACKAGES.find((item) => item.id === tour)

  function statusFor(iso, pack) {
    if (closed.has(iso)) return 'closed'
    const taken = takenSlots.get(iso)
    if (taken && pack.needs.some((slot) => taken.has(slot))) return 'taken'
    const leadMs = rules.min_lead_hours * 3600 * 1000
    if (slotStartMs(iso, pack.id, '9:00 AM – 7:00 AM', 'day') - leadMs < Date.now()) return 'soon'
    return 'open'
  }

  const dayState = useMemo(
    () => (iso) => {
      const status = statusFor(iso, selected)
      if (status === 'closed') return { className: 'shut', title: `Resort closed · ${closed.get(iso) || 'closed'}` }
      if (status === 'taken') return { className: 'busy', title: `${selected.label} is already booked` }
      if (status === 'soon') return { className: 'past', disabled: true, title: 'Too close to the start time' }
      return { title: `${selected.label} is open` }
    },
    [selected, takenSlots, closed, rules.min_lead_hours],
  )

  const openForDate = date ? PACKAGES.filter((pack) => statusFor(date, pack) === 'open') : []
  const canPlan = Boolean(date) && statusFor(date, selected) === 'open'

  return (
    <section className="hero-block dates-block" id="dates">
      <div className="dates-grid">
        <Reveal className="hero-copy">
          <p className="hero-kicker dark">Available dates</p>
          <h2>See what is open before you sign up.</h2>
          <p>
            The resort is booked one group at a time, so a taken slot is gone for everyone. Pick a package, check the
            calendar, then continue with the date you like — an account is only needed at payment.
          </p>
          <div className="dates-chips" role="tablist" aria-label="Package">
            {PACKAGES.map((pack) => (
              <button
                key={pack.id}
                type="button"
                role="tab"
                aria-selected={tour === pack.id}
                className={tour === pack.id ? 'on' : ''}
                onClick={() => setTour(pack.id)}
              >
                <b>{pack.label}</b>
                <span>{pack.hours}</span>
              </button>
            ))}
          </div>

          <div className="dates-detail" aria-live="polite">
            {date ? (
              <>
                <p className="dates-day">{prettyDate(date)}</p>
                <ul>
                  {PACKAGES.map((pack) => {
                    const status = statusFor(date, pack)
                    return (
                      <li key={pack.id} className={status}>
                        <span>{pack.label}</span>
                        <b>
                          {status === 'open'
                            ? 'Open'
                            : status === 'taken'
                              ? 'Booked'
                              : status === 'closed'
                                ? 'Resort closed'
                                : 'Too soon to book'}
                        </b>
                      </li>
                    )
                  })}
                </ul>
                <button type="button" className="book-now" disabled={!canPlan} onClick={() => onPlan({ tour_type: tour, stay_date: date })}>
                  {canPlan
                    ? `Plan ${selected.label} on this date`
                    : openForDate.length
                      ? `${selected.label} is not open — try ${openForDate[0].label}`
                      : 'Nothing open on this date'}
                </button>
              </>
            ) : (
              <p className="dates-empty">
                Tap a day on the calendar to see which packages are still open. Bookings open {rules.max_advance_days}{' '}
                days ahead.
              </p>
            )}
          </div>
        </Reveal>

        <Reveal variant="right" delay={80} className="dates-cal">
          {state === 'loading' ? <div className="dates-skeleton" aria-hidden="true" /> : null}
          {state === 'error' ? (
            <p className="dates-empty">
              The calendar could not load right now. Call 0920 950 2510 and the front desk will check the date for you.
            </p>
          ) : null}
          {state === 'ready' ? (
            <MonthCalendar
              value={date}
              onChange={setDate}
              minDate={today}
              maxDate={addDaysIso(today, rules.max_advance_days)}
              dayState={dayState}
              legend={[
                { kind: 'open', label: 'Open' },
                { kind: 'picked', label: 'Selected' },
                { kind: 'busy', label: 'Booked' },
                { kind: 'shut', label: 'Closed' },
              ]}
            />
          ) : null}
        </Reveal>
      </div>
    </section>
  )
}
