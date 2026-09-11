import { useEffect, useState } from 'react'
import { ActionToast, Panel, RoleLayout, Stat } from '../shared/RoleLayout'
import { FolderList, groupByMonth } from '../shared/FolderList'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  adminMetrics,
  adminReports,
  approveBooking,
  deleteNotification,
  getCatalog,
  listBookings,
  listNotifications,
  listUsers,
  markAllNotificationsRead,
  markNotificationRead,
  rejectBooking,
} from '../lib/api'
import { peso, prettyDate, prettyDateTime, rpcError, STATUS_LABELS, statusTone, verifiedPaid } from '../lib/format'
import UsersPanel from './UsersPanel'
import AnalyticsPanel from './AnalyticsPanel'
import SchedulePanel from './SchedulePanel'
import RatesPanel from './RatesPanel'
import SettingsPanel from './SettingsPanel'
import { useLiveData } from '../shared/useLiveData'
import './admin.css'

const NAV = [
  { section: 'Overview', items: ['Dashboard', 'Analytics', 'Reports'] },
  { section: 'Operations', items: ['Approvals', 'Schedule'] },
  { section: 'Management', items: ['Users', 'Rates'] },
  { section: 'System', items: ['Settings'] },
]

export default function AdminResortManager({ session, onSignOut }) {
  const confirm = useConfirm()
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

  useLiveData(() => reload().catch(() => {}), { channel: 'admin' })

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

      {!['Users', 'Analytics', 'Schedule', 'Settings'].includes(active) ? (
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
            <div className="bell-panel-head">
              <h3>Notifications</h3>
              {notes.some((row) => !row.is_read) ? (
                <button
                  type="button"
                  className="desk-ghost"
                  onClick={async () => {
                    try {
                      await markAllNotificationsRead()
                      await reload()
                    } catch (err) {
                      setError(rpcError(err))
                    }
                  }}
                >
                  Mark all as read
                </button>
              ) : null}
            </div>
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
                        const ok = await confirm({
                          title: 'Delete notification',
                          message: 'Remove this notification from your list?',
                          confirmLabel: 'Delete',
                          danger: true,
                        })
                        if (!ok) return
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
                        const ok = await confirm({
                          title: 'Approve reservation',
                          message: `Approve ${item.reference} for ${item.guest_name}? The guest will be asked to pay a 50% downpayment.`,
                          confirmLabel: 'Approve',
                        })
                        if (!ok) return
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
                        const ok = await confirm({
                          title: 'Reject reservation',
                          message: `Reject ${item.reference}? The guest will be notified.`,
                          confirmLabel: 'Reject',
                          danger: true,
                        })
                        if (!ok) return
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

      {active === 'Analytics' && <AnalyticsPanel onError={setError} />}

      {active === 'Settings' && (
        <SettingsPanel
          onError={setError}
          onSaved={setSaved}
          onRestored={() => reload().catch((err) => setError(rpcError(err)))}
        />
      )}

      {active === 'Schedule' && (
        <SchedulePanel
          bookings={bookings}
          onError={setError}
          onSaved={(message) => {
            setError('')
            setSaved(message)
          }}
        />
      )}

      {active === 'Rates' && catalog && <RatesPanel catalog={catalog} onError={setError} onSaved={setSaved} />}

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
