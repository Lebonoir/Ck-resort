import { useMemo, useState } from 'react'
import { monthKey, monthLabel } from '../shared/FolderList'
import { peso, prettyDateTime } from '../lib/format'

const PACKAGE_LABELS = {
  day: 'Day tour',
  night: 'Night tour',
  overnight: 'Overnight stay',
  event: 'Event',
}

const METHOD_LABELS = {
  paymongo: 'PayMongo',
  cash: 'Cash',
  ewallet: 'E-wallet',
  bank: 'Bank transfer',
}

const TYPE_LABELS = {
  downpayment: 'Downpayment',
  balance: 'Balance',
  onsite: 'On-site',
  full: 'Full payment',
}

const STATUS_PILLS = {
  pending: { label: 'Pending', tone: 'warn' },
  failed: { label: 'Failed', tone: 'no' },
  refunded: { label: 'Refunded', tone: 'no' },
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Sales & payments: what each package and payment method brought in, then the
 * full payment ledger, filterable by month and searchable.
 */
export default function ReportsPanel({ reports }) {
  const [month, setMonth] = useState('all')
  const [query, setQuery] = useState('')

  const payments = reports?.payments || []
  const paid = useMemo(() => payments.filter((row) => row.status === 'paid'), [payments])
  const collected = paid.reduce((sum, row) => sum + Number(row.amount || 0), 0)

  const packages = useMemo(
    () => [...(reports?.by_package || [])].sort((left, right) => Number(right.amount) - Number(left.amount)),
    [reports],
  )
  const packageMax = Math.max(...packages.map((row) => Number(row.amount) || 0), 1)

  const methods = useMemo(() => {
    const map = new Map()
    for (const row of paid) {
      const entry = map.get(row.method) || { method: row.method, count: 0, amount: 0 }
      entry.count += 1
      entry.amount += Number(row.amount || 0)
      map.set(row.method, entry)
    }
    return [...map.values()].sort((left, right) => right.amount - left.amount)
  }, [paid])

  // Newest month first; payments that never cleared have no date and sit last.
  const months = useMemo(() => {
    const counts = new Map()
    for (const row of payments) {
      const key = monthKey(row.paid_at)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((left, right) => (left[0] === 'unknown' ? 1 : right[0] === 'unknown' ? -1 : right[0].localeCompare(left[0])))
      .map(([id, count]) => ({ id, count, label: id === 'unknown' ? 'Not cleared' : monthLabel(id) }))
  }, [payments])

  const needle = query.trim().toLowerCase()
  const rows = payments.filter((row) => {
    if (month !== 'all' && monthKey(row.paid_at) !== month) return false
    if (!needle) return true
    return [row.receipt_no, row.reference, row.guest].some((value) => String(value || '').toLowerCase().includes(needle))
  })
  const rowsTotal = rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0)

  function exportCsv() {
    const lines = rows.map((row) =>
      [row.receipt_no, row.reference, row.guest, row.type, row.method, row.amount, row.status, row.paid_at]
        .map(csvCell)
        .join(','),
    )
    const csv = ['receipt,reference,guest,type,method,amount,status,paid_at', ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = month === 'all' ? 'ck-resort-payments.csv' : `ck-resort-payments-${month}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!reports) {
    return (
      <div className="rep-page">
        <div className="rep-top">
          <div className="skeleton skeleton-card" style={{ minHeight: 190 }} />
          <div className="skeleton skeleton-card" style={{ minHeight: 190 }} />
        </div>
        <div className="skeleton skeleton-card" style={{ minHeight: 320 }} />
      </div>
    )
  }

  return (
    <div className="rep-page">
      <div className="rep-top">
        <section className="admin-card">
          <div>
            <h3>Collected by package</h3>
            <p className="admin-note">Paid so far on bookings that were not cancelled or rejected.</p>
          </div>
          {packages.length === 0 ? (
            <p className="admin-note">No bookings yet. Packages appear here once guests start booking.</p>
          ) : (
            <ul className="rep-packages">
              {packages.map((row) => (
                <li key={row.label}>
                  <div className="rep-package-head">
                    <b>{PACKAGE_LABELS[row.label] || row.label}</b>
                    <span>
                      {row.count} {Number(row.count) === 1 ? 'booking' : 'bookings'}
                    </span>
                    <strong>{peso(row.amount)}</strong>
                  </div>
                  <span className="analytics-track">
                    <span
                      className="analytics-fill"
                      style={{ width: `${((Number(row.amount) || 0) / packageMax) * 100}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-card">
          <h3>How guests paid</h3>
          {methods.length === 0 ? (
            <p className="admin-note">No cleared payments yet.</p>
          ) : (
            <ul className="rep-methods">
              {methods.map((row) => (
                <li key={row.method}>
                  <span>
                    {METHOD_LABELS[row.method] || row.method}
                    <small>
                      {row.count} {row.count === 1 ? 'payment' : 'payments'}
                    </small>
                  </span>
                  <b>{peso(row.amount)}</b>
                </li>
              ))}
              <li className="rep-methods-total">
                <span>Total collected</span>
                <b>{peso(collected)}</b>
              </li>
            </ul>
          )}
        </section>
      </div>

      <section className="admin-card">
        <div className="users-toolbar">
          <div>
            <h3>Payment ledger</h3>
            <p className="admin-note">
              {rows.length} {rows.length === 1 ? 'payment' : 'payments'} shown · {peso(rowsTotal)} cleared
            </p>
          </div>
          <button type="button" className="admin-save" disabled={!rows.length} onClick={exportCsv}>
            Export CSV
          </button>
        </div>

        {payments.length === 0 ? (
          <p className="admin-note">No payments recorded yet. Downpayments and counter payments are listed here.</p>
        ) : (
          <>
            <div className="rep-filters">
              <div className="rep-months" role="group" aria-label="Filter by month">
                <button type="button" className={month === 'all' ? 'on' : ''} onClick={() => setMonth('all')}>
                  All
                  <span>{payments.length}</span>
                </button>
                {months.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={month === item.id ? 'on' : ''}
                    onClick={() => setMonth(item.id)}
                  >
                    {item.label}
                    <span>{item.count}</span>
                  </button>
                ))}
              </div>
              <label className="rep-search">
                <span>Search</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Guest, reference or receipt"
                />
              </label>
            </div>

            <div className="rep-ledger">
              <div className="rep-row rep-row-head" aria-hidden="true">
                <span>Receipt</span>
                <span>Guest</span>
                <span>Paid via</span>
                <span>Cleared</span>
                <span>Amount</span>
              </div>
              {rows.length === 0 ? (
                <p className="admin-note rep-none">No payments match this filter.</p>
              ) : (
                <ul>
                  {rows.map((row) => {
                    const pill = STATUS_PILLS[row.status]
                    return (
                      <li key={row.id} className="rep-row">
                        <span className="rep-receipt">{row.receipt_no || 'No receipt'}</span>
                        <span className="rep-guest">
                          <b>{row.guest}</b>
                          <small>{row.reference}</small>
                        </span>
                        <span className="rep-via">
                          {METHOD_LABELS[row.method] || row.method}
                          <small>{TYPE_LABELS[row.type] || row.type}</small>
                        </span>
                        <span className="rep-date">
                          {row.paid_at ? prettyDateTime(row.paid_at) : pill ? <i className={`pill ${pill.tone}`}>{pill.label}</i> : '—'}
                        </span>
                        <strong className={row.status === 'paid' ? '' : 'rep-void'}>{peso(row.amount)}</strong>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
