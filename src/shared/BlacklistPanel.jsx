import { useEffect, useState } from 'react'
import { FolderList } from './FolderList'
import { useConfirm } from './ConfirmDialog'
import { addToBlacklist, liftBlacklist, listBlacklist } from '../lib/api'
import { prettyDateTime, rpcError } from '../lib/format'
import '../front-desk-cashier/front-desk.css'
import './ops.css'

/**
 * Guests blocked from online booking. A no-show lands here on its own; the
 * desk can add someone by hand, and only the manager can lift a block.
 */
export default function BlacklistPanel({ users = [], canLift = false, onError, onSaved }) {
  const confirm = useConfirm()
  const [rows, setRows] = useState(null)
  const [guestId, setGuestId] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')

  async function reload() {
    setRows(await listBlacklist())
  }

  useEffect(() => {
    reload()
  }, [])

  const active = (rows || []).filter((row) => !row.lifted_at)
  const lifted = (rows || []).filter((row) => row.lifted_at)
  const blockedIds = new Set(active.map((row) => row.guest_id).filter(Boolean))
  const guestAccounts = users.filter((user) => user.role === 'guest' && !blockedIds.has(user.id))
  const ready = (guestId || name.trim()) && reason.trim()

  async function add(event) {
    event.preventDefault()
    const account = guestAccounts.find((user) => user.id === guestId)
    const label = account ? `${account.first_name} ${account.last_name}`.trim() || account.email : name.trim()
    const ok = await confirm({
      title: 'Add to blacklist',
      message: `Block ${label} from booking online? ${account ? 'Their account will be refused at checkout.' : 'This is a name-only record for the front desk.'}`,
      confirmLabel: 'Add to blacklist',
      danger: true,
    })
    if (!ok) return
    setBusy('add')
    onError?.('')
    try {
      await addToBlacklist({ guestId: guestId || null, name, contact, reason })
      setGuestId('')
      setName('')
      setContact('')
      setReason('')
      await reload()
      onSaved?.(`${label} added to the blacklist.`)
    } catch (err) {
      onError?.(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function lift(row) {
    const ok = await confirm({
      title: 'Lift block',
      message: `Let ${row.guest_name} book online again?`,
      confirmLabel: 'Lift block',
    })
    if (!ok) return
    setBusy(row.id)
    onError?.('')
    try {
      await liftBlacklist(row.id)
      await reload()
      onSaved?.(`${row.guest_name} can book online again.`)
    } catch (err) {
      onError?.(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="desk-grid">
      <section className="desk-card">
        <h3>Blacklisted guests</h3>
        <p className="desk-note">
          A no-show is added here automatically and can no longer book online. The downpayment is not refunded.
        </p>
        {rows === null ? (
          <div className="skeleton skeleton-card" style={{ minHeight: 160 }} />
        ) : (
          <FolderList
            empty="No one is blacklisted. A guest who misses a confirmed stay shows up here."
            listClassName="desk-log"
            groups={[
              { id: 'active', label: 'Blocked', items: active, defaultOpen: true },
              { id: 'lifted', label: 'Lifted', items: lifted },
            ]}
            renderItem={(row) => (
              <li key={row.id} className="damage-row">
                <div>
                  <b>{row.guest_name}</b>
                  <small>
                    {[row.email, row.contact].filter(Boolean).join(' · ') || 'No contact on file'}
                  </small>
                  <small>{row.reason}</small>
                  <small>
                    Since {prettyDateTime(row.created_at)}
                    {row.added_by ? ` · added by ${row.added_by}` : ' · added by the system'}
                    {row.lifted_at ? ` · lifted ${prettyDateTime(row.lifted_at)}` : ''}
                  </small>
                </div>
                {row.lifted_at ? (
                  <span className="pill">Lifted</span>
                ) : canLift ? (
                  <button type="button" className="desk-ghost" disabled={Boolean(busy)} onClick={() => lift(row)}>
                    {busy === row.id ? 'Lifting…' : 'Lift block'}
                  </button>
                ) : (
                  <span className="pill no">Blocked</span>
                )}
              </li>
            )}
          />
        )}
      </section>

      <section className="desk-card">
        <h3>Add a guest</h3>
        <form className="ops-form" onSubmit={add}>
          {guestAccounts.length ? (
            <label className="select-block">
              Guest account
              <select value={guestId} onChange={(event) => setGuestId(event.target.value)}>
                <option value="">No account · name only</option>
                {guestAccounts.map((user) => (
                  <option key={user.id} value={user.id}>
                    {`${user.first_name} ${user.last_name}`.trim() || user.email} · {user.email}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!guestId ? (
            <>
              <label className="select-block">
                Name
                <input
                  className="ops-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Full name of the guest"
                />
              </label>
              <label className="select-block">
                Contact number (optional)
                <input
                  className="ops-input"
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  placeholder="09xx xxx xxxx"
                />
              </label>
            </>
          ) : null}
          <label className="select-block">
            Reason
            <input
              className="ops-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="No-show, unpaid damage, house rules"
            />
          </label>
          <button type="submit" className="desk-btn" disabled={!ready || busy === 'add'}>
            {busy === 'add' ? 'Adding…' : 'Add to blacklist'}
          </button>
          {!canLift ? <p className="desk-note">Only the resort manager can lift a block.</p> : null}
        </form>
      </section>
    </div>
  )
}
