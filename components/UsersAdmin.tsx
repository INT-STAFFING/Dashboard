'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import type { Role, SafeUser } from '@/lib/types';
import { ROLE_LABEL, STATUS_LABEL } from '@/lib/auth/permissions';

const ROLES: Role[] = ['USER', 'USERPLUS', 'ADMIN'];

export default function UsersAdmin({
  initial,
  meId,
  adminEmail,
}: {
  initial: SafeUser[];
  meId: number;
  adminEmail: string;
}) {
  const [users, setUsers] = useState<SafeUser[]>(initial);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const isProtected = (u: SafeUser) => u.email.toLowerCase() === adminEmail.toLowerCase();

  const call = async (id: number, init: RequestInit): Promise<{ ok: boolean; user?: SafeUser }> => {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${id}`, init);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Operazione non riuscita');
        return { ok: false };
      }
      return { ok: true, user: data.user };
    } catch {
      setError('Errore di rete');
      return { ok: false };
    } finally {
      setBusyId(null);
    }
  };

  const action = async (id: number, action: string, role?: Role) => {
    const r = await call(id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, role }),
    });
    if (r.ok && r.user) {
      setUsers((list) => list.map((u) => (u.id === id ? (r.user as SafeUser) : u)));
    }
  };

  const remove = async (u: SafeUser) => {
    if (!window.confirm(`Eliminare l'utente ${u.email}?`)) return;
    const r = await call(u.id, { method: 'DELETE' });
    if (r.ok) setUsers((list) => list.filter((x) => x.id !== u.id));
  };

  return (
    <div className="upbox" style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Gestione utenti</h1>
        <Link href="/dashboard" className="hdr-link" style={{ color: 'var(--petrol-d)' }}>
          ← Torna alla Dashboard
        </Link>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 20px' }}>
        Approva le registrazioni in attesa, assegna i ruoli e gestisci gli accessi. Un account{' '}
        <b>ADMIN</b> non può essere eliminato; l’amministratore protetto non può essere declassato.
      </p>

      {error && <div className="authmsg err" style={{ maxWidth: 480 }}>{error}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table className="usertable">
          <thead>
            <tr>
              <th>Utente</th>
              <th>Email</th>
              <th>Ruolo</th>
              <th>Stato</th>
              <th style={{ textAlign: 'right' }}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const busy = busyId === u.id;
              const prot = isProtected(u);
              return (
                <tr key={u.id} style={busy ? { opacity: 0.55 } : undefined}>
                  <td>
                    <b>{u.name || '—'}</b>
                    {u.id === meId && <span className="rolepill" style={{ marginLeft: 6, background: 'var(--petrol-bg)', color: 'var(--petrol-d)', border: 'none' }}>tu</span>}
                  </td>
                  <td className="mono">{u.email}</td>
                  <td>
                    <select
                      className="miniselect"
                      value={u.role}
                      disabled={busy || prot}
                      title={prot ? 'Amministratore protetto' : ROLE_LABEL[u.role]}
                      onChange={(e) => action(u.id, 'setRole', e.target.value as Role)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={'statuspill ' + u.status}>{STATUS_LABEL[u.status]}</span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {u.status !== 'approved' && (
                      <button className="ubtn good" disabled={busy} onClick={() => action(u.id, 'approve')}>
                        Approva
                      </button>
                    )}
                    {u.status !== 'rejected' && !prot && (
                      <button className="ubtn bad" disabled={busy} onClick={() => action(u.id, 'reject')}>
                        Rifiuta
                      </button>
                    )}
                    {u.role !== 'ADMIN' && (
                      <button className="ubtn bad" disabled={busy} onClick={() => remove(u)}>
                        Elimina
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)', padding: 18 }}>
                  Nessun utente registrato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
