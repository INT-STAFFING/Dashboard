'use client';
import React, { useRef, useState } from 'react';
import Link from 'next/link';

function detectKind(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('aggregatore')) return 'aggregatore';
  if (n.includes('chiusura')) return 'chiusura';
  if (n.includes('bef')) return 'bef';
  if (n.includes('if_aria') || n.includes('monitoraggio') || n.includes('dettaglio')) return 'if';
  return 'sconosciuto';
}

type Result = {
  ok: boolean;
  kind?: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
  seniority_rows?: number;
  errors?: string[];
  error?: string;
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const kind = file ? detectKind(file.name) : '';

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setProgress(15);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const qs = new URLSearchParams();
      if (token) qs.set('token', token);
      if (force) qs.set('force', 'true');
      setProgress(45);
      const res = await fetch('/api/upload?' + qs.toString(), { method: 'POST', body: fd });
      setProgress(85);
      const data: Result = await res.json();
      setResult(data);
      setProgress(100);
    } catch {
      setResult({ ok: false, error: 'Errore di rete durante l’upload' });
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 1200);
    }
  };

  return (
    <div className="upbox">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Carica dati Excel</h1>
        <Link href="/dashboard" className="hdr-link" style={{ color: 'var(--petrol-d)' }}>
          ← Torna alla Dashboard
        </Link>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 22px' }}>
        Il tipo di file viene riconosciuto automaticamente dal nome:{' '}
        <span className="mono">IF_ARIA</span> · <span className="mono">BEF</span> ·{' '}
        <span className="mono">Chiusura</span> · <span className="mono">Aggregatore</span>.
      </p>

      <div
        className={'dropzone' + (drag ? ' drag' : '')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) {
            setFile(f);
            setResult(null);
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            setResult(null);
          }}
        />
        {file ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{file.name}</div>
            <div style={{ marginTop: 8 }}>
              Tipo rilevato: <span className="kindpill">{kind}</span>
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)' }}>
            <div style={{ fontSize: 30 }}>⤓</div>
            Trascina qui un file <b>.xlsx / .xlsm</b> oppure clic per selezionarlo
          </div>
        )}
      </div>

      <div className="formgrid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
        <label>
          Token upload (UPLOAD_SECRET)
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="se configurato" />
        </label>
        <label className="chk" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Forza sovrascrittura record
          modificati manualmente (?force=true)
        </label>
      </div>

      <div className="formbtns">
        <button className="addbtn" onClick={submit} disabled={!file || busy}>
          {busy ? 'Elaborazione…' : 'Carica e aggiorna'}
        </button>
        {file && (
          <button className="clearbtn" onClick={() => setFile(null)} disabled={busy}>
            Rimuovi
          </button>
        )}
      </div>

      {progress > 0 && (
        <div className="progress">
          <span style={{ width: progress + '%' }} />
        </div>
      )}

      {result && (
        <div className="uplog">
          {result.ok ? (
            <>
              <div className="row">
                <span>Esito</span>
                <b style={{ color: 'var(--good)' }}>OK · {result.kind}</b>
              </div>
              <div className="row">
                <span>Righe inserite</span>
                <b>{result.inserted ?? 0}</b>
              </div>
              <div className="row">
                <span>Righe aggiornate</span>
                <b>{result.updated ?? 0}</b>
              </div>
              <div className="row">
                <span>Righe preservate (modificate a mano)</span>
                <b>{result.skipped ?? 0}</b>
              </div>
              {!!result.seniority_rows && (
                <div className="row">
                  <span>Figure professionali (GdL)</span>
                  <b>{result.seniority_rows}</b>
                </div>
              )}
              {result.errors?.map((e, i) => (
                <div className="row" key={i}>
                  <span>Nota</span>
                  <span style={{ color: 'var(--muted)' }}>{e}</span>
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <Link href="/dashboard" className="hdr-link" style={{ color: 'var(--petrol-d)' }}>
                  → Vai alla Dashboard aggiornata
                </Link>
              </div>
            </>
          ) : (
            <div className="row">
              <span>Errore</span>
              <b style={{ color: 'var(--bad)' }}>{result.error}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
