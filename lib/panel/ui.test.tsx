// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, waitFor } from '@testing-library/preact';
import { render } from 'preact';
import { expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { IgUser } from '../instagram/api';
import type { BackgroundRequest } from '../messages';
import { makeResult } from '../testing/fixtures';
import { TrackerStore } from '../tracker/store';

const sent = vi.hoisted(() => [] as BackgroundRequest[]);
vi.mock('../../entrypoints/sidepanel/avatars', () => ({ useAvatars: () => new Map() }));
vi.mock('../messages', () => ({
  sendToBackground: async (message: BackgroundRequest) => {
    sent.push(message);
    switch (message.type) {
      case 'env:status': return { problem: null, collector: { viewerId: '1000' } };
      case 'scheduler:status': return { enabled: false, running: null, lastSyncAt: 100, budgetUsed: 0, dailyBudget: 600 };
      case 'unfollow:status': return { job: null, allowance: { allowed: true, remaining: 100 }, today: 0 };
      case 'keep:set': {
        const { TrackerStore } = await import('../tracker/store');
        const db = await TrackerStore.open();
        await db.setKeep(message.viewerId, [message.pk], message.kept, Date.now());
        db.close();
        return { ok: true };
      }
      default: return { ok: true };
    }
  },
}));

it('painel: protegidos, revisão e cancelamento, unfollow e remoção exigem cliques explícitos', async () => {
  fakeBrowser.reset();
  sent.length = 0;
  const container = document.createElement('div');
  container.id = 'app';
  document.body.appendChild(container);
  const store = await TrackerStore.open();
  const users: IgUser[] = ['ana.dev', 'bruno.ti', 'carla.lab', 'davi.lab'].map((username, i) => ({
    pk: String(i + 1), ids: [String(i + 1)], username, fullName: username,
    profilePicUrl: '', isPrivate: false, isVerified: false, followedBy: null,
  }));
  await store.commit(makeResult({ users, followerIds: ['1', '4'], followingIds: ['1', '2', '3'], finishedAt: 100 }));
  const rows = () => Array.from(container.querySelectorAll<HTMLLIElement>('li.row'));
  const row = (username: string) => rows().find(el => el.textContent?.includes(`@${username}`))!;
  const button = (name: string, parent: ParentNode = container) => Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find(el => el.textContent?.trim() === name)!;
  const mutations = () => sent.filter(message => message.type === 'unfollow:start');
  try {
    await import('../../entrypoints/sidepanel/main');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(mutations()).toEqual([]);
    expect(sent.some(message => message.type === 'sync:start')).toBe(false);
    fireEvent.click(row('bruno.ti').querySelector('button.keep')!);
    await waitFor(() => expect(row('bruno.ti').querySelector('button.keep')?.getAttribute('aria-pressed')).toBe('true'));
    expect((await store.listKeep('1000')).has('2')).toBe(true);
    fireEvent.click(container.querySelector('.toolbar input[type="checkbox"]')!);
    await waitFor(() => expect((row('carla.lab').querySelector('input') as HTMLInputElement).checked).toBe(true));
    expect((row('bruno.ti').querySelector('input') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(button('Deixar de seguir 1', container.querySelector('.selection-bar')!));
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    let dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('.review-accounts')?.textContent).toBe('@carla.lab');
    expect(mutations()).toEqual([]);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
    expect(mutations()).toEqual([]);
    fireEvent.click(button('Deixar de seguir 1', container.querySelector('.selection-bar')!));
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    fireEvent.click(button('Deixar de seguir 1', dialog));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ viewerId: '1000', pks: ['3'], kind: 'unfollow' });
    fireEvent.click(button('2seguidores'));
    await waitFor(() => expect(row('davi.lab')).toBeDefined());
    fireEvent.click(button('Remover seguidor', row('davi.lab')));
    await waitFor(() => expect(row('davi.lab').querySelector('.confirm')).not.toBeNull());
    expect(mutations()).toHaveLength(1);
    fireEvent.click(button('Remover seguidor', row('davi.lab').querySelector('.confirm')!));
    await waitFor(() => expect(mutations()).toHaveLength(2));
    expect(mutations()[1]).toMatchObject({ viewerId: '1000', pks: ['4'], kind: 'remove_follower' });
    fireEvent.click(button('1protegidos'));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(row('bruno.ti')).toBeDefined();
    expect(row('bruno.ti').querySelector('.row-actions')?.textContent).toBe('');
  } finally {
    render(null, container);
    store.close();
    container.remove();
  }
});
