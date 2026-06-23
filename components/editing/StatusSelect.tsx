'use client';
import React from 'react';
import type { DocStatus } from '@/lib/types';

export const DOC_OPTIONS: { value: DocStatus; label: string }[] = [
  { value: 'ok', label: '✅ OK' },
  { value: 'ko', label: '❌ Mancante' },
  { value: 'prog', label: '🔄 In corso' },
  { value: 'nd', label: '❓ N/D' },
];

// Inline dropdown for OK / Mancante / InCorso / ND document statuses.
export default function StatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: DocStatus;
  onChange: (v: DocStatus) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="stsel"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as DocStatus)}
      onClick={(e) => e.stopPropagation()}
      title="Modifica stato"
    >
      {DOC_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
