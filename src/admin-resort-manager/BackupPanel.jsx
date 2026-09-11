import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  createBackup,
  deleteBackup,
  getBackupPayload,
  listBackups,
  restoreBackup,
  restoreBackupFile,
} from '../lib/api'
import { prettyDateTime, rpcError } from '../lib/format'

const CONFIRM_WORD = 'RESTORE'

const COUNT_LABELS = [
  ['bookings', 'bookings'],
  ['payments', 'payments'],
  ['booking_charges', 'charges'],
  ['booking_reviews', 'ratings'],
  ['resort_closures', 'closed dates'],
]

function countSummary(counts = {}) {
  return COUNT_LABELS.filter(([key]) => counts[key] !== undefined)
    .map(([key, label]) => `${counts[key]} ${label}`)
    .join(' · ')
}

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileStamp(iso) {
  const date = iso ? new Date(iso) : new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

function downloadJson(payload, name) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function isSetupMissing(err) {
  return /could not find the function|schema cache|PGRST202|does not exist/i.test(err?.message || '')
}

export default function BackupPanel({ onError, onSaved, onRestored }) {
  const confirm = useConfirm()
  const fileRef = useRef(null)
  const restoreRef = useRef(null)
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [setupMissing, setSetupMissing] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState('')
  const [pending, setPending] = useState(null)
  const [typed, setTyped] = useState('')

  async function load() {
    setLoading(true)
    try {
      setBackups((await listBackups()) || [])
      setSetupMissing(false)
    } catch (err) {
      if (isSetupMissing(err)) setSetupMissing(true)
      else onError(rpcError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (pending) restoreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [pending])

  async function handleCreate(event) {
    event.preventDefault()
    onError('')
    setBusy('create')
    try {
      const row = await createBackup(label.trim())
      setLabel('')
      onSaved(`Backup "${row.label}" saved.`)
      await load()
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function handleDownload(row) {
    onError('')
    setBusy(`download:${row.id}`)
    try {
      const payload = await getBackupPayload(row.id)
      downloadJson(payload, `ck-resort-backup-${fileStamp(row.created_at)}.json`)
      onSaved('Backup downloaded.')
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  async function handleDelete(row) {
    const ok = await confirm({
      title: 'Delete backup',
      message: `Delete "${row.label}" from ${prettyDateTime(row.created_at)}? Download it first if you want to keep a copy.`,
      confirmLabel: 'Delete backup',
      danger: true,
    })
    if (!ok) return
    onError('')
    setBusy(`delete:${row.id}`)
    try {
      await deleteBackup(row.id)
      if (pending?.id === row.id) setPending(null)
      onSaved('Backup deleted.')
      await load()
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result))
        if (payload?.format !== 'ck-resort-backup' || !payload.tables || typeof payload.tables !== 'object') {
          throw new Error('That file is not a CK Resort backup.')
        }
        const counts = Object.fromEntries(
          Object.entries(payload.tables)
            .filter(([, rows]) => Array.isArray(rows))
            .map(([key, rows]) => [key, rows.length]),
        )
        onError('')
        setTyped('')
        setPending({ kind: 'file', label: file.name, created_at: payload.created_at, counts, payload })
      } catch (err) {
        onError(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message)
      }
    }
    reader.onerror = () => onError('Could not read that file.')
    reader.readAsText(file)
  }

  async function handleRestore() {
    if (!pending || typed.trim().toUpperCase() !== CONFIRM_WORD) return
    onError('')
    setBusy('restore')
    try {
      if (pending.kind === 'file') await restoreBackupFile(pending.payload)
      else await restoreBackup(pending.id)
      setPending(null)
      setTyped('')
      onSaved('Restore complete. A "Before restore" backup was saved first, so you can undo it.')
      await load()
      await onRestored?.()
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  if (setupMissing) {
    return (
      <section className="admin-card">
        <h3>Backup & restore</h3>
        <p className="admin-note">
          Backups are not set up on this database yet. Run <code>supabase/system_backup.sql</code> in the Supabase SQL
          Editor (or <code>npm run db:backup</code>), then reopen this tab.
        </p>
      </section>
    )
  }

  return (
    <div className="admin-stack">
      <section className="admin-card">
        <h3>Create a backup</h3>
        <form className="backup-form" onSubmit={handleCreate}>
          <label>
            Label (optional)
            <input
              value={label}
              maxLength={80}
              placeholder="e.g. Before presentation, End of September"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button type="submit" className="admin-save" disabled={Boolean(busy)}>
            {busy === 'create' ? 'Saving backup…' : 'Back up now'}
          </button>
        </form>
        <ul className="backup-scope">
          <li>
            <b>Saved and restored</b>
            Settings and booking rules, every rate, rooms, rentals, caterers, closed dates, and all bookings with their
            rooms, charges, payments, rental logs and ratings.
          </li>
          <li>
            <b>Not restored</b>
            Login accounts, notifications and the audit trail — history is never rewritten. Accounts and audit entries
            are still saved in the file for reference.
          </li>
        </ul>
        <p className="admin-note">
          Backups listed below are stored in this same database. Download a copy to keep one somewhere safe.
        </p>
      </section>

      <section ref={restoreRef} className={`admin-card restore-card${pending ? ' pending' : ''}`}>
        <h3>Restore</h3>
        {pending ? (
          <>
            <p className="restore-warning">
              Restoring <b>{pending.label}</b>
              {pending.created_at ? ` from ${prettyDateTime(pending.created_at)}` : ''} replaces every current booking,
              payment and closed date with the ones in the backup — anything created after it is removed. Rates and
              settings go back to the backup&apos;s values. Receipt and booking numbers are never reused.
            </p>
            {countSummary(pending.counts) ? <p className="admin-note">Backup contains {countSummary(pending.counts)}.</p> : null}
            <label className="restore-confirm">
              Type {CONFIRM_WORD} to confirm
              <input
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={CONFIRM_WORD}
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="admin-save restore-go"
                disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || busy === 'restore'}
                onClick={handleRestore}
              >
                {busy === 'restore' ? 'Restoring…' : 'Restore this backup'}
              </button>
              <button
                type="button"
                className="desk-ghost"
                disabled={busy === 'restore'}
                onClick={() => {
                  setPending(null)
                  setTyped('')
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="admin-note">
              Pick <b>Restore</b> on a saved backup below, or restore from a file you downloaded earlier. A &quot;Before
              restore&quot; backup is saved automatically first.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
            <button
              type="button"
              className="desk-ghost restore-file"
              disabled={Boolean(busy)}
              onClick={() => fileRef.current?.click()}
            >
              Restore from a file…
            </button>
          </>
        )}
      </section>

      <section className="admin-card">
        <h3>Saved backups</h3>
        {loading ? <p className="admin-note">Loading backups…</p> : null}
        {!loading && backups.length === 0 ? <p className="admin-note">No backups yet. Create one above.</p> : null}
        {backups.length ? (
          <ul className="list backup-list">
            {backups.map((row) => (
              <li key={row.id} className={pending?.id === row.id ? 'focus' : ''}>
                <div>
                  <b>
                    {row.label} <span className={`pill ${row.kind === 'auto' ? 'warn' : 'ok'}`}>{row.kind}</span>
                  </b>
                  <small>
                    {prettyDateTime(row.created_at)} · {row.created_by_name} · {formatSize(row.size_bytes)}
                  </small>
                  {countSummary(row.counts) ? <small>{countSummary(row.counts)}</small> : null}
                </div>
                <div className="backup-actions">
                  <button type="button" disabled={Boolean(busy)} onClick={() => handleDownload(row)}>
                    {busy === `download:${row.id}` ? 'Preparing…' : 'Download'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setTyped('')
                      setPending({ kind: 'stored', id: row.id, label: row.label, created_at: row.created_at, counts: row.counts })
                    }}
                  >
                    Restore
                  </button>
                  <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => handleDelete(row)}>
                    {busy === `delete:${row.id}` ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
