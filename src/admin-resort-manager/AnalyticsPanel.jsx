import { useCallback, useEffect, useState } from 'react'
import { Stat } from '../shared/RoleLayout'
import { FolderList, groupByMonth } from '../shared/FolderList'
import { adminAnalytics, reviewStats } from '../lib/api'
import { peso, prettyDate, prettyDateTime, rpcError, STATUS_LABELS } from '../lib/format'

const RATING_CATEGORIES = [
  { key: 'overall', label: 'Overall' },
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'amenities', label: 'Pool & amenities' },
  { key: 'staff', label: 'Staff & service' },
  { key: 'value_rating', label: 'Value for money' },
]

function StarMeter({ score }) {
  const rounded = Math.round(Number(score) || 0)
  return (
    <span className="star-meter" title={`${score} of 5`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <span key={index} className={index <= rounded ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  )
}

function todayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

function shiftIso(iso, days) {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('en-CA')
}

const PRESETS = [
  { id: '7', label: 'Last 7 days', days: 6 },
  { id: '30', label: 'Last 30 days', days: 29 },
  { id: '90', label: 'Last 90 days', days: 89 },
]

function Bars({ rows, valueKey, labelKey, format = (value) => String(value) }) {
  const max = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 1)
  if (!rows.length) return <p className="admin-note">Nothing in this range.</p>
  return (
    <ul className="analytics-bars">
      {rows.map((row) => (
        <li key={row[labelKey]}>
          <span className="analytics-bar-label">{STATUS_LABELS[row[labelKey]] || row[labelKey]}</span>
          <span className="analytics-track">
            <span className="analytics-fill" style={{ width: `${((Number(row[valueKey]) || 0) / max) * 100}%` }} />
          </span>
          <b>{format(row[valueKey])}</b>
        </li>
      ))}
    </ul>
  )
}

export default function AnalyticsPanel({ onError }) {
  const [from, setFrom] = useState(() => shiftIso(todayIso(), -29))
  const [to, setTo] = useState(todayIso)
  const [data, setData] = useState(null)
  const [reviews, setReviews] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (nextFrom, nextTo) => {
      setLoading(true)
      try {
        const result = await adminAnalytics(nextFrom, nextTo)
        setData(result)
        onError('')
      } catch (err) {
        onError(rpcError(err))
      } finally {
        setLoading(false)
      }
    },
    [onError],
  )

  useEffect(() => {
    load(from, to)
    reviewStats().then(setReviews)
  }, [])

  function applyPreset(days) {
    const nextTo = todayIso()
    const nextFrom = shiftIso(nextTo, -days)
    setFrom(nextFrom)
    setTo(nextTo)
    load(nextFrom, nextTo)
  }

  function exportCsv() {
    const rows = (data?.payments || []).map((row) =>
      [row.receipt_no, row.reference, row.guest, row.type, row.method, row.amount, row.paid_at].join(','),
    )
    const csv = ['receipt,reference,guest,type,method,amount,paid_at', ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ck-resort-analytics-${from}-to-${to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const totals = data?.totals || {}
  const revenue = data?.revenue || {}
  const daily = (data?.daily || []).filter((row) => row.bookings > 0 || Number(row.collected) > 0)

  return (
    <div className="analytics-page">
      <section className="admin-card">
        <div className="users-toolbar">
          <div>
            <h3>Report range</h3>
            <p className="admin-note">Bookings are counted by stay date; collections by the date payment cleared.</p>
          </div>
          <button type="button" className="admin-save" disabled={!data?.payments?.length} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
        <div className="analytics-filters">
          <label>
            From
            <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </label>
          <button type="button" className="admin-save" disabled={loading} onClick={() => load(from, to)}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
        <div className="chip-row tight">
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="mini" onClick={() => applyPreset(preset.days)}>
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <div className="stats">
        <Stat label="Bookings" value={String(totals.bookings ?? 0)} hint="Stays in range" />
        <Stat label="Guests" value={String(totals.guests ?? 0)} hint="Total pax booked" />
        <Stat label="Collected" value={peso(revenue.collected)} hint={`${revenue.payments ?? 0} payments`} />
        <Stat label="Booked value" value={peso(totals.booked_value)} hint="Quoted totals" />
      </div>

      <div className="analytics-masonry">
        <section className="admin-card">
          <h3>Revenue by source</h3>
          <ul className="ticket-lines">
            <li>
              <span>PayMongo downpayments</span>
              <b>{peso(revenue.paymongo)}</b>
            </li>
            <li>
              <span>Cash at counter</span>
              <b>{peso(revenue.cash)}</b>
            </li>
            <li>
              <span>E-wallet at counter</span>
              <b>{peso(revenue.ewallet)}</b>
            </li>
            <li className="ticket-subtotal">
              <span>Total collected</span>
              <b>{peso(revenue.collected)}</b>
            </li>
          </ul>
          <h3 style={{ marginTop: 18 }}>Outcomes</h3>
          <ul className="ticket-lines">
            <li>
              <span>Completed stays</span>
              <b>{totals.completed ?? 0}</b>
            </li>
            <li>
              <span>Cancelled / rejected</span>
              <b>{totals.cancelled ?? 0}</b>
            </li>
            <li>
              <span>No-shows</span>
              <b>{totals.no_show ?? 0}</b>
            </li>
          </ul>
        </section>

        <section className="admin-card">
          <h3>Bookings by package</h3>
          <Bars rows={data?.by_package || []} labelKey="label" valueKey="count" />
          <h3 style={{ marginTop: 18 }}>Revenue by package</h3>
          <Bars rows={data?.by_package || []} labelKey="label" valueKey="amount" format={peso} />
        </section>

        <section className="admin-card">
          <h3>Booking status mix</h3>
          <Bars rows={data?.by_status || []} labelKey="label" valueKey="count" />
        </section>

        <section className="admin-card">
          <h3>Most requested rentals</h3>
          <Bars rows={data?.top_rentals || []} labelKey="label" valueKey="count" />
        </section>
      </div>

      <section className="admin-card">
        <h3>Daily activity</h3>
        {daily.length === 0 ? (
          <p className="admin-note">No bookings or payments in this range.</p>
        ) : (
          <ul className="analytics-bars">
            {daily.map((row) => (
              <li key={row.date}>
                <span className="analytics-bar-label">{prettyDate(row.date)}</span>
                <span className="analytics-track">
                  <span
                    className="analytics-fill"
                    style={{
                      width: `${(Number(row.collected) / Math.max(...daily.map((item) => Number(item.collected) || 0), 1)) * 100}%`,
                    }}
                  />
                </span>
                <b>
                  {row.bookings} · {peso(row.collected)}
                </b>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-card">
        <h3>Payments in range</h3>
        <FolderList
          empty="No payments cleared in this range."
          groups={groupByMonth(data?.payments || [], (row) => row.paid_at)}
          renderItem={(row) => (
            <li key={row.id}>
              <div>
                <b>
                  {row.receipt_no || 'Receipt'} · {row.reference}
                </b>
                <small>
                  {row.guest} · {row.method} · {row.type}
                </small>
              </div>
              <span className="pill">{peso(row.amount)}</span>
            </li>
          )}
        />
      </section>

      <section className="admin-card">
        <h3>Guest satisfaction</h3>
        <p className="admin-note">
          Averages across every rated stay, all time — ratings are collected after a stay is completed, so this is not
          limited by the date range above.
        </p>
        {!reviews || !reviews.total ? (
          <p className="hint">No ratings submitted yet.</p>
        ) : (
          <>
            <div className="rating-summary">
              <div className="rating-score">
                <strong>{Number(reviews.averages.overall).toFixed(2)}</strong>
                <StarMeter score={reviews.averages.overall} />
                <small>
                  {reviews.total} rated {reviews.total === 1 ? 'stay' : 'stays'}
                </small>
              </div>
              <ul className="rating-bars">
                {RATING_CATEGORIES.map((item) => {
                  const score = Number(reviews.averages[item.key]) || 0
                  return (
                    <li key={item.key}>
                      <span>{item.label}</span>
                      <span className="rating-track">
                        <span className="rating-fill" style={{ width: `${(score / 5) * 100}%` }} />
                      </span>
                      <b>{score.toFixed(2)}</b>
                    </li>
                  )
                })}
              </ul>
            </div>

            {reviews.recent?.length ? (
              <ul className="list rating-comments">
                {reviews.recent
                  .filter((row) => row.comment)
                  .slice(0, 8)
                  .map((row) => (
                    <li key={`${row.reference}-${row.created_at}`}>
                      <div>
                        <b>
                          {row.reference} · {row.guest}
                        </b>
                        <small>“{row.comment}”</small>
                        <small>{prettyDateTime(row.created_at)}</small>
                      </div>
                      <span className="pill">{row.overall}/5</span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
