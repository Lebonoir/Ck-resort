import { ROLE_LABELS, ROLE_SHORT } from '../lib/format'
import './workspace.css'

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

export function RoleLayout({ roleId, name, nav, active, onNav, onSignOut, unread = 0, children }) {
  const role = ROLE_LABELS[roleId] || roleId
  const short = ROLE_SHORT[roleId] || roleId

  return (
    <div className={`workspace role-${roleId}`}>
      <aside className="side">
        <div className="side-brand">
          <img src="/logo.png" alt="CK Resort & Event Place" />
          <div>
            <p>CK Resort</p>
            <span>{role}</span>
          </div>
        </div>
        <p className="side-label">Menu</p>
        <nav>
          {nav.map((item) => (
            <button
              key={item}
              type="button"
              className={active === item ? 'on' : ''}
              onClick={() => onNav(item)}
            >
              <NavIcon label={item} />
              {item}
            </button>
          ))}
        </nav>
        <button type="button" className="sign-out" onClick={onSignOut}>
          Sign out
        </button>
      </aside>
      <section className="main">
        <header className="topbar">
          <div>
            <p className="kicker">{unread ? `${unread} new updates` : 'CK Resort workspace'}</p>
            <h1>{active}</h1>
          </div>
          <div className="who">
            <span>{name}</span>
            <small>{short}</small>
          </div>
        </header>
        <div className="body">{children}</div>
      </section>
    </div>
  )
}

export function Stat({ label, value, hint }) {
  return (
    <article className="stat">
      <p>{label}</p>
      <strong>{value}</strong>
      {hint ? <span>{hint}</span> : null}
    </article>
  )
}

export function Panel({ title, children }) {
  return (
    <article className="panel">
      {title ? <h2>{title}</h2> : null}
      {children}
    </article>
  )
}
