import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timed } from '@/lib/perf';

let log: ReturnType<typeof vi.spyOn>;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.PERF_LOG;
  delete process.env.PERF_LOG;
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  if (saved === undefined) delete process.env.PERF_LOG;
  else process.env.PERF_LOG = saved;
});

const lastLine = (): Record<string, unknown> => {
  const [tag, json] = log.mock.calls.at(-1) as [string, string];
  return { tag, ...(JSON.parse(json) as Record<string, unknown>) };
};

describe('timed', () => {
  it('returns the result untouched and logs one searchable JSON line', async () => {
    const out = await timed('demo', async () => ({ n: 3 }), (r) => ({ n: r.n }));
    expect(out).toEqual({ n: 3 });
    expect(log).toHaveBeenCalledTimes(1);
    const line = lastLine();
    expect(line.tag).toBe('[perf]');
    expect(line).toMatchObject({ evt: 'demo', ok: true, n: 3 });
    expect(typeof line.ms).toBe('number');
  });

  it('logs ok:false and rethrows the original error', async () => {
    const boom = new Error('boom');
    await expect(timed('demo', async () => { throw boom; })).rejects.toBe(boom);
    expect(lastLine()).toMatchObject({ evt: 'demo', ok: false });
  });

  it('a broken field extractor never turns a success into a failure', async () => {
    const out = await timed('demo', async () => 7, () => { throw new Error('bad extractor'); });
    expect(out).toBe(7);
    expect(lastLine()).toMatchObject({ evt: 'demo', ok: true });
  });

  it('measures real elapsed time', async () => {
    await timed('slow', () => new Promise((r) => setTimeout(r, 30)));
    expect(lastLine().ms as number).toBeGreaterThanOrEqual(25);
  });

  it('is silenced by PERF_LOG=off, without changing behaviour', async () => {
    process.env.PERF_LOG = 'off';
    expect(await timed('demo', async () => 1)).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });
});
