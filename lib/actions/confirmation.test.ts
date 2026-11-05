import { describe, expect, it } from 'vitest';
import { accounts, createFakeInstagram, json } from '../testing/fake-instagram';
import { isDone, runUnfollows, type ActionKind } from './unfollow';

describe('elo: confirmação de ações', () => {
  for (const kind of ['unfollow', 'remove_follower', 'follow'] as const satisfies readonly ActionKind[]) {
    it(`${kind}: não confunde um JSON vazio com confirmação`, async () => {
      const fake = createFakeInstagram({
        following: accounts('1', '2'),
        followers: accounts('1', '2'),
        intercept: r => r.path.includes('/show/') ? json({ status: 'ok' }) : undefined,
      });
      const result = await runUnfollows({
        client: fake.client, viewerId: fake.viewerId, pks: ['1', '2'],
        kind, maxUnfollows: 100, sleep: async () => undefined,
      });
      expect(result.outcome).toBe('error');
      expect(result.results).toMatchObject([{ pk: '1', outcome: 'unconfirmed' }]);
      expect(isDone(result.results[0]!.outcome)).toBe(false);
      expect(result.remaining).toEqual(['2']);
      expect(fake.requests.filter(r => r.method === 'POST')).toHaveLength(1);
    });
  }

  it('pausa por bloqueio quando a verificação recebe 429 e não repete a conta incerta', async () => {
    const fake = createFakeInstagram({
      following: accounts('1', '2'),
      intercept: r => r.path.includes('/show/') ? json({}, 429) : undefined,
    });
    const result = await runUnfollows({
      client: fake.client, viewerId: fake.viewerId, pks: ['1', '2'],
      maxUnfollows: 100, sleep: async () => undefined,
    });
    expect(result.outcome).toBe('blocked');
    expect(result.results[0]?.outcome).toBe('unconfirmed');
    expect(result.remaining).toEqual(['2']);
    expect(fake.unfollowed).toEqual(['1']);
  });

  it('recusa uma conta diferente antes de enviar qualquer ação', async () => {
    const fake = createFakeInstagram({ following: accounts('1') });
    const result = await runUnfollows({
      client: fake.client, viewerId: fake.viewerId, currentViewerId: () => 'outra-conta',
      pks: ['1'], maxUnfollows: 100,
    });
    expect(result.outcome).toBe('no_session');
    expect(fake.requests).toEqual([]);
    expect(result.remaining).toEqual(['1']);
  });

  it('interrompe entre duas ações se a sessão mudar', async () => {
    const fake = createFakeInstagram({ following: accounts('1', '2') });
    let currentViewer = fake.viewerId;
    const result = await runUnfollows({
      client: fake.client, viewerId: fake.viewerId, currentViewerId: () => currentViewer,
      pks: ['1', '2'], maxUnfollows: 100,
      sleep: async () => { currentViewer = 'outra-conta'; },
    });
    expect(result.outcome).toBe('no_session');
    expect(fake.unfollowed).toEqual(['1']);
    expect(result.remaining).toEqual(['2']);
  });

  it('exige estado explícito mesmo quando um chamador desativa a segunda consulta', async () => {
    const fake = createFakeInstagram({ intercept: () => json({ status: 'ok' }) });
    const result = await runUnfollows({
      client: fake.client, viewerId: fake.viewerId, pks: ['1'],
      maxUnfollows: 100, settings: { verify: false },
    });
    expect(result.results[0]?.outcome).toBe('unconfirmed');
    expect(result.outcome).toBe('error');
  });
});
