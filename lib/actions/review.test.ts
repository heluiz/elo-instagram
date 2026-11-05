import { expect, it } from 'vitest';
import { accounts, createFakeInstagram, html, json } from '../testing/fake-instagram';
import { runUnfollows, type UnfollowOptions } from './unfollow';

it('respeita uma proteção adicionada enquanto um lote já aguarda a próxima ação', async () => {
  const fake = createFakeInstagram({ following: accounts('1', '2') });
  const protectedIds = new Set<string>();
  const options: UnfollowOptions & { authorize: (pk: string) => Promise<'allowed' | 'protected' | 'cancelled'> } = {
    client: fake.client, viewerId: fake.viewerId, pks: ['1', '2'], maxUnfollows: 100,
    sleep: async () => { protectedIds.add('2'); },
    authorize: async pk => protectedIds.has(pk) ? 'protected' : 'allowed',
  };
  const result = await runUnfollows(options);
  expect(fake.unfollowed).toEqual(['1']);
  expect(result.results).toMatchObject([{ pk: '1', outcome: 'unfollowed' }, { pk: '2', outcome: 'protected' }]);
});

it('interrompe o lote quando o Instagram informa que uma ação não ocorreu', async () => {
  const fake = createFakeInstagram({
    following: accounts('1', '2', '3'),
    intercept: r => r.path.includes('/destroy/2/') ? json({ status: 'ok', friendship_status: { following: true } }) : undefined,
  });
  const result = await runUnfollows({
    client: fake.client, viewerId: fake.viewerId, pks: ['1', '2', '3'], maxUnfollows: 100, sleep: async () => undefined,
  });
  expect(fake.unfollowed).toEqual(['1']);
  expect(result.outcome).toBe('error');
  expect(result.remaining).toEqual(['3']);
});

for (const kind of ['unfollow', 'remove_follower', 'follow'] as const) {
  it(`${kind}: não repete uma alteração já aplicada quando a resposta se perde na rede`, async () => {
    const fake = createFakeInstagram({ following: accounts('1'), followers: accounts('1') });
    let lost = false;
    const result = await runUnfollows({
      kind, viewerId: fake.viewerId, pks: ['1'], maxUnfollows: 100,
      client: {
        ...fake.client,
        fetch: async (input, init) => {
          const response = await fake.client.fetch(input, init);
          if (init?.method === 'POST' && !lost) {
            lost = true;
            throw new TypeError('Resposta perdida depois de aplicar a alteração');
          }
          return response;
        },
      },
      sleep: async () => undefined,
    });
    expect(result.outcome).toBe('completed');
    expect(fake.requests.filter(request => request.method === 'POST')).toHaveLength(1);
  });
  it(`${kind}: também verifica antes de repetir uma resposta HTML`, async () => {
    const fake = createFakeInstagram({ following: accounts('1'), followers: accounts('1') });
    let replaced = false;
    const result = await runUnfollows({
      kind, viewerId: fake.viewerId, pks: ['1'], maxUnfollows: 100,
      client: { ...fake.client, fetch: async (input, init) => {
        const response = await fake.client.fetch(input, init);
        if (init?.method === 'POST' && !replaced) { replaced = true; return html('<html>Resposta HTML após aplicar</html>'); }
        return response;
      } },
      sleep: async () => undefined,
    });
    expect(result.outcome).toBe('completed');
    expect(fake.requests.filter(request => request.method === 'POST')).toHaveLength(1);
  });
}
