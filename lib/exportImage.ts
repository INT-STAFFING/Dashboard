'use client';

// Cattura di un nodo del DOM (grafico SVG o composizione HTML tipo hbars/donut)
// in un'immagine raster, senza dipendenze esterne.
//
// Il percorso è: clone del nodo -> stili calcolati inlinizzati -> <foreignObject>
// dentro un SVG standalone -> <img> -> <canvas> -> Blob JPEG/PNG.
//
// Nota sul formato: gli appunti di sistema accettano SOLO image/png per le
// immagini (Chrome/Edge/Safari/Firefox rifiutano image/jpeg in ClipboardItem).
// Per questo "Copia" mette in clipboard un PNG — incollabile in Word, Excel,
// PowerPoint, mail — mentre il file scaricato è un JPG vero e proprio.

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Proprietà copiate dallo stile calcolato. Un elenco mirato invece dell'intero
// CSSStyleDeclaration: stesso risultato visivo con markup molto più leggero.
const STYLE_PROPS = [
  'box-sizing', 'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-clip', 'background-origin',
  'color', 'opacity', 'visibility', 'overflow-x', 'overflow-y', 'text-overflow',
  'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-transform', 'text-indent', 'text-decoration-line', 'text-decoration-color',
  'white-space', 'word-break', 'overflow-wrap', 'vertical-align',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-self', 'align-content', 'order',
  'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-auto-rows',
  'grid-column', 'grid-row',
  'list-style-type', 'table-layout', 'border-collapse', 'border-spacing',
  'transform', 'transform-origin', 'fill', 'stroke', 'stroke-width',
];

const FALLBACK_STACK = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export type CaptureOptions = {
  /** Titolo stampato sopra il grafico nell'immagine esportata. */
  title?: string;
  /** Sottotitolo/didascalia sotto il titolo. */
  subtitle?: string;
  /** Riga in piccolo in fondo all'immagine (es. data di estrazione). */
  footer?: string;
  background?: string;
  /** Moltiplicatore di risoluzione: 2 = immagine retina. */
  scale?: number;
  padding?: number;
  mime?: 'image/jpeg' | 'image/png';
  quality?: number;
};

// ---------------------------------------------------------------------------
// font embedding (best effort)
// ---------------------------------------------------------------------------

// Un SVG standalone non vede le @font-face del documento: senza questo passo il
// testo del grafico ricadrebbe su Arial, con metriche diverse da quelle su cui
// è stato calcolato il layout. I file sono same-origin (next/font), quindi
// basta rileggerli e incorporarli come data URI. Cache a livello di modulo: il
// costo si paga una sola volta per sessione.
const fontCssCache = new Map<string, string>();

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
    }
    const mime = res.headers.get('content-type') || 'font/woff2';
    return `data:${mime};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

function firstFamily(stack: string): string {
  return (stack.split(',')[0] || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
}

async function embeddedFontCss(families: string[]): Promise<string> {
  const wanted = new Set(families.map((f) => f.toLowerCase()).filter(Boolean));
  if (!wanted.size) return '';
  const key = Array.from(wanted).sort().join('|');
  const cached = fontCssCache.get(key);
  if (cached != null) return cached;

  const rules: string[] = [];
  let budget = 1_500_000; // tetto sul peso complessivo dei font incorporati
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue; // foglio cross-origin: non leggibile, si prosegue
      }
      for (const rule of Array.from(cssRules)) {
        const isFontFace =
          rule.type === 5 || (typeof CSSFontFaceRule !== 'undefined' && rule instanceof CSSFontFaceRule);
        if (!isFontFace) continue;
        const style = (rule as CSSFontFaceRule).style;
        const family = firstFamily(style.getPropertyValue('font-family'));
        if (!wanted.has(family)) continue;
        const src = style.getPropertyValue('src');
        const url = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(src)?.[1];
        if (!url) continue;
        const data = await fetchAsDataUri(new URL(url, sheet.href || location.href).href);
        if (!data) continue;
        budget -= data.length;
        if (budget < 0) break;
        const descriptors = ['font-weight', 'font-style', 'font-stretch', 'unicode-range']
          .map((d) => {
            const v = style.getPropertyValue(d);
            return v ? `${d}:${v};` : '';
          })
          .join('');
        rules.push(
          `@font-face{font-family:${style.getPropertyValue('font-family')};${descriptors}font-display:block;src:url(${data});}`,
        );
      }
      if (budget < 0) break;
    }
  } catch {
    /* il fallback tipografico è accettabile: mai bloccare l'export */
  }
  const css = rules.join('');
  fontCssCache.set(key, css);
  return css;
}

// ---------------------------------------------------------------------------
// clonazione + inlining degli stili
// ---------------------------------------------------------------------------

function inlineComputedStyles(source: Element, target: Element) {
  const cs = window.getComputedStyle(source);
  if (!cs || !cs.length) return;
  const decl = (target as HTMLElement).style;
  for (const prop of STYLE_PROPS) {
    const value = cs.getPropertyValue(prop);
    if (value) decl.setProperty(prop, value);
  }
  // Nessun effetto di transizione/animazione deve rimanere: l'immagine è
  // uno scatto istantaneo, non uno stato intermedio.
  decl.setProperty('transition', 'none');
  decl.setProperty('animation', 'none');
}

function prepareClone(node: HTMLElement): { clone: HTMLElement; width: number; height: number } {
  const rect = node.getBoundingClientRect();
  const width = Math.ceil(Math.max(rect.width, node.scrollWidth, 1));
  const height = Math.ceil(Math.max(rect.height, node.scrollHeight, 1));

  const clone = node.cloneNode(true) as HTMLElement;
  const sources: Element[] = [node, ...Array.from(node.querySelectorAll('*'))];
  const targets: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];

  for (let i = 0; i < sources.length && i < targets.length; i++) {
    const src = sources[i];
    const dst = targets[i];
    // I discendenti di un <svg> portano già fill/stroke/geometria come
    // attributi di presentazione: inlinizzarli non aggiunge nulla e
    // gonfierebbe il markup di migliaia di dichiarazioni.
    if (src instanceof SVGElement && src.ownerSVGElement) continue;
    inlineComputedStyles(src, dst);
    if (src instanceof SVGSVGElement && dst instanceof SVGSVGElement) {
      const r = src.getBoundingClientRect();
      dst.setAttribute('width', String(Math.ceil(r.width)));
      dst.setAttribute('height', String(Math.ceil(r.height)));
    }
    // Gli elementi di form conservano il valore corrente come proprietà, non
    // come attributo: senza questo il clone mostrerebbe il valore iniziale.
    if (src instanceof HTMLInputElement && dst instanceof HTMLInputElement) {
      dst.setAttribute('value', src.value);
      if (src.checked) dst.setAttribute('checked', 'checked');
    }
    if (src instanceof HTMLTextAreaElement && dst instanceof HTMLTextAreaElement) {
      dst.textContent = src.value;
    }
    if (src instanceof HTMLSelectElement && dst instanceof HTMLSelectElement) {
      const idx = src.selectedIndex;
      Array.from(dst.options).forEach((o, j) => {
        if (j === idx) o.setAttribute('selected', 'selected');
        else o.removeAttribute('selected');
      });
    }
  }

  clone.querySelectorAll('[data-export-ignore]').forEach((el) => el.remove());
  clone.style.setProperty('width', width + 'px');
  clone.style.setProperty('margin', '0');
  return { clone, width, height };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('immagine non caricabile'));
    img.src = src;
  });
}

/** Rasterizza `node` e restituisce il Blob nel formato richiesto. */
export async function captureNode(node: HTMLElement, opts: CaptureOptions = {}): Promise<Blob> {
  const {
    title,
    subtitle,
    footer,
    background = '#FFFFFF',
    scale = 2,
    padding = 20,
    mime = 'image/jpeg',
    quality = 0.94,
  } = opts;

  const { clone, width, height } = prepareClone(node);

  const bodyFamily = window.getComputedStyle(document.body).fontFamily || FALLBACK_STACK;
  const nodeFamily = window.getComputedStyle(node).fontFamily || bodyFamily;
  const fontCss = await embeddedFontCss([firstFamily(bodyFamily), firstFamily(nodeFamily)]);
  const fontStack = `${nodeFamily}, ${FALLBACK_STACK}`;

  const headerHtml =
    title || subtitle
      ? `<div style="margin:0 0 14px 0">${
          title
            ? `<div style="font-size:16px;font-weight:750;color:#0F1E1B;line-height:1.3">${escapeHtml(title)}</div>`
            : ''
        }${
          subtitle
            ? `<div style="font-size:12px;color:#5E706C;line-height:1.4;margin-top:3px">${escapeHtml(subtitle)}</div>`
            : ''
        }</div>`
      : '';
  const footerHtml = footer
    ? `<div style="font-size:10.5px;color:#8C9BB3;margin-top:12px">${escapeHtml(footer)}</div>`
    : '';

  // Il contenitore viene misurato fuori schermo: header e footer hanno
  // un'altezza che dipende dal wrapping del testo, non stimabile a priori.
  const probe = document.createElement('div');
  probe.setAttribute(
    'style',
    `position:fixed;left:-99999px;top:0;width:${width}px;font-family:${fontStack};line-height:1.5;`,
  );
  probe.innerHTML = headerHtml + footerHtml;
  document.body.appendChild(probe);
  const chromeH = probe.getBoundingClientRect().height;
  probe.remove();

  const totalW = width + padding * 2;
  const totalH = Math.ceil(height + chromeH + padding * 2);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(totalW));
  svg.setAttribute('height', String(totalH));
  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

  if (fontCss) {
    const styleEl = document.createElementNS(SVG_NS, 'style');
    styleEl.textContent = fontCss;
    svg.appendChild(styleEl);
  }

  const fo = document.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('x', '0');
  fo.setAttribute('y', '0');
  fo.setAttribute('width', String(totalW));
  fo.setAttribute('height', String(totalH));

  const wrapper = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
  wrapper.setAttribute('xmlns', XHTML_NS);
  wrapper.setAttribute(
    'style',
    `box-sizing:border-box;width:${totalW}px;padding:${padding}px;background:${background};` +
      `font-family:${fontStack};line-height:1.5;color:#0F1E1B;`,
  );
  if (headerHtml) {
    const head = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
    head.innerHTML = headerHtml;
    wrapper.appendChild(head);
  }
  wrapper.appendChild(clone);
  if (footerHtml) {
    const foot = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
    foot.innerHTML = footerHtml;
    wrapper.appendChild(foot);
  }
  fo.appendChild(wrapper);
  svg.appendChild(fo);

  const xml = new XMLSerializer().serializeToString(svg);
  // Il data URI è obbligatorio, non una preferenza: un SVG caricato da un
  // blob: URL rende il canvas "tainted" su Chromium e toBlob() fallisce con
  // SecurityError. Con il data URI il canvas resta origin-clean.
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(totalW * scale));
  canvas.height = Math.max(1, Math.round(totalH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas non disponibile');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // JPEG non ha canale alfa: senza questo riempimento le zone trasparenti
  // diventerebbero nere.
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.drawImage(img, 0, 0, totalW, totalH);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error('conversione immagine non riuscita');
  return blob;
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'grafico'
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 800);
}

export type CopyImageResult = 'copied' | 'downloaded' | 'error';

/**
 * Copia il nodo negli appunti come PNG (l'unico formato immagine accettato dai
 * clipboard di sistema). Se il browser non lo consente, ripiega sul download
 * del JPG così l'utente ottiene comunque il file.
 */
export async function copyNodeAsImage(
  node: HTMLElement,
  filename: string,
  opts: CaptureOptions = {},
): Promise<CopyImageResult> {
  const supported =
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function';

  if (supported) {
    try {
      // Il Blob viene passato come promessa: Safari richiede che la write parta
      // nello stesso task del gesto utente, senza attendere la rasterizzazione.
      const item = new ClipboardItem({
        'image/png': captureNode(node, { ...opts, mime: 'image/png' }) as unknown as Blob,
      });
      await navigator.clipboard.write([item]);
      return 'copied';
    } catch {
      /* si prosegue con il download */
    }
  }
  try {
    const blob = await captureNode(node, { ...opts, mime: 'image/jpeg' });
    downloadBlob(blob, filename);
    return 'downloaded';
  } catch {
    return 'error';
  }
}

export async function downloadNodeAsJpeg(
  node: HTMLElement,
  filename: string,
  opts: CaptureOptions = {},
): Promise<boolean> {
  try {
    const blob = await captureNode(node, { ...opts, mime: 'image/jpeg' });
    downloadBlob(blob, filename);
    return true;
  } catch {
    return false;
  }
}
