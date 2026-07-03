'use client';
import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Accesso non riuscito');
        setBusy(false);
        return;
      }
      // Keep the button in its busy state while the dashboard streams in —
      // re-enabling it here would make the app look idle during navigation.
      router.replace(next);
      router.refresh();
    } catch {
      setError('Errore di rete. Riprova.');
      setBusy(false);
    }
  };

  return (
    <div className="authcard">
      <div className="eyebrow">ARIA SISS L2 · Intellera</div>
      <h1>Accedi</h1>
      <p className="sub">Entra nella dashboard Monitor IF/BO.</p>

      {error && <div className="authmsg err">{error}</div>}

      <form onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="authbtn" type="submit" disabled={busy}>
          {busy ? 'Accesso…' : 'Accedi'}
        </button>
      </form>

      <div className="alt">
        Non hai un account? <Link href="/register">Registrati</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="authwrap">
      <Suspense
        fallback={
          <div className="authcard" role="status" aria-busy="true">
            <span className="sr-only">Caricamento della pagina di accesso…</span>
            <div className="skel skel-line w40" style={{ marginBottom: 12 }} aria-hidden />
            <div className="skel" style={{ height: 40, borderRadius: 10, marginBottom: 14 }} aria-hidden />
            <div className="skel" style={{ height: 40, borderRadius: 10, marginBottom: 18 }} aria-hidden />
            <div className="skel" style={{ height: 42, borderRadius: 10 }} aria-hidden />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
