import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { makeResult } from '../testing/fixtures';
import { TrackerStore } from './store';

it('exporta protegidos e ações sem misturar contas e sem credenciais', async () => {
  const name = `elo-export-${crypto.randomUUID()}`;
  const store = await TrackerStore.open(name);
  try {
    for (const viewerId of ['A', 'B']) {
      await store.commit(makeResult({ viewerId, followerIds: ['1'], finishedAt: 100 }));
      await store.setKeep(viewerId, [viewerId === 'A' ? '1' : '9'], true, 101);
      await store.recordAction({ viewerId, pk: '1', type: 'remove_follower', outcome: 'unconfirmed', detail: 'Conferir', at: 102 });
    }
    const data = await store.exportAccount('A');
    expect(data).toMatchObject({ format: 'elo-account', version: 1, account: { viewerId: 'A' } });
    expect(data.keep).toMatchObject([{ viewerId: 'A', pk: '1' }]);
    expect(data.actions).toMatchObject([{ viewerId: 'A', outcome: 'unconfirmed' }]);
    expect(JSON.stringify(data)).not.toMatch(/sessionid|csrftoken|fb_dtsg|password/);
  } finally {
    store.close();
    indexedDB.deleteDatabase(name);
  }
});
