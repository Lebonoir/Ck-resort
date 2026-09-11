import { useEffect, useState } from 'react'
import { useConfirm } from '../shared/ConfirmDialog'
import { adminLifecycleSettings, saveLifecycleSettings } from '../lib/api'
import { rpcError } from '../lib/format'
import AuditPanel from './AuditPanel'
import BackupPanel from './BackupPanel'

// One nav entry, three tabs — keeps the admin sidebar short.
const TABS = [
  { id: 'general', label: 'General', hint: 'Downpayment & no-show rules' },
  { id: 'backup', label: 'Backup & restore', hint: 'Snapshots of resort data' },
  { id: 'audit', label: 'Audit trail', hint: 'Who did what, and when' },
]

const DEFAULT_LIFECYCLE = {
  downpayment_hours: 48,
  no_show_grace_minutes: 120,
  no_show_downpayment_policy: 'retain',
}

const POLICY_HELP = {
  retain:
    'When a confirmed guest does not arrive, the 50% downpayment they paid stays with the resort as revenue.',
  credit:
    'The paid downpayment is recorded on the no-show booking as credit and shown to the guest. It is not deducted from their next booking automatically — lower the total when approving their next stay.',
}

function GeneralSettings({ onError, onSaved }) {
  const confirm = useConfirm()
  const [lifecycle, setLifecycle] = useState(DEFAULT_LIFECYCLE)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    adminLifecycleSettings()
      .then((settings) => {
        if (settings) setLifecycle(settings)
      })
      .catch(() => {
        // Installed with booking_lifecycle.sql; defaults stay until then.
      })
  }, [])

  async function save() {
    const ok = await confirm({
      title: 'Save booking rules',
      message: 'Update the downpayment deadline, no-show grace and downpayment policy for future bookings?',
      confirmLabel: 'Save rules',
    })
    if (!ok) return
    onError('')
    setBusy(true)
    try {
      const next = await saveLifecycleSettings({
        downpaymentHours: lifecycle.downpayment_hours,
        graceMinutes: lifecycle.no_show_grace_minutes,
        policy: lifecycle.no_show_downpayment_policy,
      })
      if (next) setLifecycle(next)
      onSaved('Booking rules saved.')
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-card">
      <h3>Downpayment & no-show rules</h3>
      <p className="admin-note">
        How long guests have to pay the downpayment, and what happens to it when a confirmed guest does not arrive.
        Walk-ins are never marked no-show.
      </p>
      <div className="rate-grid">
        <label>
          Downpayment deadline (hours)
          <input
            type="number"
            min="1"
            max="168"
            value={lifecycle.downpayment_hours}
            onChange={(event) =>
              setLifecycle((row) => ({ ...row, downpayment_hours: Number(event.target.value) || 1 }))
            }
          />
          <small className="field-help">Unpaid approved bookings expire after this, or at the start time if sooner.</small>
        </label>
        <label>
          No-show grace (minutes)
          <input
            type="number"
            min="15"
            max="720"
            value={lifecycle.no_show_grace_minutes}
            onChange={(event) =>
              setLifecycle((row) => ({ ...row, no_show_grace_minutes: Number(event.target.value) || 15 }))
            }
          />
          <small className="field-help">A confirmed guest not checked in this long after the start time is a no-show.</small>
        </label>
        <label className="span-2">
          No-show downpayment
          <select
            value={lifecycle.no_show_downpayment_policy}
            onChange={(event) => setLifecycle((row) => ({ ...row, no_show_downpayment_policy: event.target.value }))}
          >
            <option value="retain">Retain as revenue</option>
            <option value="credit">Hold as guest credit</option>
          </select>
          <small className="field-help">{POLICY_HELP[lifecycle.no_show_downpayment_policy] || POLICY_HELP.retain}</small>
        </label>
      </div>
      <button type="button" className="admin-save" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save booking rules'}
      </button>
    </section>
  )
}

export default function SettingsPanel({ onError, onSaved, onRestored }) {
  const [tab, setTab] = useState('general')

  return (
    <div className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'on' : ''}
            onClick={() => setTab(item.id)}
          >
            <b>{item.label}</b>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralSettings onError={onError} onSaved={onSaved} />}
      {tab === 'backup' && <BackupPanel onError={onError} onSaved={onSaved} onRestored={onRestored} />}
      {tab === 'audit' && <AuditPanel onError={onError} />}
    </div>
  )
}
