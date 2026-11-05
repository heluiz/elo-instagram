import { beforeEach, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_PREFS, schedulerState } from './state';

beforeEach(() => fakeBrowser.reset());

it('uma instalação nova começa sem sincronização automática', async () => {
  const state = await schedulerState.read();
  expect(DEFAULT_PREFS.enabled).toBe(false);
  expect(state.prefs.enabled).toBe(false);
});

it('preserva a escolha explícita do usuário depois de reler as preferências', async () => {
  await schedulerState.setPrefs({ enabled: true });
  expect((await schedulerState.read()).prefs.enabled).toBe(true);
  await schedulerState.setPrefs({ enabled: false });
  expect((await schedulerState.read()).prefs.enabled).toBe(false);
});
