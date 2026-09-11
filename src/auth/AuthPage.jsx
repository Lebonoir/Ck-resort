import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpcError } from '../lib/format'
import '../App.css'

const emptySignup = {
  firstName: '',
  lastName: '',
  contact: '',
  email: '',
  password: '',
}

const emptyLogin = {
  email: '',
  password: '',
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.6 0-8.25 1.8-8.25 5.25V21h16.5v-1.5c0-3.45-4.65-5.25-8.25-5.25Z"
      />
    </svg>
  )
}

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 3.6h3.15l1.05 5.1-1.8 1.08a12.6 12.6 0 0 0 5.62 5.62l1.08-1.8 5.1 1.05v3.15A1.8 1.8 0 0 1 19.6 20.4 15.6 15.6 0 0 1 3.6 4.4 1.8 1.8 0 0 1 5.4 3.6Z"
      />
    </svg>
  )
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.5 5.25h15A1.5 1.5 0 0 1 21 6.75v10.5a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5V6.75a1.5 1.5 0 0 1 1.5-1.5Zm7.5 7.2 7.5-5.1v-.6l-7.5 5.1-7.5-5.1v.6Z"
      />
    </svg>
  )
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.25 9.75V8.25a5.25 5.25 0 0 0-10.5 0v1.5H5.25v10.5h13.5V9.75Zm-8.25 0V8.25a3 3 0 0 1 6 0v1.5Z"
      />
    </svg>
  )
}

function IconEye({ off }) {
  return off ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.1 4.2 3.3 3l18 18-1.2 1.2-3.18-3.18A11.5 11.5 0 0 1 12 19.5C6 19.5 1.35 15.15.75 12.6a1.7 1.7 0 0 1 0-1.2 13.3 13.3 0 0 1 4.8-5.55Zm6.3 6.3a3.6 3.6 0 0 0 4.95 4.95l-1.35-1.35a2.1 2.1 0 0 1-2.25-2.25Zm3.6-4.8a3.6 3.6 0 0 1 3.6 3.6v.15l-3.75-3.75Z"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5.25c6 0 10.65 4.35 11.25 6.9a1.7 1.7 0 0 1 0 1.2C22.65 15.9 18 20.25 12 20.25S1.35 15.9.75 13.35a1.7 1.7 0 0 1 0-1.2C1.35 9.6 6 5.25 12 5.25Zm0 3.3A3.6 3.6 0 1 0 15.6 12 3.6 3.6 0 0 0 12 8.55Z"
      />
    </svg>
  )
}

function passwordScore(password) {
  let score = 0
  if (password.length >= 8) score += 1
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

function Field({ id, label, icon, type = 'text', value, onChange, error, placeholder, autoComplete, suffix }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${value ? 'filled' : ''}`} htmlFor={id}>
      <span className="field-icon">{icon}</span>
      <span className="field-body">
        <span className="field-label">{label}</span>
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      {suffix}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}

function OtpBoxes({ value, onChange }) {
  const inputs = useRef([])

  function setDigit(index, digit) {
    const next = value.split('')
    next[index] = digit
    onChange(next.join('').slice(0, 6))
  }

  return (
    <div className="otp-row">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            inputs.current[index] = node
          }}
          className="otp-box"
          inputMode="numeric"
          maxLength={1}
          value={value[index] || ''}
          onChange={(event) => {
            const digit = event.target.value.replace(/\D/g, '').slice(-1)
            setDigit(index, digit)
            if (digit) inputs.current[index + 1]?.focus()
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (!pasted) return
            event.preventDefault()
            onChange(pasted)
            inputs.current[Math.min(pasted.length, 5)]?.focus()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !value[index] && index > 0) {
              setDigit(index - 1, '')
              inputs.current[index - 1]?.focus()
            }
            if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus()
            if (event.key === 'ArrowRight' && index < 5) inputs.current[index + 1]?.focus()
          }}
          aria-label={`Digit ${index + 1}`}
        />
      ))}
    </div>
  )
}

export default function AuthPage({ onBack, recovery = false }) {
  const [mode, setMode] = useState(recovery ? 'reset' : 'signup')
  const [step, setStep] = useState(recovery ? 'reset' : 'form')
  const [signup, setSignup] = useState(emptySignup)
  const [login, setLogin] = useState(emptyLogin)
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [otp, setOtp] = useState('')
  // Which OTP we are verifying: 'signup' confirms a new account, 'recovery' unlocks a password reset.
  const [otpMode, setOtpMode] = useState('signup')
  const [otpEmail, setOtpEmail] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [shake, setShake] = useState(false)
  const [info, setInfo] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const score = passwordScore(signup.password)
  const strength = ['Too short', 'Getting there', 'Good', 'Strong', 'Resort-ready'][score]
  const site = import.meta.env.VITE_SITE_URL || window.location.origin

  useEffect(() => {
    if (recovery) {
      setMode('reset')
      setStep('reset')
    }
  }, [recovery])

  useEffect(() => {
    if (seconds <= 0) return undefined
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  function updateSignup(key, value) {
    setSignup((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
  }

  function fail(nextErrors) {
    setErrors(nextErrors)
    setShake(true)
    setTimeout(() => setShake(false), 420)
  }

  function validateSignup() {
    const next = {}
    if (!signup.firstName.trim()) next.firstName = 'Please enter your first name'
    if (!signup.lastName.trim()) next.lastName = 'Please enter your last name'
    if (!/^09\d{9}$/.test(signup.contact.replace(/\s/g, '')) && !/^\+63\d{10}$/.test(signup.contact.replace(/\s/g, ''))) {
      next.contact = 'Use a valid mobile number, like 09XXXXXXXXX'
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signup.email)) next.email = 'Enter a valid email address'
    if (signup.password.length < 8) next.password = 'Password should be at least 8 characters'
    return next
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setInfo('')

    if (mode === 'forgot') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.email)) {
        fail({ email: 'Enter the email on your account' })
        return
      }
      setLoading(true)
      const { error } = await supabase.auth.resetPasswordForEmail(login.email, {
        redirectTo: `${site}/?reset=1`,
      })
      setLoading(false)
      if (error) {
        fail({ email: rpcError(error) })
        return
      }
      setOtpMode('recovery')
      setOtpEmail(login.email)
      setOtp('')
      setStep('otp')
      setSeconds(45)
      setInfo(`We sent a 6-digit reset code to ${login.email}.`)
      return
    }

    if (mode === 'signup') {
      const nextErrors = validateSignup()
      if (Object.keys(nextErrors).length) {
        fail(nextErrors)
        return
      }
      setLoading(true)
      const { data, error } = await supabase.auth.signUp({
        email: signup.email,
        password: signup.password,
        options: {
          data: {
            first_name: signup.firstName.trim(),
            last_name: signup.lastName.trim(),
            contact: signup.contact.trim(),
          },
          emailRedirectTo: site,
        },
      })
      setLoading(false)
      if (error) {
        fail({ email: rpcError(error) })
        return
      }
      if (data.session) return
      setOtpMode('signup')
      setOtpEmail(signup.email)
      setOtp('')
      setStep('otp')
      setSeconds(45)
      setInfo(`We sent a 6-digit code to ${signup.email}.`)
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.email)) {
      fail({ email: 'Enter the email on your account' })
      return
    }
    if (!login.password) {
      fail({ password: 'Enter your password' })
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: login.email,
      password: login.password,
    })
    setLoading(false)
    if (error) fail({ password: rpcError(error) })
  }

  async function verifyOtp(event) {
    event.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.verifyOtp({
      email: otpEmail,
      token: otp,
      type: otpMode,
    })
    setLoading(false)
    if (error) {
      fail({ otp: rpcError(error) })
      return
    }
    // A verified recovery code signs the user in just long enough to set a new password.
    setInfo('')
    setErrors({})
    setStep(otpMode === 'recovery' ? 'reset' : 'welcome')
  }

  async function saveNewPassword(event) {
    event.preventDefault()
    if (newPassword.length < 8) {
      fail({ password: 'Password should be at least 8 characters' })
      return
    }
    if (newPassword !== confirmPassword) {
      fail({ confirm: 'Passwords do not match' })
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (error) {
      fail({ password: rpcError(error) })
      return
    }
    setStep('welcome')
  }

  async function resend() {
    setLoading(true)
    const { error } =
      otpMode === 'recovery'
        ? await supabase.auth.resetPasswordForEmail(otpEmail, { redirectTo: `${site}/?reset=1` })
        : await supabase.auth.resend({ type: 'signup', email: otpEmail })
    setLoading(false)
    if (error) fail({ otp: rpcError(error) })
    else setSeconds(45)
  }

  function resetFlow(nextMode) {
    setMode(nextMode)
    setStep('form')
    setErrors({})
    setOtp('')
    setInfo('')
    setShowPassword(false)
  }

  return (
    <div className="auth-shell">
      <div className="water-glow glow-one" />
      <div className="water-glow glow-two" />
      <div className="caustics" />
      <div className="auth-waves" aria-hidden="true">
        <div className="auth-wave wave-l1">
          <span />
        </div>
        <div className="auth-wave wave-l2">
          <span />
        </div>
        <div className="auth-wave wave-l3">
          <span />
        </div>
      </div>

      <section className="brand-panel">
        <div className="brand-copy">
          <img className="brand-logo" src="/logo.png" alt="CK Resort & Event Place" />
          <p className="eyebrow">Private pool · Resort · Events</p>
          <h1>A calm escape, made for gatherings by the water.</h1>
          <p className="lede">
            Create your guest account to book pool days, celebrations, and quiet weekends at CK Resort & Event Place.
          </p>
          <ul className="perks">
            <li>Day swimming & cabana stays</li>
            <li>Birthdays, reunions, and private events</li>
            <li>Secure booking with email verification</li>
          </ul>
        </div>
      </section>

      <section className="form-panel">
        <div className={`form-card ${shake ? 'shake' : ''}`}>
          {step === 'form' && (
            <>
              <div className="mobile-brand">
                <img src="/logo.png" alt="CK Resort & Event Place" />
              </div>
              {onBack ? (
                <button type="button" className="icon-back" onClick={onBack} aria-label="Back to home">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M15.5 5.5 9 12l6.5 6.5-1.4 1.4L6.2 12l7.9-7.9Z"
                    />
                  </svg>
                </button>
              ) : null}
              <div className="mode-switch" role="tablist">
                <button type="button" className={mode === 'login' || mode === 'forgot' ? 'active' : ''} onClick={() => resetFlow('login')}>
                  Sign in
                </button>
                <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => resetFlow('signup')}>
                  Sign up
                </button>
              </div>
              <div className="form-intro">
                <h2>{mode === 'signup' ? 'Join the resort' : mode === 'forgot' ? 'Reset password' : 'Welcome back'}</h2>
                <p>
                  {mode === 'signup'
                    ? 'Guests can create an account here. Staff and admin accounts are created by the resort manager, then sign in with email and password.'
                    : mode === 'forgot'
                      ? 'Enter your email and we will send a 6-digit code. Enter the code, then set a new password.'
                      : 'Use the email and password on your account. Sessions stay signed in on this device.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} noValidate>
                {mode === 'signup' && (
                  <div className="name-grid">
                    <Field
                      id="firstName"
                      label="First name"
                      icon={<IconUser />}
                      value={signup.firstName}
                      error={errors.firstName}
                      autoComplete="given-name"
                      onChange={(value) => updateSignup('firstName', value)}
                    />
                    <Field
                      id="lastName"
                      label="Last name"
                      icon={<IconUser />}
                      value={signup.lastName}
                      error={errors.lastName}
                      autoComplete="family-name"
                      onChange={(value) => updateSignup('lastName', value)}
                    />
                  </div>
                )}

                {mode === 'signup' && (
                  <Field
                    id="contact"
                    label="Contact number"
                    icon={<IconPhone />}
                    type="tel"
                    value={signup.contact}
                    error={errors.contact}
                    placeholder="09XX XXX XXXX"
                    autoComplete="tel"
                    onChange={(value) => updateSignup('contact', value)}
                  />
                )}

                <Field
                  id="email"
                  label={mode === 'login' ? 'Email / username' : 'Email address'}
                  icon={<IconMail />}
                  type="email"
                  value={mode === 'signup' ? signup.email : login.email}
                  error={errors.email}
                  autoComplete="email"
                  onChange={(value) =>
                    mode === 'signup'
                      ? updateSignup('email', value)
                      : setLogin((current) => ({ ...current, email: value }))
                  }
                />

                {mode !== 'forgot' && (
                  <Field
                    id="password"
                    label="Password"
                    icon={<IconLock />}
                    type={showPassword ? 'text' : 'password'}
                    value={mode === 'signup' ? signup.password : login.password}
                    error={errors.password}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    onChange={(value) =>
                      mode === 'signup'
                        ? updateSignup('password', value)
                        : setLogin((current) => ({ ...current, password: value }))
                    }
                    suffix={
                      <button
                        type="button"
                        className="ghost-icon"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <IconEye off={showPassword} />
                      </button>
                    }
                  />
                )}

                {mode === 'signup' && signup.password && (
                  <div className={`strength score-${score}`}>
                    <span />
                    <span />
                    <span />
                    <span />
                    <p>{strength}</p>
                  </div>
                )}

                {mode === 'login' && (
                  <div className="row-between row-end">
                    <button type="button" className="text-link" onClick={() => resetFlow('forgot')}>
                      Forgot password?
                    </button>
                  </div>
                )}

                {info ? <p className="note">{info}</p> : null}

                <button className="submit" type="submit" disabled={loading}>
                  {loading
                    ? 'Please wait…'
                    : mode === 'signup'
                      ? 'Create account'
                      : mode === 'forgot'
                        ? 'Send reset code'
                        : 'Sign in'}
                </button>
              </form>
            </>
          )}

          {step === 'otp' && (
            <form className="otp-step" onSubmit={verifyOtp}>
              <button type="button" className="text-link back" onClick={() => setStep('form')}>
                ← Back to {otpMode === 'recovery' ? 'sign in' : 'details'}
              </button>
              <div className="otp-badge">
                {otpMode === 'recovery' ? 'Step 1 of 2 · Verify' : 'Step 2 of 2 · Verify'}
              </div>
              <h2>Check your inbox</h2>
              <p>{info || `Enter the 6-digit code sent to ${otpEmail}.`}</p>
              <OtpBoxes
                value={otp}
                onChange={(value) => {
                  setOtp(value)
                  setErrors((current) => ({ ...current, otp: '' }))
                }}
              />
              {errors.otp ? <p className="otp-error">{errors.otp}</p> : null}
              <button className="submit" type="submit" disabled={otp.length !== 6 || loading}>
                {loading ? 'Verifying…' : 'Verify code'}
              </button>
              <p className="resend">
                Did not get it?{' '}
                {seconds > 0 ? (
                  <span>Resend in 0:{String(seconds).padStart(2, '0')}</span>
                ) : (
                  <button type="button" className="text-link" onClick={resend}>
                    Resend code
                  </button>
                )}
              </p>
            </form>
          )}

          {step === 'reset' && (
            <form className="otp-step" onSubmit={saveNewPassword}>
              <h2>Set a new password</h2>
              <p>Choose a new password for your CK Resort account.</p>
              <Field
                id="newPassword"
                label="New password"
                icon={<IconLock />}
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                error={errors.password}
                onChange={setNewPassword}
                suffix={
                  <button type="button" className="ghost-icon" onClick={() => setShowPassword((value) => !value)}>
                    <IconEye off={showPassword} />
                  </button>
                }
              />
              <Field
                id="confirmPassword"
                label="Confirm new password"
                icon={<IconLock />}
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                error={errors.confirm}
                onChange={setConfirmPassword}
              />
              <button className="submit" type="submit" disabled={loading}>
                {loading ? 'Saving…' : 'Save password'}
              </button>
            </form>
          )}

          {step === 'welcome' && (
            <div className="welcome">
              <div className="check-burst" aria-hidden="true">
                ✓
              </div>
              <h2>You are in.</h2>
              <p>Your workspace will open automatically. If it does not, refresh the page.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
