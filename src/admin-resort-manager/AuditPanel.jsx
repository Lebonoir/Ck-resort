import { useEffect, useMemo, useState } from 'react'
import { adminAuditActions, adminAuditLog } from '../lib/api'
import { ROLE_SHORT, rpcError } from '../lib/format'

// Human wording for the action names the SQL layer records.
const ACTION_LABELS = {
  submit_booking: 'Submitted a booking',
  create_walk_in: 'Created a walk-in',
  approve_booking: 'Approved a booking',
  reject_booking: 'Rejected a booking',
  cancel_booking: 'Cancelled a booking',
  rebook_booking: 'Rebooked a stay',
  check_in: 'Checked a guest in',
  check_out: 'Checked a guest out',
  collect_payment: 'Collected a payment',
  set_headcount: 'Updated the headcount',
  add_booking_charge: 'Added an on-site charge',
  add_booking_addon: 'Added an add-on',
  add_booking_room: 'Added a room',
  add_extra_hours: 'Added extra hours',
  report_damage: 'Reported a damaged item',
  dispatch_rental: 'Dispatched a rental',
  return_rental: 'Marked a rental returned',
  set_room_status: 'Changed a room status',
  occupy_room: 'Marked a room occupied',
  start_utility_repair: 'Started a repair',
  save_rate: 'Updated a rate',
  save_price: 'Added or changed a price',
  delete_price: 'Removed a price',
  invite_staff: 'Invited a staff account',
  admin_update_account: 'Updated an account',
  admin_delete_account: 'Deleted an account',
  submit_review: 'Rated a stay',
  close_date: 'Closed a date',
  reopen_date: 'Reopened a date',
  save_booking_rules: 'Changed booking rules',
  create_backup: 'Created a backup',
  download_backup: 'Downloaded a backup',
  delete_backup: 'Deleted a backup',
  restore_backup: 'Restored a backup',
}

const PAGE = 60
const EMPTY_FILTERS = { action: '', from: '', to: '' }

function actionLabel(action) {
  return ACTION_LABELS[action] || action.replace(/_/g, ' ')
}

function metaSummary(meta) {
  if (!meta || typeof meta !== 'object') return ''
  return Object.entries(meta)
    // The booking reference already sits beside the action as its own tag.
    .filter(([key, value]) => key !== 'reference' && value !== null && value !== '' && typeof value !== 'object')
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
    .join(' · ')
}

function dayKey(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

function dayLabel(key) {
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - 24 * 3600 * 1000)
  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function timeLabel(value) {
  return new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
}

/**
 * Audit trail: who did what and when, as a day-by-day timeline. Filters by
 * action and date go to the server; the search box narrows what is loaded.
 */
export default function AuditPanel({ onError }) {
  const [rows, setRows] = useState([])
  const [actions, setActions] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [loading, setLoading] = useState(true)

  async function load(next = filters) {
    setLoading(true)
    try {
      const [log, actionList] = await Promise.all([adminAuditLog(next), adminAuditActions()])
      setRows(log || [])
      setActions(actionList || [])
      setShown(PAGE)
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const needle = query.trim().toLowerCase()
  const matches = useMemo(
    () =>
      needle
        ? rows.filter((row) =>
            [row.actor_name, row.actor_email, row.reference, actionLabel(row.action), metaSummary(row.meta)].some((value) =>
              String(value || '').toLowerCase().includes(needle),
            ),
          )
        : rows,
    [rows, needle],
  )

  const days = useMemo(() => {
    const map = new Map()
    for (const row of matches.slice(0, shown)) {
      const key = dayKey(row.created_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    return [...map.entries()]
  }, [matches, shown])

  const people = new Set(matches.map((row) => row.actor_email || row.actor_name).filter(Boolean)).size
  const filtered = Boolean(filters.action || filters.from || filters.to)

  return (
    <div className="audit-page">
      <section className="admin-card">
        <div className="users-toolbar">
          <div>
            <h3>Audit trail</h3>
            <p className="admin-note">
              Every action staff and guests take on a booking, account, room or price. Newest first, up to 500 entries.
            </p>
          </div>
          <p className="audit-count">
            <b>{matches.length}</b> {matches.length === 1 ? 'entry' : 'entries'} · <b>{people}</b>{' '}
            {people === 1 ? 'person' : 'people'}
          </p>
        </div>

        <form
          className="audit-filters"
          onSubmit={(event) => {
            event.preventDefault()
            load(filters)
          }}
        >
          <label className="audit-search">
            Search
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setShown(PAGE)
              }}
              placeholder="Name, booking reference or detail"
            />
          </label>
          <label>
            Action
            <select value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
              <option value="">All activity</option>
              {actions.map((item) => (
                <option key={item} value={item}>
                  {actionLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </label>
          <div className="audit-actions">
            <button type="submit" className="admin-save" disabled={loading}>
              {loading ? 'Loading…' : 'Apply'}
            </button>
            {filtered ? (
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setFilters(EMPTY_FILTERS)
                  load(EMPTY_FILTERS)
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {loading && rows.length === 0 ? (
        <div className="skeleton skeleton-card" style={{ minHeight: 260 }} />
      ) : matches.length === 0 ? (
        <section className="admin-card">
          <p className="audit-empty">
            {needle || filtered
              ? 'Nothing matches that search or filter. Clear it to see all activity.'
              : 'No activity recorded yet. Actions show up here as soon as someone books, checks in or changes a setting.'}
          </p>
        </section>
      ) : (
        <section className="admin-card audit-timeline">
          {days.map(([key, items]) => (
            <div key={key} className="audit-day">
              <h4>
                {dayLabel(key)}
                <span>{items.length}</span>
              </h4>
              <ul>
                {items.map((row) => (
                  <li key={row.id}>
                    <time dateTime={row.created_at}>{timeLabel(row.created_at)}</time>
                    <div className="audit-what">
                      <b>
                        {actionLabel(row.action)}
                        {row.reference ? <span>{row.reference}</span> : null}
                      </b>
                      {metaSummary(row.meta) ? <small>{metaSummary(row.meta)}</small> : null}
                    </div>
                    <div className="audit-who">
                      <b>{row.actor_name || 'System'}</b>
                      <small>{ROLE_SHORT[row.actor_role] || row.actor_role || 'Automatic'}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {matches.length > shown ? (
            <button type="button" className="desk-ghost audit-more" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, matches.length - shown)} more of {matches.length - shown}
            </button>
          ) : null}
        </section>
      )}
    </div>
  )
}
