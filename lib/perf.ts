// Minimal server-side timing: one JSON line per measured operation, prefixed
// "[perf]" so it can be searched in the Vercel logs (e.g. `[perf] "evt":"upload"`).
// Set PERF_LOG=off to silence it.
export type PerfFields = Record<string, string | number | boolean | null | undefined>;

function emit(evt: string, startedAt: number, ok: boolean, fields?: PerfFields): void {
  if (process.env.PERF_LOG === 'off') return;
  const ms = Math.round((performance.now() - startedAt) * 10) / 10;
  console.log('[perf]', JSON.stringify({ evt, ms, ok, ...fields }));
}

// Runs `fn`, logs how long it took (and, on success, the fields derived from its
// result), and returns/rethrows exactly what `fn` did — measuring never changes behaviour.
export async function timed<T>(
  evt: string,
  fn: () => Promise<T>,
  fields?: (result: T) => PerfFields,
): Promise<T> {
  const startedAt = performance.now();
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    emit(evt, startedAt, false);
    throw e;
  }
  let extra: PerfFields | undefined;
  try {
    extra = fields?.(result);
  } catch {
    // a broken field extractor must never turn a successful operation into an error
  }
  emit(evt, startedAt, true, extra);
  return result;
}
