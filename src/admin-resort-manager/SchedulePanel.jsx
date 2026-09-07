import { useEffect, useMemo, useState } from 'react'
import { FolderList } from '../shared/FolderList'
import { useConfirm } from '../shared/ConfirmDialog'
import MonthCalendar, { addDaysIso, manilaTodayIso } from '../shared/MonthCalendar'
import {
  DEFAULT_BOOKING_RULES,
  addClosure,
  getBookingRules,
  getOccupiedDates,
  listClosures,
  removeClosure,
  saveBookingRules,
} from '../lib/api'
import { prettyDate, rpcError } from '../lib/format'

export default function SchedulePanel({ bookings = [], onError, onSaved }) {
  const confirm = useConfirm()
  const [closures, setClosures] = useState([])
  const [rules, setRules] = useState(DEFAULT_BOOKING_RULES)
  const [occupied, setOccupied] = useState([])
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const today = manilaTodayIso()

  async function reload() {
    const nextRules = await getBookingRules()
    const horizon = addDaysIso(today, nextRules.max_advance_days)
    const [nextClosures, nextOccupied] = await Promise.all([listClosures(), getOccupiedDates(today, horizon)])
    setRules(nextRules)
    setClosures(nextClosures)
    setOccupied(Array.isArray(nextOccupied) ? nextOccupied : [])
  }

  useEffect(() => {
    reload().catch((err) => onError(rpcError(err)))
  }, [])

  async function handleAdd(event) {
    event.preventDefault()
    const ok = await confirm({
      title: 'Close this date',
      message: `Block ${prettyDate(date)} from online booking? Guests will see it as closed.`,
      confirmLabel: 'Close date',
    })
    if (!ok) return
    setBusy('add')
    onError('')
    try {
      await addClosure(date, reason)
      setDate('')
      setReason('')
      await reload()
      onSaved('Date closed. It no longer accepts bookings.')
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function handleRemove(closureDate) {
    const ok = await confirm({
      title: 'Reopen date',
      message: `Reopen ${prettyDate(closureDate)} for online booking?`,
      confirmLabel: 'Reopen',
    })
    if (!ok) return
    setBusy(`remove:${closureDate}`)
    onError('')
    try {
      await removeClosure(closureDate)
      await reload()
      onSaved('Date reopened for booking.')
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function handleSaveRules() {
    const ok = await confirm({
      title: 'Save booking limits',
      message: 'Apply these limits to every new online booking?',
      confirmLabel: 'Save limits',
    })
    if (!ok) return
    setBusy('rules')
    onError('')
    try {
      const next = await saveBookingRules(rules)
      setRules({ ...DEFAULT_BOOKING_RULES, ...(next || {}) })
      onSaved('Booking limits saved.')
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  function patchPax(key, value) {
    setRules((current) => ({
      ...current,
      max_pax: { ...current.max_pax, [key]: Math.max(1, Number(value) || 1) },
    }))
  }

  const upcoming = closures.filter((row) => row.closure_date >= today)
  const past = closures.filter((row) => row.closure_date < today)
  const closedMap = useMemo(
    () => new Map(closures.map((row) => [row.closure_date, row.reason])),
    [closures],
  )
  // Occupied comes from the same RPC the guest calendar uses, so both views agree.
  const activeDates = useMemo(() => {
    const set = new Set(occupied.map((row) => row.date))
    bookings
      .filter((row) => ['pending_approval', 'awaiting_downpayment', 'confirmed', 'checked_in'].includes(row.status))
      .forEach((row) => set.add(row.stay_date))
    return set
  }, [occupied, bookings])

  const dayState = useMemo(
    () => (iso) => {
      if (closedMap.has(iso)) {
        return { className: 'shut', title: `Closed · ${closedMap.get(iso) || 'closed'} — click to reopen` }
      }
      if (activeDates.has(iso)) {
        return { className: 'busy', disabled: true, title: 'Has active reservations — cannot be closed' }
      }
      return { title: 'Click to close this date' }
    },
    [closedMap, activeDates],
  )

  function pickDate(iso) {
    if (closedMap.has(iso)) {
      handleRemove(iso)
      return
    }
    setDate(iso)
  }

  return (
    <div className="schedule-page">
      <section className="admin-card">
        <h3>Close a date</h3>
        <p className="admin-note">
          Closed dates are hidden from the guest calendar and rejected by the booking form. Dates that already have
          active reservations cannot be closed until those bookings are moved or cancelled.
        </p>
        <div className="schedule-split">
          <MonthCalendar
            value={date}
            onChange={pickDate}
            minDate={today}
            maxDate={addDaysIso(today, rules.max_advance_days)}
            dayState={dayState}
            legend={[
              { kind: 'open', label: 'Open' },
              { kind: 'picked', label: 'Selected' },
              { kind: 'busy', label: 'Has bookings' },
              { kind: 'shut', label: 'Closed' },
            ]}
          />
          <form className="schedule-form" onSubmit={handleAdd}>
            <p className="admin-note">
              {date ? (
                <>
                  Closing <b>{prettyDate(date)}</b>. Click a red day on the calendar to reopen it.
                </>
              ) : (
                'Pick a day on the calendar to close it. Days with bookings are struck through and cannot be closed.'
              )}
            </p>
            <label>
              Reason
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Maintenance, private event, holiday…"
              />
            </label>
            <button type="submit" className="admin-save" disabled={!date || Boolean(busy)}>
              {busy === 'add' ? 'Closing…' : date ? `Close ${prettyDate(date)}` : 'Close date'}
            </button>
          </form>
        </div>
      </section>

      <section className="admin-card">
        <h3>Closed dates</h3>
        <FolderList
          empty="No closed dates. The resort is open across the whole booking window."
          groups={[
            { id: 'upcoming', label: 'Upcoming', items: upcoming, defaultOpen: true },
            { id: 'past', label: 'Past', items: past },
          ]}
          renderItem={(row) => (
            <li key={row.closure_date}>
              <div>
                <b>{prettyDate(row.closure_date)}</b>
                <small>{row.reason || 'Closed'}</small>
              </div>
              <button
                type="button"
                className="desk-ghost"
                disabled={Boolean(busy)}
                onClick={() => handleRemove(row.closure_date)}
              >
                {busy === `remove:${row.closure_date}` ? 'Reopening…' : 'Reopen'}
              </button>
            </li>
          )}
        />
      </section>

      <section className="admin-card">
        <h3>Booking limits</h3>
        <p className="admin-note">
          These caps are enforced in the guest booking form and re-checked on the server when a request is submitted.
        </p>
        <div className="rate-grid">
          <label>
            Booking window (days ahead)
            <input
              type="number"
              min="1"
              max="1095"
              value={rules.max_advance_days}
              onChange={(event) =>
                setRules((current) => ({ ...current, max_advance_days: Math.max(1, Number(event.target.value) || 1) }))
              }
            />
          </label>
          <label>
            Minimum lead time (hours)
            <input
              type="number"
              min="0"
              max="720"
              value={rules.min_lead_hours}
              onChange={(event) =>
                setRules((current) => ({ ...current, min_lead_hours: Math.max(0, Number(event.target.value) || 0) }))
              }
            />
          </label>
          <label>
            Max extra hours online
            <input
              type="number"
              min="0"
              max="24"
              value={rules.max_extra_hours}
              onChange={(event) =>
                setRules((current) => ({ ...current, max_extra_hours: Math.max(0, Number(event.target.value) || 0) }))
              }
            />
          </label>
          <label>
            Max pax · Day Tour
            <input type="number" min="1" value={rules.max_pax.day} onChange={(event) => patchPax('day', event.target.value)} />
          </label>
          <label>
            Max pax · Night Tour
            <input type="number" min="1" value={rules.max_pax.night} onChange={(event) => patchPax('night', event.target.value)} />
          </label>
          <label>
            Max pax · Overnight
            <input
              type="number"
              min="1"
              value={rules.max_pax.overnight}
              onChange={(event) => patchPax('overnight', event.target.value)}
            />
          </label>
          <label>
            Max pax · Event
            <input type="number" min="1" value={rules.max_pax.event} onChange={(event) => patchPax('event', event.target.value)} />
          </label>
        </div>
        <button type="button" className="admin-save" disabled={Boolean(busy)} onClick={handleSaveRules}>
          {busy === 'rules' ? 'Saving…' : 'Save booking limits'}
        </button>
      </section>
    </div>
  )
}
