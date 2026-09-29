import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpcError } from '../lib/format'
import '../App.css'
import './auth.css'

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

/* Presentation only: line icons (stroke follows currentColor). */
function Svg({ size = 20, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

function IconEye() {
  return (
    <Svg>
      <path d="M2.06 12.35a1 1 0 0 1 0-.7C3.42 8.1 7.36 5 12 5s8.58 3.1 9.94 6.65a1 1 0 0 1 0 .7C20.58 15.9 16.64 19 12 19s-8.58-3.1-9.94-6.65Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

function IconEyeOff() {
  return (
    <Svg>
      <path d="M10.73 5.08A10.74 10.74 0 0 1 21.94 11.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49" />
      <path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" />
      <path d="M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14" />
      <path d="m2 2 20 20" />
    </Svg>
  )
}

function IconAlert() {
  return (
    <Svg size={16}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Svg>
  )
}

function IconArrow() {
  return (
    <Svg size={18}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  )
}

function IconChevronLeft() {
  return (
    <Svg size={18}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  )
}

function IconWaves() {
  return (
    <Svg size={18}>
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </Svg>
  )
}

function IconCalendar() {
  return (
    <Svg size={18}>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </Svg>
  )
}

function IconShield() {
  return (
    <Svg size={18}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  )
}

function Spinner() {
  return <span className="au-spinner" aria-hidden="true" />
}

const PERKS = [
  { Icon: IconWaves, text: 'Day swimming & cabana stays' },
  { Icon: IconCalendar, text: 'Birthdays, reunions, and private events' },
  { Icon: IconShield, text: 'Secure booking with email verification' },
]

/* The photo side: static, decorative, no state. */
function BrandAside() {
  return (
    <aside className="au-aside" aria-label="CK Resort & Event Place">
      <img
        className="au-photo"
        src="/hero/hero-night.png"
        alt=""
        width="1024"
        height="768"
        fetchPriority="high"
        decoding="async"
      />
      <div className="au-lockup">
        <img src="/logo.png" alt="" width="48" height="48" />
        <div className="au-lockup-text">
          <strong>CK Resort</strong>
          <span>Events Place · Pampanga</span>
        </div>
      </div>
      <div className="au-aside-copy">
        <p className="au-kicker">Private pool · Resort · Events</p>
        <p className="au-display">
          A calm escape, made for gatherings <em>by the water.</em>
        </p>
        <ul className="au-perks">
          {PERKS.map(({ Icon, text }) => (
            <li key={text}>
              <span className="au-perk-icon">
                <Icon />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
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

function EyeToggle({ shown, onToggle }) {
  return (
    <button type="button" className="au-eye" onClick={onToggle} aria-label={shown ? 'Hide password' : 'Show password'}>
      {shown ? <IconEyeOff /> : <IconEye />}
    </button>
  )
}

/* Same props and same onChange(value) contract as before; only the markup changed. */
function Field({ id, label, type = 'text', value, onChange, error, placeholder, autoComplete, aside, suffix, below }) {
  return (
    <div className={`au-field ${error ? 'has-error' : ''}`}>
      <div className="au-label-row">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="au-control">
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix}
      </div>
      {below}
      {error ? (
        <p className="au-error" id={`${id}-error`} role="alert">
          <IconAlert />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

/* Bars are lit from the score the page already computes; a too-short password shows one red bar. */
function StrengthMeter({ score, label }) {
  const lit = Math.max(score, 1)
  return (
    <div className="au-meter" data-score={score}>
      <div className="au-meter-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span key={bar} className={bar <= lit ? 'on' : ''} />
        ))}
      </div>
      <p>{label}</p>
    </div>
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
    <div className="au-otp">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            inputs.current[index] = node
          }}
          className="au-otp-box"
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

export default function AuthPage({ onBack, recovery = false, initialMode = 'signup' }) {
  const [mode, setMode] = useState(recovery ? 'reset' : initialMode)
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
    <div className="au">
      <main className="au-main">
        {step === 'form' && onBack ? (
          <button type="button" className="au-back" onClick={onBack}>
            <IconChevronLeft />
            Back to home
          </button>
        ) : null}

        <div className="au-shell">
          <div className={`au-panel ${shake ? 'shake' : ''}`}>
            {step === 'form' && (
              <div className="au-tabs" role="group" aria-label="Account access" data-active={mode === 'signup' ? 'signup' : 'login'}>
                <button
                  type="button"
                  className="au-tab"
                  aria-pressed={mode === 'login' || mode === 'forgot'}
                  onClick={() => resetFlow('login')}
                >
                  Sign in
                </button>
                <button type="button" className="au-tab" aria-pressed={mode === 'signup'} onClick={() => resetFlow('signup')}>
                  Sign up
                </button>
              </div>
            )}

            <div className="au-swap" key={step === 'form' ? mode : step}>
              {step === 'form' && (
                <>
                  <div className="au-head">
                    <h1 id="au-title">
                      {mode === 'signup' ? 'Join the resort' : mode === 'forgot' ? 'Reset password' : 'Welcome back'}
                    </h1>
                    <p>
                      {mode === 'signup'
                        ? 'Guests can create an account here. Staff and admin accounts are created by the resort manager, then sign in with email and password.'
                        : mode === 'forgot'
                          ? 'Enter your email and we will send a 6-digit code. Enter the code, then set a new password.'
                          : 'Use the email and password on your account. Sessions stay signed in on this device.'}
                    </p>
                  </div>

                  <form className="au-form" onSubmit={handleSubmit} noValidate aria-labelledby="au-title">
                    {mode === 'signup' && (
                      <div className="au-row">
                        <Field
                          id="firstName"
                          label="First name"
                          value={signup.firstName}
                          error={errors.firstName}
                          autoComplete="given-name"
                          onChange={(value) => updateSignup('firstName', value)}
                        />
                        <Field
                          id="lastName"
                          label="Last name"
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
                        type={showPassword ? 'text' : 'password'}
                        value={mode === 'signup' ? signup.password : login.password}
                        error={errors.password}
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        onChange={(value) =>
                          mode === 'signup'
                            ? updateSignup('password', value)
                            : setLogin((current) => ({ ...current, password: value }))
                        }
                        aside={
                          mode === 'login' ? (
                            <button type="button" className="au-link" onClick={() => resetFlow('forgot')}>
                              Forgot password?
                            </button>
                          ) : null
                        }
                        suffix={<EyeToggle shown={showPassword} onToggle={() => setShowPassword((value) => !value)} />}
                        below={mode === 'signup' && signup.password ? <StrengthMeter score={score} label={strength} /> : null}
                      />
                    )}

                    {info ? (
                      <p className="au-note" role="status">
                        {info}
                      </p>
                    ) : null}

                    <button className="au-btn" type="submit" disabled={loading} aria-busy={loading || undefined}>
                      {loading ? (
                        <>
                          <Spinner />
                          Please wait…
                        </>
                      ) : (
                        <>
                          {mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset code' : 'Sign in'}
                          <IconArrow />
                        </>
                      )}
                    </button>
                  </form>
                </>
              )}

              {step === 'otp' && (
                <form className="au-form" onSubmit={verifyOtp} aria-labelledby="au-title">
                  <button type="button" className="au-link au-link-back" onClick={() => setStep('form')}>
                    <IconChevronLeft />
                    Back to {otpMode === 'recovery' ? 'sign in' : 'details'}
                  </button>
                  <div className="au-steps">{otpMode === 'recovery' ? 'Step 1 of 2 · Verify' : 'Step 2 of 2 · Verify'}</div>
                  <div className="au-head">
                    <h1 id="au-title">Check your inbox</h1>
                    <p>{info || `Enter the 6-digit code sent to ${otpEmail}.`}</p>
                  </div>
                  <div className={`au-otp-wrap ${errors.otp ? 'has-error' : ''}`}>
                    <OtpBoxes
                      value={otp}
                      onChange={(value) => {
                        setOtp(value)
                        setErrors((current) => ({ ...current, otp: '' }))
                      }}
                    />
                  </div>
                  {errors.otp ? (
                    <p className="au-error" role="alert">
                      <IconAlert />
                      <span>{errors.otp}</span>
                    </p>
                  ) : null}
                  <button className="au-btn" type="submit" disabled={otp.length !== 6 || loading} aria-busy={loading || undefined}>
                    {loading ? (
                      <>
                        <Spinner />
                        Verifying…
                      </>
                    ) : (
                      <>
                        Verify code
                        <IconArrow />
                      </>
                    )}
                  </button>
                  <p className="au-resend">
                    Did not get it?{' '}
                    {seconds > 0 ? (
                      <span>Resend in 0:{String(seconds).padStart(2, '0')}</span>
                    ) : (
                      <button type="button" className="au-link" onClick={resend}>
                        Resend code
                      </button>
                    )}
                  </p>
                </form>
              )}

              {step === 'reset' && (
                <form className="au-form" onSubmit={saveNewPassword} aria-labelledby="au-title">
                  <div className="au-head">
                    <h1 id="au-title">Set a new password</h1>
                    <p>Choose a new password for your CK Resort account.</p>
                  </div>
                  <Field
                    id="newPassword"
                    label="New password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    error={errors.password}
                    onChange={setNewPassword}
                    suffix={<EyeToggle shown={showPassword} onToggle={() => setShowPassword((value) => !value)} />}
                  />
                  <Field
                    id="confirmPassword"
                    label="Confirm new password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    error={errors.confirm}
                    onChange={setConfirmPassword}
                    suffix={<EyeToggle shown={showPassword} onToggle={() => setShowPassword((value) => !value)} />}
                  />
                  <button className="au-btn" type="submit" disabled={loading} aria-busy={loading || undefined}>
                    {loading ? (
                      <>
                        <Spinner />
                        Saving…
                      </>
                    ) : (
                      <>
                        Save password
                        <IconArrow />
                      </>
                    )}
                  </button>
                </form>
              )}

              {step === 'welcome' && (
                <div className="au-welcome" role="status">
                  <svg className="au-check" viewBox="0 0 52 52" aria-hidden="true">
                    <circle cx="26" cy="26" r="24" pathLength="1" />
                    <path d="M15 27l8 8 15-17" pathLength="1" />
                  </svg>
                  <div className="au-head">
                    <h1 id="au-title">You are in.</h1>
                    <p>Your workspace will open automatically. If it does not, refresh the page.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <BrandAside />
    </div>
  )
}
