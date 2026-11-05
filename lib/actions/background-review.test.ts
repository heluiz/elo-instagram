import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { RuntimeMessage, ContentRequest, UnfollowStartResponse, SyncStartResponse } from '../messages';
import type { TrackerStore, CommitOutcome } from '../tracker/store';
import { makeResult } from '../testing/fixtures';
import { schedulerState } from '../scheduler/state';
import { unfollowState } from './state';

type Handler = (message: RuntimeMessage, sender: Browser.runtime.MessageSender) => Promise<unknown> | undefined;
const runtime = vi.hoisted(() => ({
  handler: null as Handler | null,
  db: null as TrackerStore | null,
  viewerId: '1000', running: false, actionJobId: null as string | null,
  commands: [] as Array<{ tabId: number; message: ContentRequest }>,
}));

vi.mock('../messages', () => ({
  handleMessages: (handler: Handler) => { runtime.handler = handler; return () => {}; },
  broadcast: () => {},
  sendToTab: async (tabId: number, message: ContentRequest) => {
    runtime.commands.push({ tabId, message });
    switch (message.type) {
      case 'collector:status': return { viewerId: runtime.viewerId, running: runtime.running, actionJobId: runtime.actionJobId, progress: null };
      case 'collector:run': runtime.running = true; return { started: true };
      case 'collector:stop': runtime.running = false; return { stopping: true };
      case 'unfollow:run': runtime.actionJobId = message.jobId; return { started: true };
      case 'unfollow:stop': runtime.actionJobId = null; return { stopping: true };
      default: return undefined;
    }
  },
}));
vi.mock('../tracker/store', async () => ({
  ...await vi.importActual<typeof import('../tracker/store')>('../tracker/store'),
  TrackerStore: { open: async () => runtime.db },
}));

let dbName: string;
beforeEach(async () => {
  fakeBrowser.reset();
  runtime.viewerId = '1000'; runtime.running = false; runtime.actionJobId = null; runtime.commands = [];
  dbName = `elo-review-${crypto.randomUUID()}`;
  const actual = await vi.importActual<typeof import('../tracker/store')>('../tracker/store');
  runtime.db = await actual.TrackerStore.open(dbName);
  await runtime.db.commit(makeResult({ followerIds: ['1', '2'], followingIds: ['1', '2'], finishedAt: 100 }));
  vi.spyOn(browser.runtime, 'getURL').mockImplementation(path => `chrome-extension://elo-test/${path.replace(/^\//, '')}`);
  vi.spyOn(browser.tabs, 'query').mockImplementation(async () => [{ id: 11, active: true, url: 'https://www.instagram.com/' }] as Browser.tabs.Tab[]);
  vi.spyOn(browser.tabs, 'get').mockImplementation(async () => ({ id: 11 } as Browser.tabs.Tab));
  vi.spyOn(browser.sidePanel, 'setPanelBehavior').mockResolvedValue(undefined);
  const background = await import('../../entrypoints/background');
  background.default.main();
});
afterEach(() => {
  runtime.db?.close();
  indexedDB.deleteDatabase(dbName);
  vi.restoreAllMocks();
});

const sender = (tabId?: number): Browser.runtime.MessageSender => ({
  id: browser.runtime.id,
  url: tabId === undefined ? 'chrome-extension://elo-test/sidepanel.html' : 'https://www.instagram.com/',
  ...(tabId === undefined ? {} : { tab: { id: tabId } }),
}) as Browser.runtime.MessageSender;
const request = <T,>(message: RuntimeMessage, tabId?: number) => runtime.handler!(message, sender(tabId)) as Promise<T>;
async function startJob() {
  const response = await request<UnfollowStartResponse>({ type: 'unfollow:start', viewerId: '1000', pks: ['1', '2'], kind: 'unfollow' });
  expect(response.ok).toBe(true);
  if (!response.ok) { throw new Error('Não iniciou'); }
  return response.job;
}

it('relê protegidos durante o lote e reserva a cota antes do pedido', async () => {
  const job = await startJob();
  await request({ type: 'keep:set', viewerId: '1000', pk: '2', kept: true });
  expect(await request({ type: 'unfollow:authorize', jobId: job.id, pk: '2' }, 11)).toEqual({ decision: 'protected' });
  expect((await unfollowState.read()).ledgers['1000']).toBeUndefined();
  expect(await request({ type: 'unfollow:authorize', jobId: job.id, pk: '1' }, 11)).toEqual({ decision: 'allowed' });
  expect((await unfollowState.read()).ledgers['1000']?.count).toBe(1);
});

it('recusa comandos de ação vindos do content script e autorizações de outra aba ou alvo', async () => {
  expect(await request({ type: 'unfollow:start', viewerId: '1000', pks: ['1'], kind: 'unfollow' }, 11)).toEqual({ ok: false, error: 'unauthorized' });
  const job = await startJob();
  expect(await request({ type: 'unfollow:authorize', jobId: job.id, pk: '1' }, 12)).toEqual({ decision: 'cancelled' });
  expect(await request({ type: 'unfollow:authorize', jobId: job.id, pk: '999' }, 11)).toEqual({ decision: 'cancelled' });
  expect(await request({ type: 'unfollow:authorize', jobId: job.id, pk: '1' })).toEqual({ decision: 'cancelled' });
});

it('reconcilia o resultado final se o evento individual atrasar e ignora duplicatas', async () => {
  const job = await startJob();
  await request({ type: 'unfollow:authorize', jobId: job.id, pk: '1' }, 11);
  const item = { pk: '1', outcome: 'unfollowed' as const, detail: null, at: 200 };
  await request({ type: 'unfollow:finished', jobId: job.id, result: { outcome: 'stopped', message: null, results: [item], remaining: ['2'] } }, 11);
  await request({ type: 'unfollow:item', jobId: job.id, item }, 11);
  await request({ type: 'unfollow:item', jobId: job.id, item }, 11);
  expect(await runtime.db!.listActions('1000')).toHaveLength(1);
  expect((await unfollowState.read()).job).toMatchObject({ unfollowed: 1, queue: ['2'], status: 'paused' });
  expect((await unfollowState.read()).ledgers['1000']?.count).toBe(1);
});

it('uma retomada usa nova identidade de execução e rejeita o resultado antigo', async () => {
  const job = await startJob();
  await request({ type: 'unfollow:finished', jobId: job.id, result: { outcome: 'stopped', message: null, results: [], remaining: ['1', '2'] } }, 11);
  const resumed = await request<UnfollowStartResponse>({ type: 'unfollow:resume' });
  expect(resumed.ok).toBe(true);
  const current = (await unfollowState.read()).job!;
  expect(current.id).not.toBe(job.id);
  await request({ type: 'unfollow:finished', jobId: job.id, result: { outcome: 'completed', message: null, results: [], remaining: [] } }, 11);
  expect((await unfollowState.read()).job).toMatchObject({ id: current.id, status: 'running', queue: ['1', '2'] });
});

it('transforma uma execução desaparecida em pausa, sem reiniciar ações automaticamente', async () => {
  await startJob();
  runtime.actionJobId = null;
  await request({ type: 'unfollow:status', viewerId: '1000' });
  expect((await unfollowState.read()).job).toMatchObject({ status: 'paused', outcome: 'interrupted' });
  expect(runtime.commands.filter(command => command.message.type === 'unfollow:run')).toHaveLength(1);
});

it('o sinal de aba pronta não interrompe um lote iniciado nos primeiros segundos', async () => {
  const job = await startJob();
  await request({ type: 'autosync:ready' }, 11);
  expect((await unfollowState.read()).job).toMatchObject({ id: job.id, status: 'running' });
});

it('o sinal de aba pronta preserva uma análise manual que já está em andamento', async () => {
  await request({ type: 'sync:start' });
  const lease = (await schedulerState.getLease())!;
  await request({ type: 'autosync:ready' }, 11);
  expect((await schedulerState.getLease())?.runId).toBe(lease.runId);
});

it('rejeita resultado de coleta com execução, aba ou conta diferente', async () => {
  const started = await request<SyncStartResponse>({ type: 'sync:start' });
  expect(started.ok).toBe(true);
  const lease = (await schedulerState.getLease())!;
  for (const change of [
    { runId: 'outra-execucao', tabId: 11, viewerId: '1000' },
    { runId: lease.runId, tabId: 12, viewerId: '1000' },
    { runId: lease.runId, tabId: 11, viewerId: 'outra-conta' },
  ]) {
    const result = await request<CommitOutcome>({ type: 'collector:finished', runId: change.runId, result: makeResult({ viewerId: change.viewerId, finishedAt: 300 }) }, change.tabId);
    expect(result).toMatchObject({ status: 'rejected', reason: 'stale_run' });
  }
  expect(await runtime.db!.listSnapshots('1000')).toHaveLength(1);
  expect(await runtime.db!.getAccount('outra-conta')).toBeNull();
});

it('apagar a conta interrompe a coleta e impede a recriação por mensagens atrasadas', async () => {
  await request({ type: 'sync:start' });
  const lease = (await schedulerState.getLease())!;
  await request({ type: 'account:delete', viewerId: '1000' });
  const result = await request<CommitOutcome>({ type: 'collector:finished', runId: lease.runId, result: makeResult({ finishedAt: 300 }) }, 11);
  expect(result.status).toBe('rejected');
  expect(await runtime.db!.getAccount('1000')).toBeNull();
  expect(await schedulerState.getLease()).toBeNull();
  expect(await request({ type: 'keep:set', viewerId: '1000', pk: '2', kept: true })).toEqual({ ok: false, error: 'account_missing' });
});
