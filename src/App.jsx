import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { screenRole, ROLE_SHORT } from './lib/format'
import AuthPage from './auth/AuthPage'
import HeroPage from './landing/HeroPage'
import CustomerGuest from './customer-guest/CustomerGuest'
import PaymentReturn from './customer-guest/PaymentReturn'
import FrontDeskCashier from './front-desk-cashier/FrontDeskCashier'
import ResortOperationsStaff from './resort-operations-staff/ResortOperationsStaff'
import AdminResortManager from './admin-resort-manager/AdminResortManager'
import { ConfirmProvider } from './shared/ConfirmDialog'

const SCREENS = {
  guest: CustomerGuest,
  'front-desk': FrontDeskCashier,
  staff: ResortOperationsStaff,
  admin: AdminResortManager,
}

function Gate() {
  const { session, profile, loading, error, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [recovery, setRecovery] = useState(false)
  // Read the gateway's return params once, then scrub them from the URL so a
  // refresh or a Back press cannot replay the payment screen.
  const [payment, setPayment] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const state = params.get('payment')
    if (!state) return null
    return { state, booking: params.get('booking') }
  })

  useEffect(() => {
    function onRecovery() {
      setRecovery(true)
      setShowAuth(true)
    }
    window.addEventListener('ck-password-recovery', onRecovery)
    const params = new URLSearchParams(window.location.search)
    if (params.get('reset') === '1') {
      setRecovery(true)
      setShowAuth(true)
    }
    if (params.get('payment') || params.get('reset')) {
      // Scrub the return params, then leave a spare app entry on top so a Back
      // press after the gateway round-trip stays inside the workspace.
      window.history.replaceState({}, '', '/')
      window.history.pushState({}, '', '/')
    }
    return () => window.removeEventListener('ck-password-recovery', onRecovery)
  }, [])

  if (loading) {
    return (
      <div className="status-shell">
        <div className="status-card">
          <p className="status-kicker">CK Resort</p>
          <h2 className="status-title">
            Load<em>ing</em>
          </h2>
          <span className="status-pill warn">Please wait</span>
          <p>Opening your workspace…</p>
        </div>
      </div>
    )
  }

  if (payment && session) {
    return (
      <PaymentReturn
        bookingId={payment.booking}
        cancelled={payment.state === 'cancel'}
        onDone={() => setPayment(null)}
      />
    )
  }

  if (session && profile) {
    const Screen = SCREENS[screenRole(profile.role)] || CustomerGuest
    const name = `${profile.first_name} ${profile.last_name}`.trim() || profile.email || ROLE_SHORT[profile.role]
    return <Screen key={`${profile.id}-${profile.role}`} session={{ name, roleId: screenRole(profile.role) }} onSignOut={signOut} />
  }

  if (session && !profile) {
    return (
      <div className="status-shell">
        <div className="status-card">
          <p className="status-kicker">CK Resort</p>
          <h2 className="status-title">
            Acc<em>ount</em>
          </h2>
          <span className="status-pill warn">Setting up</span>
          <p>Finishing your account setup… refresh if this stays here.</p>
        </div>
      </div>
    )
  }

  if (!showAuth) {
    return (
      <>
        {error ? (
          <p className="flash error" style={{ margin: 16 }}>
            {error}
          </p>
        ) : null}
        <HeroPage onBook={() => setShowAuth(true)} />
      </>
    )
  }

  return <AuthPage recovery={recovery} onBack={() => setShowAuth(false)} />
}

export default function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <Gate />
      </ConfirmProvider>
    </AuthProvider>
  )
}
