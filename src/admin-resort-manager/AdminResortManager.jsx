import { useEffect, useState } from 'react'
import { ActionToast, Panel, RoleLayout, Stat } from '../shared/RoleLayout'
import { FolderList, groupByMonth } from '../shared/FolderList'
import {
  adminMetrics,
  adminReports,
  approveBooking,
  deleteNotification,
  getCatalog,
  listBookings,
  listNotifications,
  listUsers,
  markNotificationRead,
  rejectBooking,
  saveLifecycleSettings,
  saveRate,
  adminLifecycleSettings,
  updateEventBand,
  updateHourRate,
  updateOvernightTier,
  updateUnitRate,
} from '../lib/api'
import { peso, prettyDate, prettyDateTime, rpcError, STATUS_LABELS, statusTone, verifiedPaid } from '../lib/format'
import UsersPanel from './UsersPanel'
import './admin.css'

const NAV = ['Dashboard', 'Approvals', 'Users', 'Rates', 'Reports']

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
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')
  const [lifecycle, setLifecycle] = useState({
    downpayment_hours: 48,
    no_show_grace_minutes: 120,
    no_show_downpayment_policy: 'retain',
  })

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
    try {
      const settings = await adminLifecycleSettings()
      if (settings) setLifecycle(settings)
    } catch {
      // Settings RPC is installed with booking_lifecycle.sql
    }
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
      <ActionToast
        busy={Boolean(busy)}
        tone={error ? 'error' : 'ok'}
        message={
          busy === 'approve'
            ? 'Approving reservation…'
            : busy === 'reject'
              ? 'Rejecting reservation…'
              : busy === 'rates'
                ? 'Saving…'
                : error || saved
        }
      />

      {active !== 'Users' ? (
        <div className="stats">
          <Stat label="Pending" value={String(metrics?.pending ?? pending.length)} hint="In queue" />
          <Stat label="Occupancy" value={`${metrics?.occupancy ?? 0}%`} hint="Rooms occupied" />
          <Stat label="Today in / out" value={`${metrics?.checkins_today ?? 0} / ${metrics?.checkouts_today ?? 0}`} hint="Check-ins / check-outs" />
          <Stat label="Collected" value={peso(metrics?.revenue)} hint="Paid receipts" />
        </div>
      ) : null}

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
                      setError('')
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
            <FolderList
              empty="No notifications yet."
              groups={[
                { id: 'unread', label: 'Unread', items: notes.filter((row) => !row.is_read), defaultOpen: true },
                { id: 'earlier', label: 'Earlier', items: notes.filter((row) => row.is_read) },
              ]}
              renderItem={(row) => (
                <li key={row.id}>
                  <div>
                    <b>{row.title}</b>
                    <small>{row.body}</small>
                  </div>
                  <div className="action-row">
                    {!row.is_read ? (
                      <button type="button" className="desk-ghost" onClick={() => markNotificationRead(row.id).then(reload)}>
                        Read
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-link danger"
                      onClick={async () => {
                        if (!window.confirm('Delete this notification?')) return
                        try {
                          await deleteNotification(row.id)
                          await reload()
                        } catch (err) {
                          setError(rpcError(err))
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )}
            />
          </section>
        </div>
      )}

      {active === 'Approvals' && (
        <div className="admin-split">
          <section className="admin-card">
            <h3>Booking queue</h3>
            <FolderList
              empty="No bookings yet."
              listClassName="admin-list"
              groups={[
                { id: 'pending_approval', label: 'Pending', items: bookings.filter((row) => row.status === 'pending_approval'), defaultOpen: true },
                {
                  id: 'awaiting_downpayment',
                  label: 'Awaiting payment',
                  items: bookings.filter((row) => row.status === 'awaiting_downpayment'),
                },
                { id: 'confirmed', label: 'Confirmed', items: bookings.filter((row) => row.status === 'confirmed') },
                {
                  id: 'stay',
                  label: 'On property',
                  items: bookings.filter((row) => row.status === 'checked_in' || row.status === 'checked_out'),
                },
                {
                  id: 'closed',
                  label: 'Closed',
                  items: bookings.filter((row) =>
                    ['completed', 'cancelled', 'rejected', 'expired', 'no_show'].includes(row.status),
                  ),
                },
              ]}
              renderItem={(request) => (
                <li key={request.id}>
                  <button
                    type="button"
                    className={request.id === selectedId ? 'on' : ''}
                    onClick={() => {
                      if (request.id !== selectedId) {
                        setError('')
                      }
                      setSelectedId(request.id)
                    }}
                  >
                    <b>
                      {request.guest_name}
                      <small>
                        {request.reference} · {prettyDate(request.stay_date)}
                      </small>
                    </b>
                    <span className={`pill ${statusTone(request.status)}`}>
                      {STATUS_LABELS[request.status] || request.status}
                    </span>
                  </button>
                </li>
              )}
            />
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
                  <b>{peso(verifiedPaid(item))}</b>
                </div>
                {item.payment_due_at && item.status === 'awaiting_downpayment' ? (
                  <div>
                    <span>Pay by</span>
                    <b>{prettyDateTime(item.payment_due_at)}</b>
                  </div>
                ) : null}
                {Number(item.credit_held) > 0 ? (
                  <div>
                    <span>Credit held</span>
                    <b>{peso(item.credit_held)}</b>
                  </div>
                ) : null}
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
                      disabled={Boolean(busy)}
                      onClick={async () => {
                        setError('')
                        setSaved('')
                        setBusy('approve')
                        try {
                          await approveBooking(item.id, override ? Number(override) : null)
                          setSaved(`${item.reference} approved. Guest can now pay 50%.`)
                          await reload()
                        } catch (err) {
                          setError(rpcError(err))
                        } finally {
                          setBusy('')
                        }
                      }}
                    >
                      {busy === 'approve' ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="desk-ghost"
                      disabled={Boolean(busy)}
                      onClick={async () => {
                        if (!window.confirm('Reject this booking?')) return
                        setError('')
                        setSaved('')
                        setBusy('reject')
                        try {
                          await rejectBooking(item.id, reason || 'Slot not available')
                          setSaved(`${item.reference} rejected.`)
                          await reload()
                        } catch (err) {
                          setError(rpcError(err))
                        } finally {
                          setBusy('')
                        }
                      }}
                    >
                      {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                    </button>
                  </div>
                </>
              )}
              {error || saved ? <p className={`flash inline-flash ${error ? 'error' : 'ok'}`}>{error || saved}</p> : null}
            </section>
          )}
        </div>
      )}

      {active === 'Users' && (
        <UsersPanel
          users={users}
          onReload={reload}
          onError={setError}
          onSaved={(message) => {
            setError('')
            setSaved(message)
          }}
        />
      )}

      {active === 'Rates' && catalog && (
        <>
        <section className="admin-card">
          <h3>Booking rules</h3>
          <p className="admin-note">Downpayment and no-show handling. The paid downpayment is never turned into a remaining-balance charge.</p>
          <div className="rate-grid">
            <label>
              Downpayment deadline (hours)
              <input
                type="number"
                min="1"
                max="168"
                value={lifecycle.downpayment_hours}
                onChange={(event) => setLifecycle((row) => ({ ...row, downpayment_hours: Number(event.target.value) || 1 }))}
              />
            </label>
            <label>
              No-show grace (minutes)
              <input
                type="number"
                min="15"
                max="720"
                value={lifecycle.no_show_grace_minutes}
                onChange={(event) => setLifecycle((row) => ({ ...row, no_show_grace_minutes: Number(event.target.value) || 15 }))}
              />
            </label>
            <label>
              No-show downpayment
              <select
                value={lifecycle.no_show_downpayment_policy}
                onChange={(event) => setLifecycle((row) => ({ ...row, no_show_downpayment_policy: event.target.value }))}
              >
                <option value="retain">Retain as revenue</option>
                <option value="credit">Hold as guest credit</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="admin-save"
            disabled={Boolean(busy)}
            onClick={async () => {
              setError('')
              setSaved('')
              setBusy('rates')
              try {
                const savedSettings = await saveLifecycleSettings({
                  downpaymentHours: lifecycle.downpayment_hours,
                  graceMinutes: lifecycle.no_show_grace_minutes,
                  policy: lifecycle.no_show_downpayment_policy,
                })
                setLifecycle(savedSettings)
                setSaved('Booking rules saved.')
              } catch (err) {
                setError(rpcError(err))
              } finally {
                setBusy('')
              }
            }}
          >
            {busy === 'rates' ? 'Saving…' : 'Save booking rules'}
          </button>
        </section>
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
            {catalog.overnight.map((tier) => (
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
        </>
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
          <FolderList
            empty="No payments recorded yet."
            groups={groupByMonth(reports?.payments || [], (row) => row.paid_at)}
            renderItem={(row) => (
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
            )}
          />
        </Panel>
      )}
    </RoleLayout>
  )
}
