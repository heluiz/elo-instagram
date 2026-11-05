import { expect, it } from 'vitest';
import type { ActionRecord } from '../tracker/store';
import { panelLists } from './view';

const action = (id: number, type: 'follow' | 'unfollow', outcome: 'followed' | 'unfollowed'): ActionRecord => ({
  id, viewerId: 'v', pk: '1', type, outcome, at: id, detail: null,
});

it('reflete seguir novamente após um unfollow, mesmo recebendo os registros em ordem inversa', () => {
  const lists = panelLists({ followerIds: ['1'], followingIds: ['1'] }, [
    action(2, 'follow', 'followed'), action(1, 'unfollow', 'unfollowed'),
  ]);
  expect(lists.following).toEqual(['1']);
  expect(lists.mutuals).toEqual(['1']);
});

it('usa o último resultado confirmado numa sequência seguir, unfollow, seguir', () => {
  const lists = panelLists({ followerIds: ['1'], followingIds: [] }, [
    action(3, 'follow', 'followed'), action(2, 'unfollow', 'unfollowed'), action(1, 'follow', 'followed'),
  ]);
  expect(lists.following).toEqual(['1']);
});
