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

  async function loadProfile() {
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const next = await getProfile()
        if (next) {
          setProfile(next)
          return next
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
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
