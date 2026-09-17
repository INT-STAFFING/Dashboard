'use client';

// Copia di una tabella negli appunti in un formato che Excel (e Google Sheets,
// Numbers, LibreOffice) incolla direttamente in celle separate.
//
// Vengono scritti due flavour sugli appunti:
//  - text/plain  -> TSV, il formato che qualunque foglio di calcolo spezza in
//                   colonne senza passare dalla procedura guidata di importazione;
//  - text/html   -> una <table> spoglia, preferita da Excel quando disponibile,
//                   che regge anche celle con caratteri "difficili".

export type Cell = string | number | null | undefined;
export type Matrix = Cell[][];

const IGNORED_TAGS = new Set(['BUTTON', 'SVG', 'SCRIPT', 'STYLE']);

// Testo "come lo vede l'utente": i controlli di form restituiscono il valore
// corrente (le celle editabili della dashboard sono input/select), i pulsanti
// d'azione e i marcatori decorativi vengono esclusi.
function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;

  if (el.hasAttribute('data-export-ignore')) return '';
  if (el.getAttribute('aria-hidden') === 'true') return '';
  if (el.classList.contains('sr-only')) return '';
  if (IGNORED_TAGS.has(el.tagName)) return '';

  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'Sì' : 'No';
    if (el.type === 'button' || el.type === 'submit' || el.type === 'reset') return '';
    return el.value;
  }
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text ?? el.value;
  if (el instanceof HTMLTextAreaElement) return el.value;

  // Due elementi fratelli senza testo fra loro vanno separati, altrimenti
  // markup come <b>Mario Rossi</b><span>tu</span> finisce in una cella sola
  // come "Mario Rossitu". Fra testo ed elemento la spaziatura è già nel testo.
  let out = '';
  let prevWasElement = false;
  el.childNodes.forEach((child) => {
    const chunk = visibleText(child);
    const isElement = child.nodeType === Node.ELEMENT_NODE;
    if (chunk && isElement && prevWasElement) out += ' ';
    out += chunk;
    if (chunk) prevWasElement = isElement;
  });
  return out;
}

function cellText(cell: HTMLTableCellElement): string {
  return visibleText(cell).replace(/\s+/g, ' ').trim();
}

/** Estrae il contenuto di una tabella HTML come matrice di stringhe. */
export function tableToMatrix(table: HTMLTableElement): Matrix {
  const matrix: Matrix = [];
  const headerRows = new Set(Array.from(table.tHead?.rows ?? []));
  let headerCount = 0;
  for (const row of Array.from(table.rows)) {
    if (row.hasAttribute('data-export-ignore')) continue;
    const out: Cell[] = [];
    for (const cell of Array.from(row.cells)) {
      if (cell.hasAttribute('data-export-ignore')) continue;
      const text = cellText(cell);
      out.push(text);
      // Una cella con colspan occupa più colonne: le posizioni successive
      // vanno riempite, altrimenti le righe si disallineano in Excel.
      for (let i = 1; i < (cell.colSpan || 1); i++) out.push('');
    }
    if (headerRows.has(row)) headerCount++;
    matrix.push(out);
  }
  return dropEmptyColumns(matrix, headerCount);
}

/**
 * Rimuove le colonne prive di dati. Le intestazioni non contano: la colonna
 * "Azioni" ha un titolo ma solo pulsanti, e in Excel diventerebbe una colonna
 * vuota con un'etichetta.
 */
export function dropEmptyColumns(matrix: Matrix, headerCount = 0): Matrix {
  const width = matrix.reduce((w, r) => Math.max(w, r.length), 0);
  const body = matrix.slice(headerCount);
  // Senza righe di corpo non c'è modo di distinguere una colonna vuota da una
  // solo non ancora popolata: si tiene tutto.
  const scope = body.length ? body : matrix;
  const keep: number[] = [];
  for (let c = 0; c < width; c++) {
    if (scope.some((row) => String(row[c] ?? '').trim() !== '')) keep.push(c);
  }
  if (keep.length === width) return matrix;
  return matrix.map((row) => keep.map((c) => row[c] ?? ''));
}

function tsvCell(v: Cell): string {
  if (v == null) return '';
  // Tab e a capo dentro una cella spezzerebbero la griglia TSV.
  return String(v).replace(/[\t\r\n]+/g, ' ');
}

export function matrixToTsv(matrix: Matrix): string {
  return matrix.map((row) => row.map(tsvCell).join('\t')).join('\r\n');
}

function esc(v: Cell): string {
  return String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

export function matrixToHtmlTable(matrix: Matrix): string {
  const rows = matrix
    .map((row, i) => {
      const tag = i === 0 ? 'th' : 'td';
      return `<tr>${row.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
    })
    .join('');
  return `<meta charset="utf-8"><table border="0">${rows}</table>`;
}

// Percorso di riserva per i contesti in cui l'Async Clipboard API non è
// disponibile (http non sicuro, browser datati): textarea fuori schermo +
// execCommand, che resta l'unico meccanismo supportato ovunque.
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Mette la matrice negli appunti nei formati TSV + HTML. */
export async function copyMatrixToClipboard(matrix: Matrix): Promise<boolean> {
  const tsv = matrixToTsv(matrix);
  const html = matrixToHtmlTable(matrix);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return true;
    } catch {
      /* si prosegue con i fallback */
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(tsv);
      return true;
    } catch {
      /* si prosegue con il fallback legacy */
    }
  }
  return legacyCopy(tsv);
}

/** Copia diretta di una tabella presente nel DOM. */
export async function copyTableToClipboard(table: HTMLTableElement): Promise<boolean> {
  const matrix = tableToMatrix(table);
  if (!matrix.length) return false;
  return copyMatrixToClipboard(matrix);
}
