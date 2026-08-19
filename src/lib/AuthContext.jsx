import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { getProfile } from './api'
import { rpcError } from './format'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function applyProfile(next, { allowRetry = false } = {}) {
    if (next && next.is_active === false) {
      setProfile(null)
      setError('This account has been deactivated. Contact the resort manager.')
      await supabase.auth.signOut()
      return null
    }
    if (next) {
      setProfile(next)
      setError('')
      return next
    }
    if (!allowRetry) {
      setProfile(null)
      return null
    }
    return null
  }

  async function loadProfile() {
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const next = await getProfile()
        if (next) return applyProfile(next)
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
      const {
        data: { session: current },
      } = await supabase.auth.getSession()
      if (current) {
        setError('This account is no longer available.')
        await supabase.auth.signOut()
      }
      setProfile(null)
      return null
    } catch (err) {
      setError(rpcError(err))
      setProfile(null)
      return null
    }
  }

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session) await loadProfile()
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      setSession(nextSession)
      if (nextSession) {
        await loadProfile()
      } else {
        setProfile(null)
      }
      if (event === 'PASSWORD_RECOVERY') {
        window.dispatchEvent(new Event('ck-password-recovery'))
      }
    })
    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user?.id) return undefined
    const channel = supabase
      .channel(`profile-${session.user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setError('This account is no longer available.')
            supabase.auth.signOut()
            return
          }
          applyProfile(payload.new)
        },
      )
      .subscribe()

    function onFocus() {
      loadProfile()
    }
    window.addEventListener('focus', onFocus)
    const poll = window.setInterval(loadProfile, 8000)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(poll)
    }
  }, [session?.user?.id])

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      error,
      setError,
      refreshProfile: loadProfile,
      signOut: () => supabase.auth.signOut(),
    }),
    [session, profile, loading, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
