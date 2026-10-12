import { useEffect, useMemo, useState } from 'react'
import MonthCalendar, { addDaysIso, manilaTodayIso } from '../shared/MonthCalendar'
import {
  DEFAULT_BOOKING_RULES,
  getBookingRules,
  getClosedDates,
  getOccupiedDates,
  rebookBooking,
} from '../lib/api'
import { peso, prettyDate, rpcError, stayWindowLabel } from '../lib/format'
import { slotStartMs } from './BookingFlow'
import './booking.css'

/** Latest moment a stay can still be moved, per the resort's cut-off. */
export function rebookDeadline(booking, minDays) {
  const start = slotStartMs(booking.stay_date, booking.tour_type, booking.overnight_shift, booking.event_when)
  return new Date(start - Number(minDays || 0) * 24 * 3600 * 1000)
}

/** What moving this stay costs: a share of the booking total. */
export function rebookFee(booking, rules) {
  const total = Number(booking?.override_amount ?? booking?.total_amount) || 0
  return Math.round((total * (Number(rules?.rebook_fee_percent) || 0)) / 100) + (Number(rules?.rebook_fee) || 0)
}

export default function RebookDialog({ booking, onClose, onDone }) {
  const [rules, setRules] = useState(DEFAULT_BOOKING_RULES)
  const [occupied, setOccupied] = useState([])
  const [closures, setClosures] = useState([])
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
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
      })
      .catch((err) => alive && setError(rpcError(err)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const closed = useMemo(() => new Map(closures.map((row) => [row.date, row.reason])), [closures])
  const taken = useMemo(() => {
    const need =
      booking.tour_type === 'overnight'
        ? ['day', 'night']
        : booking.tour_type === 'night' || (booking.tour_type === 'event' && booking.event_when === 'night')
          ? ['night']
          : ['day']
    const set = new Set()
    occupied.forEach((row) => {
      // The guest's own slot is free to them.
      if (row.reference === booking.reference) return
      if (row.slots?.some((slot) => need.includes(slot))) set.add(row.date)
    })
    return set
  }, [occupied, booking])

  const dayState = useMemo(
    () => (iso) => {
      if (iso === booking.stay_date) return { className: 'busy', disabled: true, title: 'Your current date' }
      if (closed.has(iso)) return { className: 'shut', disabled: true, title: `Resort closed · ${closed.get(iso) || 'closed'}` }
      if (taken.has(iso)) return { className: 'busy', disabled: true, title: 'That slot is already booked' }
      const leadMs = rules.min_lead_hours * 3600 * 1000
      if (slotStartMs(iso, booking.tour_type, booking.overnight_shift, booking.event_when) - leadMs < Date.now()) {
        return { className: 'past', disabled: true, title: 'Too close to the start time' }
      }
      return {}
    },
    [closed, taken, rules.min_lead_hours, booking],
  )

  const fee = rebookFee(booking, rules)
  const percent = Number(rules.rebook_fee_percent) || 0

  async function save() {
    setSaving(true)
    setError('')
    try {
      await rebookBooking(booking.id, date)
      onDone(`${booking.reference} moved to ${prettyDate(date)}.`)
    } catch (err) {
      setError(rpcError(err))
      setSaving(false)
    }
  }

  return (
    <div
      className="plan-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Rebook ${booking.reference}`}
    >
      <div className="plan-modal rebook-modal">
        <button type="button" className="plan-close" onClick={onClose} aria-label="Close" disabled={saving}>
          ×
        </button>
        <div className="plan-modal-head">
          <p className="plan-kicker">Rebook {booking.reference}</p>
          <h3>Pick a new date</h3>
          <p>
            Currently {prettyDate(booking.stay_date)} · {stayWindowLabel(booking)}. Your package, rooms and
            downpayment carry over to the new date.
          </p>
        </div>
        <div className="rebook-body">
          {loading ? (
            <div className="skeleton skeleton-card" style={{ minHeight: 300 }} />
          ) : (
            <MonthCalendar
              value={date}
              onChange={setDate}
              minDate={today}
              maxDate={addDaysIso(today, rules.max_advance_days)}
              dayState={dayState}
              legend={[
                { kind: 'open', label: 'Available' },
                { kind: 'picked', label: 'New date' },
                { kind: 'busy', label: 'Taken' },
                { kind: 'shut', label: 'Closed' },
              ]}
            />
          )}
          <div className="stack">
            <ul className="policy-list">
              <li>
                <b>Rebooking fee</b>
                <span>
                  {fee > 0
                    ? `${percent > 0 ? `${percent}% of your booking total, about ${peso(fee)},` : peso(fee)} is added to your balance and collected at the front desk before check-in.`
                    : 'No fee is charged for this change.'}
                </span>
              </li>
              <li>
                <b>Cut-off</b>
                <span>
                  Changes close {rules.rebook_min_days} day{rules.rebook_min_days === 1 ? '' : 's'} before the stay.
                </span>
              </li>
              <li>
                <b>Weekend rate</b>
                <span>Moving between a weekday and a Fri–Sun date adjusts the weekend add-on.</span>
              </li>
            </ul>
            {error ? <p className="otp-error">{error}</p> : null}
            <div className="action-row">
              <button type="button" className="book-btn" disabled={!date || saving} onClick={save}>
                {saving ? 'Moving…' : date ? `Move to ${prettyDate(date)}` : 'Pick a date'}
              </button>
              <button type="button" className="ghost" disabled={saving} onClick={onClose}>
                Keep current date
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
