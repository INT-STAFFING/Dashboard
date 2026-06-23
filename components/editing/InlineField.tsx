'use client';
import React, { useState, useRef, useEffect } from 'react';

// Generic click-to-edit field. Enter / blur saves, Esc cancels.
export default function InlineField({
  value,
  onSave,
  type = 'text',
  display,
  className,
}: {
  value: string | number | null;
  onSave: (v: string) => void;
  type?: 'text' | 'number' | 'date';
  display?: React.ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value == null ? '' : String(value));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  useEffect(() => {
    setVal(value == null ? '' : String(value));
  }, [value]);

  const commit = () => {
    setEditing(false);
    if (val !== (value == null ? '' : String(value))) onSave(val);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type={type}
        className={'inline-edit ' + (className || '')}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setVal(value == null ? '' : String(value));
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span
      className={'inline-view ' + (className || '')}
      title="Clic per modificare"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {display ?? (value == null || value === '' ? '—' : value)}
    </span>
  );
}
