import { useEffect, useState } from 'react'
import { Panel, RoleLayout, Stat } from '../shared/RoleLayout'
import {
  adminMetrics,
  adminReports,
  approveBooking,
  getCatalog,
  inviteStaff,
  listBookings,
  listNotifications,
  listUsers,
  markNotificationRead,
  rejectBooking,
  saveRate,
  updateEventBand,
  updateHourRate,
  updateOvernightTier,
  updateUnitRate,
} from '../lib/api'
import { peso, prettyDate, rpcError, STATUS_LABELS } from '../lib/format'
import './admin.css'

const NAV = ['Dashboard', 'Approvals', 'Users', 'Rates', 'Reports']
const ROLE_OPTIONS = [
  { id: 'front_desk', label: 'Front Desk / Cashier' },
  { id: 'staff', label: 'Resort Operations / Staff' },
  { id: 'admin', label: 'Admin / Resort Manager' },
]

export default function AdminResortManager({ session, onSignOut }) {
  const [active, setActive] = useState('Dashboard')
  const [metrics, setMetrics] = useState(null)
  const [bookings, setBookings] = useState([])
  const [users, setUsers] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [reports, setReports] = useState(null)
  const [notes, setNotes] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [override, setOverride] = useState('')
  const [reason, setReason] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('front_desk')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  async function reload() {
    const [nextMetrics, nextBookings, nextUsers, nextCatalog, nextReports, nextNotes] = await Promise.all([
      adminMetrics(),
      listBookings(),
      listUsers(),
      getCatalog(),
      adminReports(),
      listNotifications(),
    ])
    setMetrics(nextMetrics)
    setBookings(nextBookings)
    setUsers(nextUsers)
    setCatalog(nextCatalog)
    setReports(nextReports)
    setNotes(nextNotes)
    if (!selectedId && nextBookings[0]) setSelectedId(nextBookings[0].id)
  }

  useEffect(() => {
    reload().catch((err) => setError(rpcError(err)))
  }, [])

  const item = bookings.find((row) => row.id === selectedId)
  const pending = bookings.filter((row) => row.status === 'pending_approval')

  function exportCsv() {
    const rows = (reports?.payments || []).map((row) =>
      [row.receipt_no, row.reference, row.guest, row.type, row.method, row.amount, row.status, row.paid_at].join(','),
    )
    const csv = ['receipt,reference,guest,type,method,amount,status,paid_at', ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'ck-resort-payments.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <RoleLayout
      roleId="admin"
      name={session.name}
      nav={NAV}
      active={active}
      onNav={setActive}
      onSignOut={onSignOut}
      unread={notes.filter((row) => !row.is_read).length}
    >
      {error ? <p className="flash error">{error}</p> : null}
      {saved ? <p className="flash ok">{saved}</p> : null}

      <div className="stats">
        <Stat label="Pending" value={String(metrics?.pending ?? pending.length)} hint="In queue" />
        <Stat label="Occupancy" value={`${metrics?.occupancy ?? 0}%`} hint="Rooms occupied" />
        <Stat label="Today in / out" value={`${metrics?.checkins_today ?? 0} / ${metrics?.checkouts_today ?? 0}`} hint="Check-ins / check-outs" />
        <Stat label="Collected" value={peso(metrics?.revenue)} hint="Paid receipts" />
      </div>

      {active === 'Dashboard' && (
        <div className="admin-split">
          <section className="admin-card">
            <h3>Pending reservations</h3>
            <ul className="admin-list">
              {pending.length === 0 ? <li>No pending requests.</li> : null}
              {pending.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={row.id === selectedId ? 'on' : ''}
                    onClick={() => {
                      setSelectedId(row.id)
                      setActive('Approvals')
                    }}
                  >
                    <b>
                      {row.guest_name}
                      <small>
                        {row.reference} · {prettyDate(row.stay_date)}
                      </small>
                    </b>
                    <span className="pill warn">pending</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="admin-card">
            <h3>Notifications</h3>
            <ul className="list">
              {notes.slice(0, 8).map((row) => (
                <li key={row.id}>
                  <div>
                    <b>{row.title}</b>
                    <small>{row.body}</small>
                  </div>
                  {!row.is_read ? (
                    <button type="button" className="desk-ghost" onClick={() => markNotificationRead(row.id).then(reload)}>
                      Read
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {active === 'Approvals' && (
        <div className="admin-split">
          <section className="admin-card">
            <h3>Booking queue</h3>
            <ul className="admin-list">
              {bookings.map((request) => (
                <li key={request.id}>
                  <button type="button" className={request.id === selectedId ? 'on' : ''} onClick={() => setSelectedId(request.id)}>
                    <b>
                      {request.guest_name}
                      <small>
                        {request.reference} · {prettyDate(request.stay_date)}
                      </small>
                    </b>
                    <span className={`pill ${request.status === 'confirmed' || request.status === 'checked_in' ? 'ok' : request.status === 'rejected' ? 'no' : 'warn'}`}>
                      {STATUS_LABELS[request.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {item && (
            <section className="admin-card">
              <h3>{item.guest_name}</h3>
              <div className="detail-grid">
                <div>
                  <span>Package</span>
                  <b>{item.package_label}</b>
                </div>
                <div>
                  <span>Date / pax</span>
                  <b>
                    {prettyDate(item.stay_date)} · {item.pax} pax
                  </b>
                </div>
                <div>
                  <span>Total</span>
                  <b>{peso(item.override_amount || item.total_amount)}</b>
                </div>
                <div>
                  <span>50% DP</span>
                  <b>{peso(item.downpayment_amount)}</b>
                </div>
                <div>
                  <span>Paid</span>
                  <b>{peso(item.paid_amount)}</b>
                </div>
                <div>
                  <span>Status</span>
                  <b>{STATUS_LABELS[item.status]}</b>
                </div>
              </div>
              {item.status === 'pending_approval' && (
                <>
                  <label>
                    Custom total override (optional)
                    <input type="number" min="0" value={override} onChange={(event) => setOverride(event.target.value)} placeholder={String(item.total_amount)} />
                  </label>
                  <label>
                    Rejection reason
                    <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional note" />
                  </label>
                  <div className="action-row">
                    <button
                      type="button"
                      className="book-btn"
                      onClick={async () => {
                        try {
                          await approveBooking(item.id, override ? Number(override) : null)
                          setSaved(`${item.reference} approved. Guest can now pay 50%.`)
                          await reload()
                        } catch (err) {
                          setError(rpcError(err))
                        }
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="desk-ghost"
                      onClick={async () => {
                        if (!window.confirm('Reject this booking?')) return
                        try {
                          await rejectBooking(item.id, reason || 'Slot not available')
                          setSaved(`${item.reference} rejected.`)
                          await reload()
                        } catch (err) {
                          setError(rpcError(err))
                        }
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {active === 'Users' && (
        <div className="admin-split">
          <section className="admin-card">
            <h3>Create staff account</h3>
            <form
              className="user-form"
              onSubmit={async (event) => {
                event.preventDefault()
                try {
                  await inviteStaff(email, name, role)
                  setName('')
                  setEmail('')
                  setSaved('Invite saved. They must register with that email, then they receive the assigned role.')
                  await reload()
                } catch (err) {
                  setError(rpcError(err))
                }
              }}
            >
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" required />
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" required />
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                {ROLE_OPTIONS.map((itemRole) => (
                  <option key={itemRole.id} value={itemRole.id}>
                    {itemRole.label}
                  </option>
                ))}
              </select>
              <button type="submit">Save invite</button>
            </form>
            <p className="admin-note">Guests still sign up on their own. Staff/admin must register using the invited email.</p>
          </section>
          <section className="admin-card">
            <h3>Directory</h3>
            <ul className="list">
              {users.map((user) => (
                <li key={user.id}>
                  <div>
                    <b>
                      {user.first_name} {user.last_name}
                    </b>
                    <small>
                      {user.role} · {user.email}
                    </small>
                  </div>
                  <span className="pill ok">{user.is_active ? 'active' : 'inactive'}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {active === 'Rates' && catalog && (
        <section className="admin-card">
          <h3>Package & surcharge rates</h3>
          <div className="rate-grid">
            {catalog.rates.map((rate) => (
              <label key={rate.key}>
                {rate.label}
                <input
                  type="number"
                  min="0"
                  defaultValue={rate.amount}
                  onBlur={async (event) => {
                    try {
                      await saveRate(rate.key, Number(event.target.value) || 0)
                      setSaved('Rate saved. New quotes will use this amount.')
                    } catch (err) {
                      setError(rpcError(err))
                    }
                  }}
                />
              </label>
            ))}
            {catalog.hours.map((row) => (
              <label key={`${row.tour_type}-${row.hours}`}>
                {row.tour_type} tour · 30 pax · {row.hours}h
                <input
                  type="number"
                  min="0"
                  defaultValue={row.amount}
                  onBlur={(event) =>
                    updateHourRate(row.tour_type, row.hours, Number(event.target.value) || 0)
                      .then(() => setSaved('Hourly package rate saved.'))
                      .catch((err) => setError(rpcError(err)))
                  }
                />
              </label>
            ))}
              <label key={tier.pax_cap}>
                Overnight · {tier.pax_cap} pax
                <input
                  type="number"
                  min="0"
                  defaultValue={tier.amount}
                  onBlur={(event) => updateOvernightTier(tier.pax_cap, Number(event.target.value) || 0).then(() => setSaved('Overnight tier saved.')).catch((err) => setError(rpcError(err)))}
                />
              </label>
            ))}
            {catalog.events.map((band) => (
              <label key={`d-${band.max_pax}`}>
                Event day · {band.max_pax} pax
                <input
                  type="number"
                  min="0"
                  defaultValue={band.day_amount}
                  onBlur={(event) => updateEventBand(band.max_pax, { day_amount: Number(event.target.value) || 0 }).then(() => setSaved('Event rate saved.')).catch((err) => setError(rpcError(err)))}
                />
              </label>
            ))}
            {catalog.units.map((unit) => (
              <label key={unit.id}>
                {unit.slug} rate
                <input
                  type="number"
                  min="0"
                  defaultValue={unit.rate}
                  onBlur={(event) => updateUnitRate(unit.id, Number(event.target.value) || 0).then(() => setSaved('Room rate saved.')).catch((err) => setError(rpcError(err)))}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {active === 'Reports' && (
        <Panel title="Sales & payments">
          <button type="button" className="admin-save" onClick={exportCsv}>
            Export payments CSV
          </button>
          <ul className="report-bars list">
            {(reports?.by_package || []).map((row) => (
              <li key={row.label}>
                <div>
                  <b>
                    {row.label}
                    <small>
                      {row.count} bookings · {peso(row.amount)}
                    </small>
                  </b>
                </div>
              </li>
            ))}
          </ul>
          <ul className="list">
            {(reports?.payments || []).slice(0, 30).map((row) => (
              <li key={row.id}>
                <div>
                  <b>
                    {row.receipt_no || 'Pending'} · {row.reference}
                  </b>
                  <small>
                    {row.guest} · {row.method} · {row.type}
                  </small>
                </div>
                <span className="pill">{peso(row.amount)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </RoleLayout>
  )
}
