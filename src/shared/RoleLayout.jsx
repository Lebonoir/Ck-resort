import { useEffect, useState } from 'react'
import { ROLE_LABELS, ROLE_SHORT } from '../lib/format'
import { CountUp } from './motion'
import './workspace.css'

export function ActionToast({ message, tone = 'ok', busy = false }) {
  if (!message && !busy) return null

  return (
    <div className={`action-toast ${busy ? 'busy' : tone}`} role="status" aria-live="polite">
      {busy ? <span className="action-toast-dot" aria-hidden="true" /> : null}
      <p>{busy && !message ? 'Working…' : message}</p>
    </div>
  )
}

const ICONS = {
  Home: HomeIcon,
  'Book a stay': CalendarIcon,
  'My reservations': ListIcon,
  Today: CalendarIcon,
  'Walk-in': UserIcon,
  Payments: CardIcon,
  Guests: UserIcon,
  'Pool status': DropIcon,
  Cabanas: HomeIcon,
  Tasks: ListIcon,
  Supplies: BoxIcon,
  Overview: GridIcon,
  Bookings: CalendarIcon,
  Staff: UserIcon,
  Reports: CardIcon,
  'POS & Check-in': CardIcon,
  'Rental dispatch': BoxIcon,
  Housekeeping: HomeIcon,
  Approvals: ListIcon,
  Users: UserIcon,
  Rates: CardIcon,
  Dashboard: GridIcon,
  Notifications: ListIcon,
  Receipts: CardIcon,
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3.5 4 10v10h5.5v-6h5v6H20V10Z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 3h2v2h6V3h2v2h3v16H4V5h3Zm-1 6v10h12V9Z"
      />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 6h14v2H7Zm0 5h14v2H7Zm0 5h14v2H7ZM4 6h2v2H4Zm0 5h2v2H4Zm0 5h2v2H4Z" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5Z" />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 6h18v12H3Zm2 4h14v2H5Z" />
    </svg>
  )
}

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3s7 8 7 12a7 7 0 0 1-14 0c0-4 7-12 7-12Z" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 7 12 3l9 4-9 4Zm0 3 8 3.5V21L3 17Zm10 3.5 8-3.5v7l-8 4Z" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 4h7v7H4Zm9 0h7v7h-7ZM4 13h7v7H4Zm9 0h7v7h-7Z" />
    </svg>
  )
}

function NavIcon({ label }) {
  const Icon = ICONS[label] || HomeIcon
  return (
    <span className="nav-icon">
      <Icon />
    </span>
  )
}

function HamburgerIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={open ? 'is-open' : ''}>
      <path className="hb-1" fill="currentColor" d="M4 6h16v2H4z" />
      <path className="hb-2" fill="currentColor" d="M4 11h16v2H4z" />
      <path className="hb-3" fill="currentColor" d="M4 16h16v2H4z" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3a6 6 0 0 1 6 6v3.2l1.4 2.8A1 1 0 0 1 18.5 17H5.5a1 1 0 0 1-.9-1.5L6 12.2V9a6 6 0 0 1 6-6Zm0 18a2.5 2.5 0 0 1-2.45-2h4.9A2.5 2.5 0 0 1 12 21Z"
      />
    </svg>
  )
}

const SIDE_KEY = 'ck-side-collapsed'

export function RoleLayout({ roleId, name, nav, active, onNav, onSignOut, unread = 0, headerExtra, children }) {
  const role = ROLE_LABELS[roleId] || roleId
  const short = ROLE_SHORT[roleId] || roleId
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDE_KEY)
      if (saved === '1') return true
      if (saved === '0') return false
    } catch {
      // ignore
    }
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches
  })

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [collapsed])

  return (
    <div className={`workspace role-${roleId}${collapsed ? ' side-collapsed' : ''}`}>
      <aside className="side">
        <div className="side-top">
          <button
            type="button"
            className="side-toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            onClick={() => setCollapsed((value) => !value)}
          >
            <HamburgerIcon open={!collapsed} />
          </button>
          <div className="side-brand">
            <img src="/logo.png" alt="CK Resort & Event Place" />
            <div className="side-brand-copy">
              <p>CK Resort</p>
              <span>{role}</span>
            </div>
          </div>
        </div>
        <p className="side-label">Menu</p>
        <nav>
          {nav.map((item) => (
            <button
              key={item}
              type="button"
              className={active === item ? 'on' : ''}
              title={item}
              onClick={() => onNav(item)}
            >
              <NavIcon label={item} />
              <span className="nav-label">{item}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="sign-out" onClick={onSignOut} title="Sign out">
          <span className="nav-label">Sign out</span>
        </button>
      </aside>
      <section className="main">
        <header className="topbar">
          <div>
            <p className="kicker">{headerExtra ? 'CK Resort workspace' : unread ? `${unread} new updates` : 'CK Resort workspace'}</p>
            <h1>{active}</h1>
          </div>
          <div className="who-row">
            {headerExtra}
            <div className="who">
              <span>{name}</span>
              <small>{short}</small>
            </div>
          </div>
        </header>
        <div className="body">{children}</div>
      </section>
    </div>
  )
}

export { BellIcon }

export function Stat({ label, value, hint, onClick }) {
  const inner = (
    <>
      <p>{label}</p>
      <strong>
        <CountUp value={value} />
      </strong>
      {hint ? <span>{hint}</span> : null}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className="stat clickable" onClick={onClick}>
        {inner}
      </button>
    )
  }
  return <article className="stat">{inner}</article>
}

export function Panel({ title, children, className = '' }) {
  return (
    <article className={`panel ${className}`.trim()}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </article>
  )
}
