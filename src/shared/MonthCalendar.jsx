import { useState } from 'react'
import './calendar.css'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function manilaTodayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

export function addDaysIso(iso, days) {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate())
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function monthKeyOf(year, month) {
  return year * 12 + month
}

function monthOf(iso) {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1]
}

/**
 * Month grid shared by the guest booking flow and the admin schedule page.
 * `dayState(iso)` returns `{ className, disabled, title }` so each caller
 * decides what "unavailable" means; `legend` documents those markers.
 */
export default function MonthCalendar({ value, onChange, minDate, maxDate, dayState, legend = [] }) {
  const [startYear, startMonth] = monthOf(minDate || value || manilaTodayIso())
  const [cursor, setCursor] = useState(() => new Date(startYear, startMonth, 1))
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1).getDay()
  const total = daysInMonth(year, month)
  const cells = Array.from({ length: first }, () => null).concat(
    Array.from({ length: total }, (_, index) => index + 1),
  )

  const currentKey = monthKeyOf(year, month)
  const canGoBack = !minDate || currentKey > monthKeyOf(...monthOf(minDate))
  const canGoForward = !maxDate || currentKey < monthKeyOf(...monthOf(maxDate))

  return (
    <div className="cal">
      <div className="cal-head">
        <button
          type="button"
          disabled={!canGoBack}
          aria-label="Previous month"
          onClick={() => canGoBack && setCursor(new Date(year, month - 1, 1))}
        >
          ‹
        </button>
        <strong>{cursor.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</strong>
        <button
          type="button"
          disabled={!canGoForward}
          aria-label="Next month"
          onClick={() => canGoForward && setCursor(new Date(year, month + 1, 1))}
        >
          ›
        </button>
      </div>
      <div className="cal-grid labels">
        {WEEKDAYS.map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((day, index) => {
          if (!day) return <span key={`e-${index}`} />
          const iso = isoDate(year, month, day)
          if ((minDate && iso < minDate) || (maxDate && iso > maxDate)) {
            return <span key={iso} className="cal-blank" />
          }
          const state = dayState?.(iso) || {}
          const weekend = [0, 5, 6].includes(new Date(`${iso}T00:00:00`).getDay())
          return (
            <button
              key={iso}
              type="button"
              title={state.title}
              disabled={state.disabled}
              className={`${value === iso ? 'picked' : ''} ${weekend ? 'wk' : ''} ${state.className || ''}`}
              onClick={() => onChange(iso)}
            >
              {day}
            </button>
          )
        })}
      </div>
      {legend.length ? (
        <ul className="cal-legend">
          {legend.map((item) => (
            <li key={item.label}>
              <span className={`key ${item.kind}`} /> {item.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
