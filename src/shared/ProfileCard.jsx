import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { updateProfile } from '../lib/api'
import { ROLE_LABELS, prettyDateTime, rpcError } from '../lib/format'

// Account details behind the header chip, shared by every role.
export default function ProfileCard({ onClose }) {
  const { profile, refreshProfile } = useAuth()
  const dialogRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    contact: profile?.contact || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector('button, input')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  if (!profile) return null

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved('')
    try {
      await updateProfile({
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        contact: draft.contact.trim(),
      })
      await refreshProfile()
      setSaved('Profile updated.')
      setEditing(false)
    } catch (err) {
      setError(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email
  const initials = (profile.first_name?.[0] || profile.email?.[0] || '?').toUpperCase()

  return (
    <div
      className="account-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="account-modal profile-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="account-modal-head">
          <h3 id="profile-title">My account</h3>
          <button type="button" className="desk-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="profile-hero">
          <span className="profile-avatar" aria-hidden="true">
            {initials}
          </span>
          <div>
            <b>{fullName}</b>
            <small>{ROLE_LABELS[profile.role] || profile.role}</small>
          </div>
          <span className={`pill ${profile.is_active ? 'ok' : 'no'}`}>{profile.is_active ? 'active' : 'inactive'}</span>
        </div>

        {error ? <p className="flash error">{error}</p> : null}
        {saved ? <p className="flash ok">{saved}</p> : null}

        {editing ? (
          <form className="user-form" onSubmit={save}>
            <label>
              First name
              <input
                value={draft.first_name}
                onChange={(event) => setDraft({ ...draft, first_name: event.target.value })}
                required
              />
            </label>
            <label>
              Last name
              <input
                value={draft.last_name}
                onChange={(event) => setDraft({ ...draft, last_name: event.target.value })}
              />
            </label>
            <label>
              Contact
              <input
                value={draft.contact}
                onChange={(event) => setDraft({ ...draft, contact: event.target.value })}
                placeholder="09XXXXXXXXX"
              />
            </label>
            <div className="action-row">
              <button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="desk-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="profile-details">
              <div>
                <dt>Email</dt>
                <dd>{profile.email}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>{profile.contact || '—'}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{ROLE_LABELS[profile.role] || profile.role}</dd>
              </div>
              <div>
                <dt>Member since</dt>
                <dd>{prettyDateTime(profile.created_at)}</dd>
              </div>
            </dl>
            <button type="button" className="book-btn" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <p className="admin-note">
              Email and role are managed by the resort manager. Ask an admin if either needs to change.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
