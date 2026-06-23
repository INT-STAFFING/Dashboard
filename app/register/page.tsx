'use client';
import React, { useState } from 'react';
import Link from 'next/link';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('USER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Registrazione non riuscita');
        return;
      }
      setDone(true);
    } catch {
      setError('Errore di rete. Riprova.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="eyebrow">ARIA SISS L2 · Intellera</div>
        <h1>Registrati</h1>
        <p className="sub">Crea un account. L’accesso sarà attivo dopo l’approvazione di un amministratore.</p>

        {done ? (
          <>
            <div className="authmsg ok">
              Registrazione completata. Il tuo account è <b>in attesa di approvazione</b> da parte
              dell’amministratore. Riceverai accesso non appena verrà approvato.
            </div>
            <div className="alt">
              <Link href="/login">← Torna all’accesso</Link>
            </div>
          </>
        ) : (
          <>
            {error && <div className="authmsg err">{error}</div>}
            <form onSubmit={submit}>
              <label>
                Nome e cognome
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
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
                Password (min. 6 caratteri)
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </label>
              <label>
                Tipo di accesso richiesto
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="USER">Utente — sola visualizzazione</option>
                  <option value="USERPLUS">Utente Plus — visualizzazione e modifica</option>
                </select>
              </label>
              <button className="authbtn" type="submit" disabled={busy}>
                {busy ? 'Invio…' : 'Registrati'}
              </button>
            </form>
            <div className="alt">
              Hai già un account? <Link href="/login">Accedi</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
