// ─────────────────────────────────────────────────────────────────────────────
// LoginPage.jsx  —  Firebase-authenticated login screen
//
// Drop this in src/ and replace the existing login modal/page in App.jsx.
//
// Usage in App.jsx:
//   import LoginPage from './LoginPage.jsx';
//   ...
//   if (!user) return <LoginPage onLogin={setUser} />;
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { loginWithEmail, resetPassword } from './firebase/firebaseAuth.js';

export default function LoginPage({ onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [mode,     setMode]     = useState('login');   // 'login' | 'reset'
  const [resetSent, setResetSent] = useState(false);
  const [showPass,  setShowPass]  = useState(false);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'reset') {
        await resetPassword(email);
        setResetSent(true);
      } else {
        const user = await loginWithEmail(email, password);
        onLogin(user);
      }
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  // ── Firebase error → human message ───────────────────────────────────────
  function friendlyError(code) {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Invalid email or password.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Contact your admin.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please wait and try again.';
      case 'auth/network-request-failed':
        return 'No internet connection. Check your network.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = {
    page: {
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '24px',
      background: 'linear-gradient(135deg, #1A2332 0%, #3A7FB5 100%)',
      fontFamily: "'DM Sans', sans-serif",
    },
    box: {
      background: 'white', borderRadius: 16, width: '100%', maxWidth: 420,
      padding: '40px 36px', boxShadow: '0 24px 80px rgba(0,0,0,.35)',
    },
    logo: {
      display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32,
    },
    logoIcon: {
      width: 44, height: 44, borderRadius: 10,
      background: 'linear-gradient(135deg,#1A2332,#3A7FB5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    logoText: {
      fontFamily: "'DM Serif Display', serif", fontSize: '1.2rem',
      color: '#1A2332', letterSpacing: '.04em',
    },
    logoSub: {
      fontFamily: "'Noto Naskh Arabic', serif", fontSize: '.7rem',
      color: '#6B7A8D', marginTop: 1,
    },
    heading: { fontSize: '1.4rem', fontWeight: 700, color: '#0F1923', marginBottom: 4 },
    subheading: { fontSize: '.8rem', color: '#6B7A8D', marginBottom: 28 },
    label: { fontSize: '.7rem', fontWeight: 700, color: '#636874', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 6 },
    input: {
      width: '100%', padding: '.6rem .85rem', borderRadius: 8,
      border: '1.5px solid #E9EAEC', fontSize: '.88rem', fontFamily: "'DM Sans',sans-serif",
      color: '#0F1923', outline: 'none', transition: 'border .15s',
      boxSizing: 'border-box',
    },
    btn: {
      width: '100%', padding: '.75rem', borderRadius: 10,
      background: 'linear-gradient(135deg,#1A2332,#3A7FB5)',
      color: 'white', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
      fontSize: '.9rem', fontWeight: 700, fontFamily: "'DM Sans',sans-serif",
      opacity: loading ? .7 : 1, transition: 'all .15s', marginTop: 8,
    },
    error: {
      background: '#FDECEA', border: '1px solid #F5C0C0', borderRadius: 8,
      padding: '10px 14px', fontSize: '.8rem', color: '#B52E2E', marginBottom: 16,
    },
    success: {
      background: '#E8F5EF', border: '1px solid #A8DBC0', borderRadius: 8,
      padding: '10px 14px', fontSize: '.8rem', color: '#1E7A4A', marginBottom: 16,
    },
    link: { fontSize: '.8rem', color: '#3A7FB5', cursor: 'pointer', textDecoration: 'none', fontWeight: 600 },
    divider: { textAlign: 'center', color: '#B0B3BA', fontSize: '.75rem', margin: '20px 0' },
  };

  return (
    <div style={s.page}>
      <div style={s.box}>
        {/* Logo */}
        <div style={s.logo}>
          <div style={s.logoIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div>
            <div style={s.logoText}>AQSA INVOICE</div>
            <div style={s.logoSub}>نظام الفواتير الفندقي</div>
          </div>
        </div>

        {/* Heading */}
        <div style={s.heading}>{mode === 'reset' ? 'Reset Password' : 'Sign In'}</div>
        <div style={s.subheading}>
          {mode === 'reset'
            ? 'Enter your email to receive a reset link.'
            : 'Enter your credentials to access the system.'}
        </div>

        {/* Error / success */}
        {error    && <div style={s.error}>{error}</div>}
        {resetSent && <div style={s.success}>Reset link sent! Check your email.</div>}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={s.label}>Email Address</label>
            <input
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              style={s.input} placeholder="admin@hotel.sa"
              onFocus={e => e.target.style.borderColor = '#3A7FB5'}
              onBlur={e  => e.target.style.borderColor = '#E9EAEC'}
            />
          </div>

          {mode === 'login' && (
            <div>
              <label style={s.label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'} required
                  value={password} onChange={e => setPassword(e.target.value)}
                  style={{ ...s.input, paddingRight: '40px' }} placeholder="••••••••"
                  onFocus={e => e.target.style.borderColor = '#3A7FB5'}
                  onBlur={e  => e.target.style.borderColor = '#E9EAEC'}
                />
                <button type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8A8E97', padding: 2 }}>
                  {showPass
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
              <div style={{ textAlign: 'right', marginTop: 6 }}>
                <span style={s.link} onClick={() => { setMode('reset'); setError(''); setResetSent(false); }}>
                  Forgot password?
                </span>
              </div>
            </div>
          )}

          <button type="submit" style={s.btn} disabled={loading}>
            {loading
              ? (mode === 'reset' ? 'Sending…' : 'Signing in…')
              : (mode === 'reset' ? 'Send Reset Link' : 'Sign In')}
          </button>
        </form>

        {mode === 'reset' && (
          <div style={s.divider}>
            <span style={s.link} onClick={() => { setMode('login'); setError(''); setResetSent(false); }}>
              ← Back to Sign In
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
