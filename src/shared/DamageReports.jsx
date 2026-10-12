import { useEffect, useState } from 'react'
import { FolderList, groupByMonth } from './FolderList'
import { useConfirm } from './ConfirmDialog'
import { Lightbox } from './motion'
import { damageProofUrl, listDamageReports, reportDamage } from '../lib/api'
import { peso, prettyDateTime, rpcError } from '../lib/format'
import '../front-desk-cashier/front-desk.css'
import './ops.css'

const REPORTABLE = ['checked_in', 'checked_out', 'completed']

/**
 * Damaged-item report: proof photo, price and reason. Filing one adds the item
 * to the guest's bill, where the front desk collects it in cash.
 */
export default function DamageReports({ bookings = [], onError, onSaved, onChanged }) {
  const confirm = useConfirm()
  const [reports, setReports] = useState(null)
  const [bookingId, setBookingId] = useState('')
  const [item, setItem] = useState('')
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [proof, setProof] = useState(null)

  async function reload() {
    setReports(await listDamageReports())
  }

  useEffect(() => {
    reload()
  }, [])

  // On-property guests first, then the most recent departures.
  const guests = bookings
    .filter((row) => REPORTABLE.includes(row.status))
    .sort((left, right) => REPORTABLE.indexOf(left.status) - REPORTABLE.indexOf(right.status))
    .slice(0, 40)
  const price = Number(amount) || 0
  const ready = bookingId && item.trim() && reason.trim() && price > 0

  async function submit(event) {
    event.preventDefault()
    const guest = guests.find((row) => row.id === bookingId)
    const ok = await confirm({
      title: 'File damage report',
      message: `Add ${item.trim()} (${peso(price)}) to ${guest?.guest_name || 'this guest'}'s bill? It is collected in cash at the front desk.`,
      confirmLabel: 'File report',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    onError?.('')
    try {
      await reportDamage({ bookingId, item, reason, amount: price, file })
      setItem('')
      setReason('')
      setAmount('')
      setFile(null)
      setFileKey((value) => value + 1)
      await reload()
      await onChanged?.()
      onSaved?.(`Damage report filed. ${peso(price)} added to ${guest?.guest_name || 'the guest'}'s bill.`)
    } catch (err) {
      onError?.(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  async function openProof(report) {
    onError?.('')
    try {
      const src = await damageProofUrl(report.proof_url)
      setProof({ src, alt: `Proof photo for ${report.item}`, caption: `${report.item} · ${report.reference}` })
    } catch (err) {
      onError?.(rpcError(err))
    }
  }

  return (
    <div className="desk-grid">
      <section className="desk-card">
        <h3>Report a damaged item</h3>
        <p className="desk-note">
          The item is added to the guest&apos;s account and must be paid in cash. Attach a photo as proof whenever you
          can.
        </p>
        <form className="ops-form" onSubmit={submit}>
          <label className="select-block">
            Guest
            <select value={bookingId} onChange={(event) => setBookingId(event.target.value)}>
              <option value="">Select the booking</option>
              {guests.map((guest) => (
                <option key={guest.id} value={guest.id}>
                  {guest.guest_name} · {guest.reference}
                  {guest.status === 'checked_in' ? ' · on property' : ' · left'}
                </option>
              ))}
            </select>
          </label>
          <label className="select-block">
            Damaged item
            <input
              className="ops-input"
              value={item}
              onChange={(event) => setItem(event.target.value)}
              placeholder="Glass table, TV remote, billiard cue"
            />
          </label>
          <label className="select-block">
            Reason
            <textarea
              className="ops-input"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What happened and where it was found"
            />
          </label>
          <div className="pay-grid">
            <label>
              Price to charge
              <input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
            </label>
            <label>
              Proof photo
              <input
                key={fileKey}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>
          {!guests.length ? (
            <p className="desk-note">No guest has checked in yet, so there is no bill to add a damaged item to.</p>
          ) : null}
          <button type="submit" className="desk-btn" disabled={!ready || busy}>
            {busy ? 'Filing…' : price > 0 ? `File report · ${peso(price)}` : 'File report'}
          </button>
        </form>
      </section>

      <section className="desk-card">
        <h3>Damage reports</h3>
        {reports === null ? (
          <div className="skeleton skeleton-card" style={{ minHeight: 160 }} />
        ) : (
          <FolderList
            empty="No damage reported. Reports filed here are added to the guest's bill."
            listClassName="desk-log"
            groups={groupByMonth(reports, (row) => row.created_at)}
            renderItem={(row) => (
              <li key={row.id} className="damage-row">
                <div>
                  <b>
                    {row.item} · {peso(row.amount)}
                  </b>
                  <small>
                    {row.guest_name} · {row.reference} · {prettyDateTime(row.created_at)} · {row.reported_by}
                  </small>
                  <small>{row.reason}</small>
                  {row.proof_url ? (
                    <button type="button" className="text-link" onClick={() => openProof(row)}>
                      View proof photo
                    </button>
                  ) : (
                    <small>No photo attached</small>
                  )}
                </div>
                <span className={`pill ${row.paid ? 'ok' : 'warn'}`}>{row.paid ? 'Paid in cash' : 'Unpaid'}</span>
              </li>
            )}
          />
        )}
      </section>
      {proof ? <Lightbox src={proof.src} alt={proof.alt} caption={proof.caption} onClose={() => setProof(null)} /> : null}
    </div>
  )
}
