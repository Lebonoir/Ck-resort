import { useEffect, useState } from 'react'
import { FolderList, groupByMonth } from '../shared/FolderList'
import { adminAuditActions, adminAuditLog } from '../lib/api'
import { ROLE_SHORT, prettyDateTime, rpcError } from '../lib/format'

// Human wording for the action names the SQL layer records.
const ACTION_LABELS = {
  submit_booking: 'Submitted a booking',
  create_walk_in: 'Created a walk-in',
  approve_booking: 'Approved a booking',
  reject_booking: 'Rejected a booking',
  cancel_booking: 'Cancelled a booking',
  check_in: 'Checked a guest in',
  check_out: 'Checked a guest out',
  add_booking_charge: 'Added an on-site charge',
  dispatch_rental: 'Dispatched a rental',
  return_rental: 'Marked a rental returned',
  set_room_status: 'Changed a room status',
  save_rate: 'Updated a rate',
  invite_staff: 'Invited a staff account',
  admin_update_account: 'Updated an account',
  admin_delete_account: 'Deleted an account',
  submit_review: 'Rated a stay',
  close_date: 'Closed a date',
  reopen_date: 'Reopened a date',
  save_booking_rules: 'Changed booking rules',
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action.replace(/_/g, ' ')
}

function metaSummary(meta) {
  if (!meta || typeof meta !== 'object') return ''
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== null && value !== '' && typeof value !== 'object')
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
  return parts.join(' · ')
}

export default function AuditPanel({ onError }) {
  const [rows, setRows] = useState([])
  const [actions, setActions] = useState([])
  const [filters, setFilters] = useState({ action: '', from: '', to: '' })
  const [loading, setLoading] = useState(true)

  async function load(next = filters) {
    setLoading(true)
    try {
      const [log, actionList] = await Promise.all([adminAuditLog(next), adminAuditActions()])
      setRows(log || [])
      setActions(actionList || [])
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function apply(event) {
    event.preventDefault()
    load(filters)
  }

  const actors = new Set(rows.map((row) => row.actor_email).filter(Boolean))

  return (
    <div className="admin-stack">
      <section className="admin-card">
        <h3>Activity log</h3>
        <p className="admin-note">
          Every action staff and guests take against a booking, account, or rate. Newest first, capped at 500 entries.
        </p>

        <form className="analytics-filters" onSubmit={apply}>
          <label>
            Action
            <select
              value={filters.action}
              onChange={(event) => setFilters({ ...filters, action: event.target.value })}
            >
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
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </label>
          <button type="submit" className="admin-save" disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
          {filters.action || filters.from || filters.to ? (
            <button
              type="button"
              className="desk-ghost"
              onClick={() => {
                const cleared = { action: '', from: '', to: '' }
                setFilters(cleared)
                load(cleared)
              }}
            >
              Clear
            </button>
          ) : null}
        </form>

        <div className="stats">
          <div className="stat">
            <p>Entries</p>
            <strong>{rows.length}</strong>
            <span>Matching the filter</span>
          </div>
          <div className="stat">
            <p>People involved</p>
            <strong>{actors.size}</strong>
            <span>Distinct accounts</span>
          </div>
          <div className="stat">
            <p>Action types</p>
            <strong>{new Set(rows.map((row) => row.action)).size}</strong>
            <span>Kinds of activity</span>
          </div>
          <div className="stat">
            <p>Latest</p>
            <strong className="stat-small">{rows[0] ? prettyDateTime(rows[0].created_at) : '—'}</strong>
            <span>Most recent entry</span>
          </div>
        </div>
      </section>

      <section className="admin-card">
        <FolderList
          empty={loading ? 'Loading activity…' : 'No activity matches that filter.'}
          groups={groupByMonth(rows, (row) => row.created_at)}
          renderItem={(row) => (
            <li key={row.id}>
              <div>
                <b>
                  {actionLabel(row.action)}
                  {row.reference ? ` · ${row.reference}` : ''}
                </b>
                <small>
                  {row.actor_name} · {ROLE_SHORT[row.actor_role] || row.actor_role} · {prettyDateTime(row.created_at)}
                </small>
                {metaSummary(row.meta) ? <small>{metaSummary(row.meta)}</small> : null}
              </div>
              <span className="pill">{row.entity}</span>
            </li>
          )}
        />
      </section>
    </div>
  )
}
