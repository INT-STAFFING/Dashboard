'use client';
import React from 'react';

// Minimal markdown-ish preview: **bold**, and "- " / "* " bullet lines.
export function renderNote(src: string): React.ReactNode {
  const lines = src.split('\n');
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      out.push(
        <ul key={'ul' + key} style={{ margin: '4px 0', paddingLeft: 18 }}>
          {bullets}
        </ul>,
      );
      bullets = [];
    }
  };
  const inline = (s: string): React.ReactNode =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <React.Fragment key={i}>{part}</React.Fragment>,
    );
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t.startsWith('- ') || t.startsWith('* ')) {
      bullets.push(<li key={'li' + i}>{inline(t.slice(2))}</li>);
    } else {
      flush(String(i));
      if (t) out.push(<div key={'p' + i}>{inline(t)}</div>);
    }
  });
  flush('end');
  return out;
}
