'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { copyNodeAsImage, downloadNodeAsJpeg, slugify } from '@/lib/exportImage';
import { copyMatrixToClipboard, tableToMatrix, type Matrix } from '@/lib/exportTable';

type Tone = 'ok' | 'err';

function useFlash() {
  const [msg, setMsg] = useState<{ text: string; tone: Tone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flash = useCallback((text: string, tone: Tone = 'ok') => {
    setMsg({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);
  return { msg, flash };
}

function stamp(): string {
  return new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Grafici → immagine
// ---------------------------------------------------------------------------

export function ChartExportButtons({
  targetRef,
  filename,
  title,
  subtitle,
  compact,
}: {
  targetRef: React.RefObject<HTMLElement>;
  filename: string;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<'copy' | 'jpg' | null>(null);
  const { msg, flash } = useFlash();

  const opts = () => ({
    title,
    subtitle,
    footer: `Monitor IF/BO · ARIA SISS L2 — estratto il ${stamp()}`,
  });
  const name = () => `${slugify(filename)}_${fileStamp()}.jpg`;

  const onCopy = async () => {
    const el = targetRef.current;
    if (!el || busy) return;
    setBusy('copy');
    try {
      const res = await copyNodeAsImage(el, name(), opts());
      if (res === 'copied') flash('Copiato ✓');
      else if (res === 'downloaded') flash('Appunti non disponibili · JPG scaricato');
      else flash('Copia non riuscita', 'err');
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    const el = targetRef.current;
    if (!el || busy) return;
    setBusy('jpg');
    try {
      const ok = await downloadNodeAsJpeg(el, name(), opts());
      flash(ok ? 'JPG scaricato ✓' : 'Esportazione non riuscita', ok ? 'ok' : 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="expbtns">
      <button
        type="button"
        className="expbtn"
        onClick={onCopy}
        disabled={busy !== null}
        title="Copia il grafico come immagine: incollalo in Word, Excel, PowerPoint o in una mail"
      >
        {busy === 'copy' ? '…' : '🖼️'} {compact ? 'Copia' : 'Copia grafico'}
      </button>
      <button
        type="button"
        className="expbtn"
        onClick={onDownload}
        disabled={busy !== null}
        title="Scarica il grafico come file JPG"
      >
        {busy === 'jpg' ? '…' : '⤓'} JPG
      </button>
      <span className={'expmsg' + (msg?.tone === 'err' ? ' err' : '')} role="status" aria-live="polite">
        {msg?.text ?? ''}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabelle → testo per Excel
// ---------------------------------------------------------------------------

export function CopyTableButton({
  targetRef,
  getMatrix,
  label = 'Copia per Excel',
  title = 'Copia tutti i dati della tabella: incollali in un foglio Excel',
  style,
  className,
}: {
  /** Contenitore (o tabella) da leggere quando non viene fornita `getMatrix`. */
  targetRef?: React.RefObject<HTMLElement>;
  /**
   * Sorgente dati alternativa al DOM. Da usare per le tabelle con celle
   * editabili o con righe di dettaglio espandibili, dove il modello è più
   * fedele del markup renderizzato.
   */
  getMatrix?: () => Matrix;
  label?: string;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { msg, flash } = useFlash();

  const onCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let matrix: Matrix | null = null;
      if (getMatrix) {
        matrix = getMatrix();
      } else {
        const root = targetRef?.current ?? null;
        const table =
          root instanceof HTMLTableElement ? root : (root?.querySelector('table') as HTMLTableElement | null);
        if (table) matrix = tableToMatrix(table);
      }
      if (!matrix || !matrix.length) {
        flash('Nessun dato da copiare', 'err');
        return;
      }
      const ok = await copyMatrixToClipboard(matrix);
      const righe = Math.max(0, matrix.length - 1);
      flash(ok ? `Copiate ${righe} righe ✓` : 'Copia non riuscita', ok ? 'ok' : 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={'expbtns' + (className ? ' ' + className : '')} style={style}>
      <button type="button" className="expbtn" onClick={onCopy} disabled={busy} title={title}>
        {busy ? '…' : '📋'} {label}
      </button>
      <span className={'expmsg' + (msg?.tone === 'err' ? ' err' : '')} role="status" aria-live="polite">
        {msg?.text ?? ''}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Contenitore standard per una card con grafico
// ---------------------------------------------------------------------------

export function ChartCard({
  title,
  caption,
  filename,
  exportTitle,
  exportSubtitle,
  className,
  style,
  bodyClassName,
  bodyStyle,
  headerExtra,
  children,
}: {
  title: React.ReactNode;
  caption?: React.ReactNode;
  /** Base del nome file per il JPG scaricato. */
  filename: string;
  /** Titolo stampato nell'immagine, se `title` non è testo semplice. */
  exportTitle?: string;
  exportSubtitle?: string;
  className?: string;
  style?: React.CSSProperties;
  bodyClassName?: string;
  bodyStyle?: React.CSSProperties;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const imgTitle = exportTitle ?? (typeof title === 'string' ? title : undefined);
  const imgSubtitle = exportSubtitle ?? (typeof caption === 'string' ? caption : undefined);

  return (
    <div className={'card' + (className ? ' ' + className : '')} style={style}>
      <div className="cardhead">
        <div className="cardhead-txt">
          <h3>{title}</h3>
          {caption != null && <div className="cap">{caption}</div>}
        </div>
        <ChartExportButtons targetRef={bodyRef} filename={filename} title={imgTitle} subtitle={imgSubtitle} />
      </div>
      {headerExtra}
      <div ref={bodyRef} className={bodyClassName} style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}
