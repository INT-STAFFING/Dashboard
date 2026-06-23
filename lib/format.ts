// Number / string formatting helpers — ported 1:1 from the original dashboard.

export const EUR0 = (n: number) =>
  new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n || 0);

export const EUR = (n: number) => '€ ' + EUR0(n);

export const EURM = (n: number) =>
  '€ ' +
  ((n || 0) / 1e6).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) +
  ' Mln';

export const EUR2 = (n: number) =>
  '€ ' +
  (n || 0).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const PCT = (n: number) =>
  (n || 0).toLocaleString('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + '%';

export const clamp = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s;

export const ambShort = (a: string | null) =>
  !a || a === 'Non classificato' ? '—' : a;

export const dfmt = (iso: string | null) => {
  if (!iso) return '—';
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : iso;
};

export const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

// Chart palette (matches CSS variables)
export const C = {
  petrol: '#0E6E63',
  petrolL: '#3FA293',
  petrolD: '#0A4A43',
  gold: '#F2C218',
  amberD: '#B96E15',
  slate: '#5A6B86',
  slateL: '#8C9BB3',
  ink: '#0F1E1B',
  muted: '#5E706C',
  line: '#E6EBEA',
  bad: '#C0492F',
  good: '#2F8F5B',
} as const;

export const FCOL: Record<string, string> = {
  Intellera: C.petrol,
  Deloitte: C.slate,
  Gellify: '#7A5AA0',
  PGMD: '#B96E15',
  Accenture: '#A100FF',
  Altro: C.slateL,
};

// Document-status display metadata: [color, label, glyph]
export const ICO: Record<string, [string, string, string]> = {
  ok: ['var(--good)', 'OK', '●'],
  ko: ['var(--bad)', 'Mancante', '●'],
  prog: ['var(--amber-d)', 'In corso', '◐'],
  nd: ['var(--slate-l)', 'N/D', '○'],
};

// fixed "fatturato emesso" reference value (from source cruscotto)
export const FATTURATO_EMESSO = {
  voci: [{ nome: 'XT-EHR', bo: '2026330767', importo: 2493.72 }],
  get totale() {
    return this.voci.reduce((s, v) => s + v.importo, 0);
  },
};
