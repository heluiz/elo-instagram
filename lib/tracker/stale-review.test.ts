import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { makeResult } from '../testing/fixtures';
import { TrackerStore } from './store';

it('uma análise antiga ou duplicada não substitui dados nem cria eventos extras', async () => {
  const name = `elo-stale-${crypto.randomUUID()}`;
  const db = await TrackerStore.open(name);
  try {
    await db.commit(makeResult({ followerIds: ['1', '2'], finishedAt: 300 }));
    for (const finishedAt of [200, 300]) {
      expect(await db.commit(makeResult({ followerIds: [], finishedAt }))).toMatchObject({ status: 'rejected', reason: 'stale_run' });
    }
    expect((await db.getLatestSnapshot('1000'))?.followerIds).toEqual(['1', '2']);
    expect(await db.listEvents('1000')).toEqual([]);
    expect(await db.listSnapshots('1000')).toHaveLength(1);
  } finally { db.close(); indexedDB.deleteDatabase(name); }
});
