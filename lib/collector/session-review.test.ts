import { expect, it } from 'vitest';
import { accounts, createFakeInstagram } from '../testing/fake-instagram';
import { collect } from './collect';

it('uma troca de sessão no meio da coleta impede salvar uma análise misturada', async () => {
  const fake = createFakeInstagram({ following: accounts('1'), followers: accounts('1') });
  let viewer = fake.viewerId;
  const result = await collect({
    viewerId: fake.viewerId, currentViewerId: () => viewer,
    client: { ...fake.client, fetch: async (input, init) => {
      const response = await fake.client.fetch(input, init);
      if (String(input).includes('/followers/')) { viewer = 'outra-conta'; }
      return response;
    } },
    sleep: async () => undefined,
  });
  expect(result.outcome).toBe('blocked');
  expect(result.message).toMatch(/conta mudou/);
});
