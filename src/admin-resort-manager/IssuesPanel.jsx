import { useEffect, useRef, useState } from 'react'
import { Stat } from '../shared/RoleLayout'
import { FolderList, groupByMonth } from '../shared/FolderList'
import { Lightbox } from '../shared/motion'
import { damageProofUrl, listDamageReports, utilityOverview } from '../lib/api'
import { peso, prettyDateTime, rpcError } from '../lib/format'
import '../front-desk-cashier/front-desk.css'
import '../shared/ops.css'

/**
 * The manager's watch list, read-only: fixtures that are broken, being fixed
 * or recently fixed, and the items guests destroyed. Staff and the front desk
 * report; operations staff do the fixing and mark it done.
 */
export default function IssuesPanel({ onError }) {
  const [damage, setDamage] = useState(null)
  const [utility, setUtility] = useState(null)
  const [proof, setProof] = useState(null)
  const alive = useRef(true)

  async function load() {
    const [nextDamage, nextUtility] = await Promise.all([listDamageReports(), utilityOverview()])
    if (!alive.current) return
    setDamage(nextDamage)
    setUtility(nextUtility)
  }

  useEffect(() => {
    alive.current = true
    const refresh = () => load().catch((err) => alive.current && onError?.(rpcError(err)))
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => {
      alive.current = false
      clearInterval(timer)
    }
  }, [])

  async function openProof(path, caption) {
    onError?.('')
    try {
      const src = await damageProofUrl(path)
      setProof({ src, alt: `Proof photo · ${caption}`, caption })
    } catch (err) {
      onError?.(rpcError(err))
    }
  }

  const loading = damage === null || utility === null
  const fixtures = utility?.items || []
  const broken = fixtures.filter((item) => item.status === 'issue' || item.status === 'missing')
  const fixing = fixtures.filter((item) => item.status === 'fixing')
  const done = utility?.done || []
  const unpaid = (damage || []).filter((row) => !row.paid).reduce((sum, row) => sum + Number(row.amount), 0)

  function fixtureList(items, empty) {
    if (loading) return <div className="skeleton skeleton-card" style={{ minHeight: 96 }} />
    return (
      <ul className="desk-log">
        {items.length === 0 ? <li className="empty">{empty}</li> : null}
        {items.map((item) => (
          <li key={item.id} className="damage-row">
            <div>
              <b>
                {item.area} · {item.name}
              </b>
              {item.note ? <small>{item.note}</small> : null}
              <small>
                {item.checked_at
                  ? `Reported ${prettyDateTime(item.checked_at)}${item.checked_by ? ` · ${item.checked_by}` : ''}`
                  : 'No report time recorded'}
              </small>
              {item.status === 'fixing' && item.repair_started_at ? (
                <small>
                  Repair started {prettyDateTime(item.repair_started_at)}
                  {item.repair_started_by ? ` · ${item.repair_started_by}` : ''}
                </small>
              ) : null}
              {item.room_unit_id ? <small className="issue-closed">Room closed to new bookings</small> : null}
              {item.proof_url ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => openProof(item.proof_url, `${item.area} · ${item.name}`)}
                >
                  View photo
                </button>
              ) : null}
            </div>
            <span className={`pill ${item.status === 'fixing' ? 'warn' : 'no'}`}>
              {item.status === 'fixing' ? 'Being fixed' : item.status === 'missing' ? 'Missing' : 'Broken'}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <div className="stats">
        <Stat label="Broken" value={String(broken.length)} hint="Reported, not started" />
        <Stat label="Being fixed" value={String(fixing.length)} hint="Staff are on it" />
        <Stat label="Fixed" value={String(done.length)} hint="Recent repairs done" />
        <Stat label="Unpaid damage" value={peso(unpaid)} hint="Still on guest bills" />
      </div>

      <div className="admin-split issue-split">
        <div className="issue-stack">
          <section className="admin-card">
            <div>
              <h3>Broken</h3>
              <p className="admin-note">
                Reported by staff or the front desk and not started yet. A room listed here cannot be booked.
              </p>
            </div>
            {fixtureList(broken, 'Nothing is broken right now.')}
          </section>
          <section className="admin-card">
            <div>
              <h3>Being fixed</h3>
              <p className="admin-note">Operations staff are working on these. The room stays closed until done.</p>
            </div>
            {fixtureList(fixing, 'Nothing is under repair.')}
          </section>
          <section className="admin-card">
            <div>
              <h3>Done</h3>
              <p className="admin-note">The latest repairs staff marked as fixed.</p>
            </div>
            {loading ? (
              <div className="skeleton skeleton-card" style={{ minHeight: 96 }} />
            ) : (
              <ul className="desk-log">
                {done.length === 0 ? <li className="empty">No repairs finished yet.</li> : null}
                {done.map((row) => (
                  <li key={row.id} className="damage-row">
                    <div>
                      <b>
                        {row.area} · {row.name}
                      </b>
                      {row.note ? <small>{row.note}</small> : null}
                      <small>
                        Fixed {prettyDateTime(row.fixed_at)} · {row.fixed_by}
                      </small>
                    </div>
                    <span className="pill ok">Fixed</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="admin-card">
          <h3>Destroyed</h3>
          <p className="admin-note">Items a guest broke. Each one is on that guest&apos;s bill, collected in cash.</p>
          {loading ? (
            <div className="skeleton skeleton-card" style={{ minHeight: 200 }} />
          ) : (
            <FolderList
              empty="Nothing has been reported destroyed."
              listClassName="desk-log"
              groups={groupByMonth(damage, (row) => row.created_at)}
              renderItem={(row) => (
                <li key={row.id} className="damage-row">
                  <div>
                    <b>
                      {row.item} · {peso(row.amount)}
                    </b>
                    <small>
                      {row.guest_name} · {row.reference}
                    </small>
                    <small>{row.reason}</small>
                    <small>
                      {prettyDateTime(row.created_at)} · {row.reported_by}
                    </small>
                    {row.proof_url ? (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => openProof(row.proof_url, `${row.item} · ${row.reference}`)}
                      >
                        View proof photo
                      </button>
                    ) : null}
                  </div>
                  <span className={`pill ${row.paid ? 'ok' : 'warn'}`}>{row.paid ? 'Paid' : 'Unpaid'}</span>
                </li>
              )}
            />
          )}
        </section>
      </div>
      {proof ? <Lightbox src={proof.src} alt={proof.alt} caption={proof.caption} onClose={() => setProof(null)} /> : null}
    </>
  )
}
