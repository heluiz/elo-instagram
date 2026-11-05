import { afterEach, expect, it, vi } from 'vitest';
import { fetchProfile, REQUEST_TIMEOUT_MS, STATUS_NETWORK_ERROR, type InstagramClient } from './api';

afterEach(() => vi.useRealTimers());

function hangingClient(signal?: AbortSignal): InstagramClient {
  return {
    signal, csrfToken: () => null,
    fetch: (_input, init) => new Promise((_resolve, reject) => {
      const fail = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init?.signal?.aborted) { fail(); } else { init?.signal?.addEventListener('abort', fail, { once: true }); }
    }),
  };
}

it('encerra um pedido que nunca responde após o prazo máximo', async () => {
  vi.useFakeTimers();
  const result = fetchProfile(hangingClient(), '1');
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  expect((await result).status).toBe(STATUS_NETWORK_ERROR);
  expect(vi.getTimerCount()).toBe(0);
});

it('o botão Interromper cancela a espera da rede antes do prazo máximo', async () => {
  const controller = new AbortController();
  const result = fetchProfile(hangingClient(controller.signal), '1');
  controller.abort();
  expect((await result).status).toBe(STATUS_NETWORK_ERROR);
});
