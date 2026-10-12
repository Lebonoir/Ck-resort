import { useEffect, useMemo, useState } from 'react'
import { addUtilityItem, damageProofUrl, setUtilityStatus, startUtilityRepair, utilityOverview } from '../lib/api'
import { useConfirm } from './ConfirmDialog'
import { Lightbox } from './motion'
import { prettyDateTime, rpcError } from '../lib/format'
import '../front-desk-cashier/front-desk.css'
import '../resort-operations-staff/staff.css'
import './ops.css'

const STATUSES = [
  { id: 'ok', label: 'Working' },
  { id: 'issue', label: 'Needs repair' },
  { id: 'missing', label: 'Missing' },
]
const STATUS_TEXT = { ok: 'Working', issue: 'Needs repair', missing: 'Missing', fixing: 'Being fixed' }

/**
 * Fixture checklist per area: bed, TV and washroom in every room; chairs,
 * table, TV and remote in the gazebo; the function hall and its TV.
 *
 * Anyone here can report a fault (broken). Only operations staff (`canFix`)
 * can start the repair and mark it fixed; the front desk just reports. A room
 * with an open report is closed to bookings until it is fixed.
 */
export default function UtilityMonitor({ canManage = false, canFix = false, onError, onSaved }) {
  const confirm = useConfirm()
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('All')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState('')
  const [area, setArea] = useState('')
  const [name, setName] = useState('')
  const [proof, setProof] = useState(null)

  async function reload() {
    setData(await utilityOverview())
  }

  // Polled so the front desk and staff see each other's reports and repairs.
  useEffect(() => {
    reload()
    const timer = setInterval(() => reload().catch(() => {}), 20000)
    return () => clearInterval(timer)
  }, [])

  const areas = useMemo(() => {
    const map = new Map()
    for (const item of data?.items || []) {
      if (!map.has(item.area)) map.set(item.area, [])
      map.get(item.area).push(item)
    }
    return [...map.entries()].map(([label, items]) => ({ label, items }))
  }, [data])

  if (!data) {
    return (
      <div className="hk-grid">
        <div className="skeleton skeleton-card" style={{ minHeight: 180 }} />
        <div className="skeleton skeleton-card" style={{ minHeight: 180 }} />
        <div className="skeleton skeleton-card" style={{ minHeight: 180 }} />
      </div>
    )
  }

  if (!data.items.length) {
    return (
      <section className="desk-card">
        <h3>Utility monitoring</h3>
        <p className="desk-note">
          The fixture checklist is not set up yet. Apply supabase/resort_ops.sql in the Supabase SQL Editor, then reload
          this page.
        </p>
      </section>
    )
  }

  const flagged = data.items.filter((item) => item.status !== 'ok')
  const visible = filter === 'All' ? areas : areas.filter((group) => group.items.some((item) => item.status !== 'ok'))

  async function openProof(path, caption) {
    onError?.('')
    try {
      const src = await damageProofUrl(path)
      setProof({ src, alt: `Proof photo · ${caption}`, caption })
    } catch (err) {
      onError?.(rpcError(err))
    }
  }

  async function save(item, status, note = '', file = null) {
    setBusy(item.id)
    onError?.('')
    try {
      await setUtilityStatus(item.id, status, note, file)
      setDraft(null)
      await reload()
      onSaved?.(
        status === 'ok'
          ? `${item.area} · ${item.name} marked ${item.status === 'fixing' ? 'fixed' : 'working'}.`
          : `${item.area} · ${item.name} reported as broken.`,
      )
    } catch (err) {
      onError?.(rpcError(err))
      return
    } finally {
      setBusy('')
    }
    // Operations staff decide on the spot: fix it now, or leave it as broken.
    if (status !== 'ok' && canFix) {
      const now = await confirm({
        title: 'Fix now?',
        message: `${item.area} · ${item.name} is reported as broken. Yes marks it as being fixed. No leaves it as broken until someone starts on it.`,
        confirmLabel: 'Yes, fix now',
        cancelLabel: 'No, later',
      })
      if (now) await startFix(item)
    }
  }

  async function startFix(item) {
    setBusy(item.id)
    onError?.('')
    try {
      await startUtilityRepair(item.id)
      await reload()
      onSaved?.(`${item.area} · ${item.name} is now being fixed.`)
    } catch (err) {
      onError?.(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  function choose(item, status) {
    if (status === 'ok') {
      save(item, 'ok')
      return
    }
    // A fault needs a note, so whoever fixes it knows what to repair or replace.
    setDraft({ id: item.id, status, note: item.status === status ? item.note : '', file: null })
  }

  async function addItem(event) {
    event.preventDefault()
    setBusy('add')
    onError?.('')
    try {
      await addUtilityItem(area, name)
      setName('')
      await reload()
      onSaved?.(`${name.trim()} added to ${area.trim()}.`)
    } catch (err) {
      onError?.(rpcError(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <div className="hk-toolbar">
        <div className="hk-filters">
          {['All', 'Needs attention'].map((item) => (
            <button key={item} type="button" className={filter === item ? 'on' : ''} onClick={() => setFilter(item)}>
              {item}
              {item === 'Needs attention' && flagged.length ? ` · ${flagged.length}` : ''}
            </button>
          ))}
        </div>
        <span className="hk-count">
          {data.items.length - flagged.length} of {data.items.length} fixtures working
        </span>
      </div>

      {visible.length === 0 ? (
        <section className="desk-card">
          <p className="desk-note">Every fixture is marked working. Nothing needs attention right now.</p>
        </section>
      ) : null}

      <div className="util-grid">
        {visible.map((group) => {
          const faults = group.items.filter((item) => item.status !== 'ok').length
          return (
            <article key={group.label} className={`util-card ${faults ? 'flagged' : ''}`}>
              <header>
                <h3>{group.label}</h3>
                <span className={`pill ${faults ? 'no' : 'ok'}`}>{faults ? `${faults} to fix` : 'All working'}</span>
              </header>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <div className="util-row">
                      <div>
                        <b>{item.name}</b>
                        <small>
                          {item.checked_at
                            ? `Checked ${prettyDateTime(item.checked_at)}${item.checked_by ? ` · ${item.checked_by}` : ''}`
                            : 'Not checked yet'}
                        </small>
                      </div>
                      {item.status === 'ok' ? (
                        <div className="util-seg" role="group" aria-label={`${item.name} status`}>
                          {STATUSES.map((status) => (
                            <button
                              key={status.id}
                              type="button"
                              disabled={busy === item.id}
                              aria-pressed={item.status === status.id}
                              className={`${item.status === status.id ? 'on' : ''} seg-${status.id}`}
                              onClick={() => choose(item, status.id)}
                            >
                              {status.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="util-repair">
                          <span className={`pill ${item.status === 'fixing' ? 'warn' : 'no'}`}>
                            {item.status === 'fixing' ? 'Being fixed' : item.status === 'missing' ? 'Missing' : 'Broken'}
                          </span>
                          {canFix && item.status === 'fixing' ? (
                            <button
                              type="button"
                              className="desk-btn util-fixed"
                              disabled={busy === item.id}
                              onClick={() => save(item, 'ok')}
                            >
                              {busy === item.id ? 'Saving…' : 'Mark fixed'}
                            </button>
                          ) : canFix ? (
                            <button
                              type="button"
                              className="desk-btn util-fixed"
                              disabled={busy === item.id}
                              onClick={() => startFix(item)}
                            >
                              {busy === item.id ? 'Saving…' : 'Start fixing'}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                    {item.status !== 'ok' && draft?.id !== item.id ? (
                      <p className="util-wait">
                        {item.status === 'fixing'
                          ? canFix
                            ? 'Press Mark fixed once it works again.'
                            : 'Operations staff are fixing this.'
                          : canFix
                            ? 'Reported as broken. Press Start fixing when work begins.'
                            : 'Reported. Operations staff will fix it and mark it done.'}
                        {item.room_unit_id ? ' This room is closed to new bookings until it is fixed.' : ''}
                      </p>
                    ) : null}
                    {item.status !== 'ok' && item.note && draft?.id !== item.id ? (
                      <p className="util-note">
                        {item.note}
                        {item.proof_url ? (
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => openProof(item.proof_url, `${item.area} · ${item.name}`)}
                          >
                            View photo
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                    {draft?.id === item.id ? (
                      <form
                        className="util-draft"
                        onSubmit={(event) => {
                          event.preventDefault()
                          save(item, draft.status, draft.note, draft.file)
                        }}
                      >
                        <label className="select-block">
                          What is wrong? ({STATUS_TEXT[draft.status]})
                          <input
                            className="ops-input"
                            autoFocus
                            value={draft.note}
                            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                            placeholder={draft.status === 'missing' ? 'Last seen, who noticed' : 'No signal, leaking tap, broken slat'}
                          />
                        </label>
                        <label className="select-block">
                          Photo for proof (optional)
                          <input
                            className="ops-input util-file"
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(event) => setDraft({ ...draft, file: event.target.files?.[0] || null })}
                          />
                        </label>
                        <div className="action-row">
                          <button type="submit" className="desk-btn" disabled={!draft.note.trim() || busy === item.id}>
                            {busy === item.id ? 'Saving…' : 'Save report'}
                          </button>
                          <button type="button" className="desk-ghost" onClick={() => setDraft(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>

      <div className="desk-grid">
        <section className="desk-card">
          <h3>Recent checks</h3>
          <ul className="desk-log">
            {data.log.length === 0 ? <li className="empty">No checks logged yet.</li> : null}
            {data.log.slice(0, 12).map((row) => (
              <li key={row.id}>
                <div>
                  <b>
                    {row.area} · {row.name}
                  </b>
                  <small>
                    {prettyDateTime(row.created_at)} · {row.by}
                    {row.note ? ` · ${row.note}` : ''}
                  </small>
                  {row.proof_url ? (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => openProof(row.proof_url, `${row.area} · ${row.name}`)}
                    >
                      View photo
                    </button>
                  ) : null}
                </div>
                <span className={`pill ${row.status === 'ok' ? 'ok' : row.status === 'fixing' ? 'warn' : 'no'}`}>
                  {STATUS_TEXT[row.status] || row.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
        {canManage ? (
          <section className="desk-card">
            <h3>Add a fixture</h3>
            <form className="ops-form" onSubmit={addItem}>
              <label className="select-block">
                Area
                <input
                  className="ops-input"
                  list="utility-areas"
                  value={area}
                  onChange={(event) => setArea(event.target.value)}
                  placeholder="Gazebo, Function hall, Pedro · Room 1"
                />
                <datalist id="utility-areas">
                  {areas.map((group) => (
                    <option key={group.label} value={group.label} />
                  ))}
                </datalist>
              </label>
              <label className="select-block">
                Fixture
                <input
                  className="ops-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Aircon, Electric fan, Speaker"
                />
              </label>
              <button type="submit" className="desk-btn" disabled={!area.trim() || !name.trim() || busy === 'add'}>
                {busy === 'add' ? 'Adding…' : 'Add to checklist'}
              </button>
            </form>
          </section>
        ) : null}
      </div>
      {proof ? <Lightbox src={proof.src} alt={proof.alt} caption={proof.caption} onClose={() => setProof(null)} /> : null}
    </>
  )
}
