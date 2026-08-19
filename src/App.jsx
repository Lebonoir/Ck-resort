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
import './App.css'

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
  const params = new URLSearchParams(window.location.search)
  const paymentState = params.get('payment')
  const paymentBooking = params.get('booking')

  useEffect(() => {
    function onRecovery() {
      setRecovery(true)
      setShowAuth(true)
    }
    window.addEventListener('ck-password-recovery', onRecovery)
    if (params.get('reset') === '1') {
      setRecovery(true)
      setShowAuth(true)
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

  if (paymentState && session) {
    return (
      <PaymentReturn
        bookingId={paymentBooking}
        cancelled={paymentState === 'cancel'}
        onDone={() => {
          window.history.replaceState({}, '', '/')
          window.location.reload()
        }}
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
        <HeroPage onBook={() => setShowAuth(true)} onStaff={() => setShowAuth(true)} />
      </>
    )
  }

  return <AuthPage recovery={recovery} onBack={() => setShowAuth(false)} />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
