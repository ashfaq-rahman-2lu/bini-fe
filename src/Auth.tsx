import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Layers3, LoaderCircle, LogIn } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, jsonRequest } from './api'

type Session = { username: string }
type LoginResponse = Session
const AuthContext = createContext<{ username: string; signOut: () => void } | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('Authentication is required.')
  return auth
}

export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  function clearSession() {
    setSession(null)
    void client.cancelQueries()
    client.clear()
  }
  useEffect(() => {
    let active = true
    api<Session>('/auth/session').then(result => { if (active) setSession(result) }).catch(failure => {
      if (active && !(failure instanceof ApiError && failure.status === 401)) setError('Unable to check your session. Please retry.')
    }).finally(() => { if (active) setChecking(false) })
    window.addEventListener('bini-session-expired', clearSession)
    return () => { active = false; window.removeEventListener('bini-session-expired', clearSession) }
  }, [client])
  async function signOut() {
    try {
      await api<void>('/auth/logout', { method: 'POST' })
      setError('')
      clearSession()
    } catch { setError('Unable to sign out. Please try again.') }
  }
  if (checking) return <main className="loading" role="status">Checking your session…</main>
  return <>
    {error && <div role="alert" className="error-box">{error} <button className="secondary-button" onClick={() => window.location.reload()}>Retry</button></div>}
    {session ? <AuthContext.Provider value={{ username: session.username, signOut }}>{children}</AuthContext.Provider>
      : <LoginForm onLogin={result => { setError(''); setSession(result) }} />}
  </>

}

function LoginForm({ onLogin }: { onLogin: (result: LoginResponse) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await api<LoginResponse>('/auth/login', jsonRequest('POST', { username, password }))
      setPassword('')
      onLogin(result)
    } catch (failure) {
      setPassword('')
      setError(failure instanceof Error ? failure.message : 'Unable to sign in. Please try again.')
    } finally { setBusy(false) }
  }
  return <main className="login-shell"><section className="login-card panel" aria-labelledby="login-title">
    <div className="brand"><span className="brand-mark"><Layers3 size={23} /></span>bini<span className="brand-dot">.</span></div>
    <div className="eyebrow">PERSONAL WORKSPACE</div>
    <h1 id="login-title">Sign in</h1>
    <p className="login-description">Your statements and investments, in one private workspace.</p>
    <form onSubmit={submit} className="login-form">
      <label htmlFor="login-username"><span>Username</span><input id="login-username" name="username" autoComplete="username" maxLength={256} value={username} onChange={event => setUsername(event.target.value)} required autoFocus disabled={busy} /></label>
      <label htmlFor="login-password"><span>Password</span><input id="login-password" name="password" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /></label>
      {error && <p role="alert" className="error-box">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <LogIn size={17} />}{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p className="footnote">Your session stays signed in for up to eight hours.</p>
  </section></main>
}
