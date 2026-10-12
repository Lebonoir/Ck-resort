import { useEffect, useState } from 'react'
import { ActionToast, RoleLayout, Stat } from '../shared/RoleLayout'
import { FolderList } from '../shared/FolderList'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  adminMetrics,
  adminReports,
  deleteNotification,
  getCatalog,
  listBookings,
  listNotifications,
  listUsers,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/api'
import { peso, prettyDate, rpcError } from '../lib/format'
import UsersPanel from './UsersPanel'
import AnalyticsPanel from './AnalyticsPanel'
import SchedulePanel from './SchedulePanel'
import RatesPanel from './RatesPanel'
import AuditPanel from './AuditPanel'
import IssuesPanel from './IssuesPanel'
import ReportsPanel from './ReportsPanel'
import ReservationsPanel from './ReservationsPanel'
import BlacklistPanel from '../shared/BlacklistPanel'
import { useLiveData } from '../shared/useLiveData'
import './admin.css'

const NAV = [
  { section: 'Overview', items: ['Dashboard', 'Analytics', 'Reports'] },
  { section: 'Bookings', items: ['Reservations', 'Schedule', 'Blacklist'] },
  { section: 'Property', items: ['Property issues'] },
  { section: 'Management', items: ['Users', 'Rates'] },
  { section: 'System', items: ['Audit trail'] },
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

  // Requests no longer wait for approval; the dashboard watches unpaid holds instead.
  const pending = bookings.filter((row) => ['pending_approval', 'awaiting_downpayment'].includes(row.status))
  const plainTabs = ['Users', 'Analytics', 'Schedule', 'Audit trail', 'Property issues', 'Blacklist']

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
              : busy === 'cancel'
                ? 'Cancelling reservation…'
              : busy === 'rates'
                ? 'Saving…'
                : error || saved
        }
      />

      {!plainTabs.includes(active) ? (
        <div className="stats">
          <Stat label="Awaiting payment" value={String(pending.length)} hint="Holding a date" />
          <Stat label="Occupancy" value={`${metrics?.occupancy ?? 0}%`} hint="Rooms occupied" />
          <Stat label="Today in / out" value={`${metrics?.checkins_today ?? 0} / ${metrics?.checkouts_today ?? 0}`} hint="Check-ins / check-outs" />
          <Stat label="Collected" value={peso(metrics?.revenue)} hint="Paid receipts" />
        </div>
      ) : null}

      {active === 'Dashboard' && (
        <div className="admin-split">
          <section className="admin-card">
            <h3>Awaiting downpayment</h3>
            <ul className="admin-list">
              {pending.length === 0 ? <li>No unpaid holds. New bookings wait here until the 50% is paid.</li> : null}
              {pending.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={row.id === selectedId ? 'on' : ''}
                    onClick={() => {
                      setSelectedId(row.id)
                      setActive('Reservations')
                      setError('')
                    }}
                  >
                    <b>
                      {row.guest_name}
                      <small>
                        {row.reference} · {prettyDate(row.stay_date)}
                      </small>
                    </b>
                    <span className="pill warn">{row.status === 'pending_approval' ? 'pending' : 'unpaid'}</span>
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

      {active === 'Reservations' && (
        <ReservationsPanel
          bookings={bookings}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReload={reload}
          busy={busy}
          setBusy={setBusy}
          error={error}
          saved={saved}
          setError={setError}
          setSaved={setSaved}
        />
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

      {active === 'Property issues' && <IssuesPanel onError={setError} />}

      {active === 'Blacklist' && <BlacklistPanel users={users} canLift onError={setError} onSaved={setSaved} />}

      {active === 'Audit trail' && <AuditPanel onError={setError} />}

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

      {active === 'Rates' && catalog && <RatesPanel
          catalog={catalog}
          onError={setError}
          onSaved={setSaved}
          onReload={() => reload().catch((err) => setError(rpcError(err)))}
        />}

      {active === 'Reports' && <ReportsPanel reports={reports} />}
    </RoleLayout>
  )
}
