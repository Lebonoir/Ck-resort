import { useEffect, useMemo, useState } from 'react'
import { Stat } from '../shared/RoleLayout'
import { adminCreateAccount, adminDeleteAccount, adminUpdateAccount } from '../lib/api'
import { ROLE_LABELS, rpcError } from '../lib/format'
import { useAuth } from '../lib/AuthContext'

export const ROLE_OPTIONS = [
  { id: 'guest', label: 'Customer / Guest' },
  { id: 'front_desk', label: 'Front Desk / Cashier' },
  { id: 'staff', label: 'Resort Operations / Staff' },
  { id: 'admin', label: 'Admin / Resort Manager' },
]

const EMPTY_CREATE = {
  firstName: '',
  lastName: '',
  email: '',
  contact: '',
  password: '',
  role: 'guest',
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="account-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
        <div className="account-modal-head">
          <h3 id="account-modal-title">{title}</h3>
          <button type="button" className="desk-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AccountFields({ value, onChange, includePassword }) {
  return (
    <>
      <label>
        First name
        <input
          value={value.firstName}
          onChange={(event) => onChange({ ...value, firstName: event.target.value })}
          required
        />
      </label>
      <label>
        Last name
        <input value={value.lastName} onChange={(event) => onChange({ ...value, lastName: event.target.value })} />
      </label>
      <label>
        Email
        <input
          type="email"
          value={value.email}
          onChange={(event) => onChange({ ...value, email: event.target.value })}
          required
        />
      </label>
      <label>
        Contact
        <input
          value={value.contact}
          onChange={(event) => onChange({ ...value, contact: event.target.value })}
          placeholder="09XXXXXXXXX"
        />
      </label>
      {includePassword ? (
        <label>
          Password
          <input
            type="password"
            value={value.password}
            onChange={(event) => onChange({ ...value, password: event.target.value })}
            minLength={8}
            required
            autoComplete="new-password"
          />
        </label>
      ) : null}
      <label>
        Role
        <select value={value.role} onChange={(event) => onChange({ ...value, role: event.target.value })}>
          {ROLE_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

export default function UsersPanel({ users, onReload, onError, onSaved }) {
  const { profile } = useAuth()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(EMPTY_CREATE)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const counts = useMemo(
    () => ({
      guest: users.filter((user) => user.role === 'guest').length,
      front_desk: users.filter((user) => user.role === 'front_desk').length,
      staff: users.filter((user) => user.role === 'staff').length,
      admin: users.filter((user) => user.role === 'admin').length,
    }),
    [users],
  )

  const visible = users.filter((user) =>
    `${user.first_name} ${user.last_name} ${user.email} ${user.role} ${user.contact}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )

  function openCreate() {
    setFormError('')
    setDraft(EMPTY_CREATE)
    setCreating(true)
  }

  function openManage(user) {
    setFormError('')
    setEditing({
      id: user.id,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      email: user.email || '',
      contact: user.contact || '',
      role: user.role,
      isActive: user.is_active,
    })
  }

  function closeModals() {
    setCreating(false)
    setEditing(null)
    setFormError('')
  }

  async function handleCreate(event) {
    event.preventDefault()
    setBusy(true)
    setFormError('')
    onError('')
    try {
      const result = await adminCreateAccount(draft)
      if (result.existed) {
        onSaved(`${draft.firstName} already had an account. Role and details were updated.`)
      } else if (result.pending) {
        onSaved(`Invite saved for ${draft.email}. They receive ${ROLE_LABELS[draft.role]} after registering.`)
      } else {
        onSaved(`${draft.firstName} can sign in as ${ROLE_LABELS[draft.role]}.`)
      }
      closeModals()
      await onReload()
    } catch (err) {
      setFormError(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    setBusy(true)
    setFormError('')
    onError('')
    try {
      await adminUpdateAccount(editing)
      onSaved(`${editing.firstName} saved. The new role applies as soon as they refresh.`)
      closeModals()
      await onReload()
    } catch (err) {
      setFormError(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete ${editing.firstName} ${editing.lastName}? Bookings and payments are kept for audit. This cannot be undone.`,
      )
    ) {
      return
    }
    setBusy(true)
    setFormError('')
    onError('')
    try {
      const result = await adminDeleteAccount(editing.id)
      onSaved(
        result?.deactivated && !result?.deleted
          ? `${editing.firstName} was deactivated.`
          : `${editing.firstName} was removed from the directory.`,
      )
      closeModals()
      await onReload()
    } catch (err) {
      setFormError(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="users-page">
      <div className="stats users-stats">
        <Stat label="Customers" value={String(counts.guest)} hint="Guest accounts" />
        <Stat label="Front desk" value={String(counts.front_desk)} hint="Cashiers" />
        <Stat label="Operations" value={String(counts.staff)} hint="Resort staff" />
        <Stat label="Admins" value={String(counts.admin)} hint="Resort managers" />
      </div>

      <section className="admin-card">
        <div className="users-toolbar">
          <div>
            <h3>Account directory</h3>
            <p className="admin-note">Search, create, and manage every CK Resort login from here.</p>
          </div>
          <button type="button" className="book-btn" onClick={openCreate}>
            Create Account
          </button>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, or role" />
        <ul className="list user-directory">
          {visible.length === 0 ? <li>No accounts match that search.</li> : null}
          {visible.map((user) => (
            <li key={user.id}>
              <div>
                <b>
                  {user.first_name} {user.last_name}
                </b>
                <small>
                  {ROLE_LABELS[user.role] || user.role} · {user.email}
                  {user.contact ? ` · ${user.contact}` : ''}
                </small>
              </div>
              <div className="user-row-actions">
                <span className={`pill ${user.is_active ? 'ok' : 'no'}`}>{user.is_active ? 'active' : 'inactive'}</span>
                <button type="button" className="desk-ghost" onClick={() => openManage(user)}>
                  Manage Account
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {creating ? (
        <Modal title="Create Account" onClose={closeModals}>
          <form className="user-form" onSubmit={handleCreate}>
            {formError ? <p className="flash error">{formError}</p> : null}
            <AccountFields value={draft} onChange={setDraft} includePassword />
            <p className="admin-note">
              Creates a real login in Supabase with the selected role. They can sign in immediately with this email and
              password unless email confirmation is required on the project.
            </p>
            <div className="action-row">
              <button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create Account'}
              </button>
              <button type="button" className="desk-ghost" onClick={closeModals}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <Modal title="Manage Account" onClose={closeModals}>
          <form className="user-form" onSubmit={handleSave}>
            {formError ? <p className="flash error">{formError}</p> : null}
            <AccountFields value={editing} onChange={setEditing} />
            <label className="check-inline">
              <input
                type="checkbox"
                checked={editing.isActive}
                disabled={editing.id === profile?.id}
                onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })}
              />
              Account is active
            </label>
            <p className="admin-note">
              Role is stored on the profile. The matching dashboard opens after they refresh, or immediately if they are
              signed in.
            </p>
            <div className="action-row">
              <button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="desk-ghost" onClick={closeModals}>
                Cancel
              </button>
            </div>
            {editing.id !== profile?.id ? (
              <button type="button" className="danger-link" onClick={handleDelete} disabled={busy}>
                Delete account
              </button>
            ) : (
              <p className="admin-note">You cannot delete or deactivate the account you are signed in with.</p>
            )}
          </form>
        </Modal>
      ) : null}
    </div>
  )
}
