// Server-safe skeleton screens shown by the route-level loading.tsx files
// while the SSR data fetch is in flight. They replicate the real layout
// (header, tabbar, filterbar, KPI grid) with the same dimensions, so the
// transition to real content happens without layout shift. The shimmer
// animation comes from the shared .skel class in globals.css.

const TABS = ['Overview', 'Quote RTI', 'Timeline', 'Distribuzione', 'Modalità fornitura', 'Stato IF / BO', 'Operativo'];

function SrLoading({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>;
}

// Static chrome of the dashboard header: brand, tab labels and filter slots are
// known ahead of data, so they render as real (non-interactive) elements — only
// the data-dependent spots (meta line, user chip, actions) shimmer.
export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <SrLoading label="Caricamento della dashboard in corso…" />
      <header>
        <div className="wrap brandrow">
          <div>
            <div className="eyebrow">Executive Dashboard · Intellera</div>
            <h1>Monitor IF/BO · ARIA SISS L2</h1>
          </div>
          <div className="hdr-right">
            <div className="skel" style={{ height: 14, width: 300, borderRadius: 6, opacity: 0.35 }} aria-hidden />
            <div className="skel" style={{ height: 26, width: 180, borderRadius: 999, opacity: 0.35 }} aria-hidden />
          </div>
        </div>
      </header>

      <nav className="tabbar" aria-hidden>
        <div className="wrap">
          {TABS.map((t, i) => (
            <span key={t} className={'tab' + (i === 0 ? ' on' : '')} style={{ cursor: 'default' }}>
              <span className="ti">{i + 1}</span>
              {t}
            </span>
          ))}
        </div>
      </nav>

      <div className="filterbar" aria-hidden>
        <div className="wrap fbar">
          <div className="fbar-row">
            {[110, 96, 100, 104, 112, 122].map((w, i) => (
              <span key={i} className="skel skel-pill" style={{ width: w }} />
            ))}
            <div className="fbar-spacer" />
            <span className="skel" style={{ height: 16, width: 130, borderRadius: 6 }} />
          </div>
        </div>
      </div>

      <main className="wrap" aria-hidden>
        <div className="panel on">
          <div className="phead">
            <h2>Overview &amp; KPI</h2>
            <p>Sintesi direzionale del portafoglio IF e dell&apos;andamento revenue.</p>
          </div>
          <div className="kpis">
            {[0, 1, 2, 3].map((i) => (
              <div className="kpi" key={i}>
                <div className="skel" style={{ height: 11, width: '65%', borderRadius: 5 }} />
                <div className="skel skel-kpi-val" />
                <div className="skel skel-note" />
              </div>
            ))}
          </div>
          <div className="card">
            <h3>Revenue mensile</h3>
            <div className="cap">Revenue di competenza per mese</div>
            <div className="skel" style={{ height: 300 }} />
          </div>
        </div>
      </main>
    </div>
  );
}

// Mirrors the AdminGestione chrome: real header + section tabs, shimmering cards.
const GESTIONE_SECTIONS = ['Valori di gara', 'Revenue & Consuntivazione', 'IF / BO', 'Database'];

export function GestioneSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <SrLoading label="Caricamento della gestione dati in corso…" />
      <header>
        <div className="wrap brandrow">
          <div>
            <div className="eyebrow">Pannello amministrazione · Intellera</div>
            <h1>Gestione dati · ARIA SISS L2</h1>
          </div>
        </div>
      </header>
      <nav className="tabbar" aria-hidden>
        <div className="wrap">
          {GESTIONE_SECTIONS.map((s, i) => (
            <span key={s} className={'tab' + (i === 0 ? ' on' : '')} style={{ cursor: 'default' }}>
              <span className="ti">{i + 1}</span>
              {s}
            </span>
          ))}
        </div>
      </nav>
      <main className="wrap" style={{ paddingTop: 22, paddingBottom: 60 }} aria-hidden>
        <div className="skel-card" style={{ marginBottom: 24 }}>
          <div className="skel skel-line w40" />
          <div className="skel skel-line w80" />
          <div className="skel skel-block" />
        </div>
        <div className="skel-card">
          <div className="skel skel-line w60" />
          <div className="skel skel-block" />
        </div>
      </main>
    </div>
  );
}

// Generic centered-column skeleton (upload / users pages).
export function BoxSkeleton({ label, wide = false }: { label: string; wide?: boolean }) {
  return (
    <div className="upbox" style={wide ? { maxWidth: 980 } : undefined} role="status" aria-busy="true" aria-live="polite">
      <SrLoading label={label} />
      <div aria-hidden>
        <div className="skel" style={{ height: 30, width: 260, borderRadius: 8, margin: '6px 0 14px' }} />
        <div className="skel" style={{ height: 13, width: '85%', borderRadius: 5, marginBottom: 8 }} />
        <div className="skel" style={{ height: 13, width: '60%', borderRadius: 5, marginBottom: 24 }} />
        <div className="skel-card">
          <div className="skel skel-line w40" />
          <div className="skel skel-line w80" />
          <div className="skel skel-line w60" />
          <div className="skel skel-block" />
        </div>
      </div>
    </div>
  );
}
