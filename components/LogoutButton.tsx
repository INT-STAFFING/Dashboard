'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton({
  className = '',
  label = 'Esci',
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    router.replace('/login');
    router.refresh();
  };

  return (
    <button className={className} onClick={logout} disabled={busy} title="Esci">
      {busy ? '…' : label}
    </button>
  );
}
