/**
 * Unfollows, removes as followers, or follows back a user-chosen list of
 * accounts, one at a time, slowly.
 *
 * This changes the user's account, so it is deliberately conservative:
 *   - only the accounts passed in, never more than `maxUnfollows`;
 *   - ~15-35 s between unfollows and a 5-minute pause after every 10;
 *   - the first sign that Instagram objects (action block, 429, "please wait",
 *     a sign-in or challenge page) stops the whole run;
 *   - an account that no longer exists is skipped, not retried.
 *
 * Success requires a JSON `ok` from Instagram, the follow reported off when it
 * reports the friendship state, and then a read-only friendship check showing
 * the follow is really gone. An HTML page with status 200 is never a success.
 *
 * Until Instagram has accepted one action in a run, a refusal says the
 * request is wrong, not the account (Instagram has answered a malformed request
 * with a bare 404 on a real account): the run stops with Instagram's answer and
 * the queue intact rather than skipping through the selection.
 */
import { abortableSleep, classifyFailure, describeStatus } from '../collector/collect';
import {
  fetchFriendshipStatus,
  followUser,
  isOkStatus,
  removeFollower,
  STATUS_SOFT_BLOCK,
  unfollowUser,
  type ApiResult,
  type FriendshipFlags,
  type InstagramClient,
} from '../instagram/api';

/** What a run does to each account. */
export type ActionKind = 'unfollow' | 'remove_follower' | 'follow';

type DoneOutcome = 'unfollowed' | 'removed' | 'followed' | 'requested';

interface ActionSpec {
  readonly run: (client: InstagramClient, pk: string) => Promise<ApiResult<FriendshipFlags>>;
  /** The friendship says the action didn't happen. Unknown flags (`null`) don't count. */
  readonly notDone: (flags: FriendshipFlags) => boolean;
  /** Unknown or absent fields never prove that an action completed. */
  readonly confirmed: (flags: FriendshipFlags) => boolean;
  readonly outcome: (flags: FriendshipFlags) => DoneOutcome;
  readonly doing: string;
  readonly past: string;
  readonly request: string;
  readonly stillReported: string;
  readonly stillAfterCheck: string;
}

const ACTIONS: Record<ActionKind, ActionSpec> = {
  unfollow: {
    run: unfollowUser,
    notDone: flags => flags.following === true,
    confirmed: flags => flags.following === false,
    outcome: () => 'unfollowed',
    doing: 'Unfollowing',
    past: 'unfollowed',
    request: 'unfollow',
    stillReported: 'Instagram still reports you follow this account.',
    stillAfterCheck: 'Instagram answered ok, but you still follow this account.',
  },
  remove_follower: {
    run: removeFollower,
    notDone: flags => flags.followedBy === true,
    confirmed: flags => flags.followedBy === false,
    outcome: () => 'removed',
    doing: 'Removing followers',
    past: 'removed',
    request: 'remove',
    stillReported: 'Instagram still reports this account follows you.',
    stillAfterCheck: 'Instagram answered ok, but this account still follows you.',
  },
  follow: {
    run: followUser,
    notDone: flags => flags.following === false && flags.outgoingRequest !== true,
    confirmed: flags => flags.following === true || flags.outgoingRequest === true,
    // A private account gets a request it has to approve.
    outcome: flags => (flags.following !== true && flags.outgoingRequest === true ? 'requested' : 'followed'),
    doing: 'Following back',
    past: 'followed',
    request: 'follow',
    stillReported: "Instagram didn't follow this account. It may want you to confirm this one on Instagram.",
    stillAfterCheck: "Instagram answered ok, but you don't follow this account.",
  },
};

export interface UnfollowSettings {
  readonly delayMs: number;
  readonly jitterMs: number;
  readonly pauseEvery: number;
  readonly pauseMs: number;
  /** Wait before the single retry after a network error or 5xx. */
  readonly retryAfterMs: number;
  /** Confirm each unfollow with a read-only friendship check. */
  readonly verify: boolean;
}

export const DEFAULT_UNFOLLOW_SETTINGS: UnfollowSettings = {
  delayMs: 15_000,
  jitterMs: 20_000,
  pauseEvery: 10,
  pauseMs: 5 * 60_000,
  retryAfterMs: 10_000,
  verify: true,
};

export type UnfollowItemOutcome = DoneOutcome | 'not_found' | 'failed' | 'unconfirmed' | 'protected';

export type ActionAuthorization = 'allowed' | 'protected' | 'cancelled' | 'limit' | 'blocked';

/** The outcome means the action happened (unfollowed, removed, followed, or a follow request sent). */
export function isDone(outcome: UnfollowItemOutcome): boolean {
  return outcome === 'unfollowed' || outcome === 'removed' || outcome === 'followed' || outcome === 'requested';
}

export interface UnfollowItemResult {
  readonly pk: string;
  readonly outcome: UnfollowItemOutcome;
  readonly detail: string | null;
  readonly at: number;
}

export type UnfollowRunOutcome = 'completed' | 'stopped' | 'blocked' | 'limit' | 'error' | 'no_session';

export interface UnfollowProgress {
  readonly total: number;
  readonly done: number;
  /** Accounts the action succeeded for (unfollowed, removed or followed). */
  readonly unfollowed: number;
  readonly current: string | null;
  readonly waiting: { readonly reason: 'pacing' | 'pause' | 'retry'; readonly ms: number; readonly endsAt: number } | null;
}

export interface UnfollowRunResult {
  readonly outcome: UnfollowRunOutcome;
  readonly message: string | null;
  readonly results: readonly UnfollowItemResult[];
  /** Accounts not attempted (stopped, blocked or over the limit), in order. */
  readonly remaining: readonly string[];
}

export interface UnfollowOptions {
  /** Defaults to unfollowing. */
  readonly kind?: ActionKind;
  readonly client: InstagramClient;
  readonly viewerId: string | null;
  /** Read again before each write, including retries, to catch account switches. */
  readonly currentViewerId?: () => string | null;
  /** Fresh background authorization immediately before each mutation request. */
  readonly authorize?: (pk: string) => Promise<ActionAuthorization>;
  readonly pks: readonly string[];
  readonly maxUnfollows: number;
  readonly settings?: Partial<UnfollowSettings>;
  readonly signal?: AbortSignal;
  readonly onItem?: (result: UnfollowItemResult) => void;
  readonly onProgress?: (progress: UnfollowProgress) => void;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

class RunStop extends Error {
  constructor(
    readonly outcome: Exclude<UnfollowRunOutcome, 'completed'>,
    message: string,
  ) {
    super(message);
  }
}

class ProtectedAccount extends Error {}
class ConfirmedBeforeRetry extends Error {
  constructor(readonly flags: FriendshipFlags) { super('Estado já confirmado antes do reenvio'); }
}

function describeAnswer(result: ApiResult<FriendshipFlags>): string {
  const message = result.failure?.message ? ` "${result.failure.message}"` : '';
  const body = result.response ? ` (${result.response.bodyKind})` : '';
  return `${describeStatus(result.status)}${message}${body}`;
}

/** Instagram refused the request itself, not this account: HTML app page, empty body, 404/405 without JSON. */
function requestRefused(result: ApiResult<FriendshipFlags>): boolean {
  const kind = result.response?.bodyKind;
  const notJson = kind === 'html' || kind === 'empty' || kind === 'text';
  return (
    (result.status === STATUS_SOFT_BLOCK && kind === 'html') ||
    ((result.status === 404 || result.status === 405) && notJson)
  );
}

export async function runUnfollows(options: UnfollowOptions): Promise<UnfollowRunResult> {
  const settings = { ...DEFAULT_UNFOLLOW_SETTINGS, ...options.settings };
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const signal = options.signal;
  const client: InstagramClient = { ...options.client, signal: signal ?? options.client.signal };
  const action = ACTIONS[options.kind ?? 'unfollow'];
  const queue = Array.from(new Set(options.pks));
  const results: UnfollowItemResult[] = [];
  let unfollowed = 0;
  let attempted = 0;
  let index = 0;
  let current: string | null = null;
  let accepted = false;

  const emit = (waiting: UnfollowProgress['waiting'] = null) =>
    options.onProgress?.({ total: queue.length, done: results.length, unfollowed, current, waiting });

  const checkStopped = () => {
    if (signal?.aborted) {
      throw new RunStop('stopped', 'Stopped. The rest are still in the queue.');
    }
    if (options.currentViewerId && options.currentViewerId() !== options.viewerId) {
      throw new RunStop('no_session', 'A conta do Instagram mudou. O lote foi interrompido; confira a conta antes de retomar.');
    }
  };

  const wait = async (reason: 'pacing' | 'pause' | 'retry', ms: number) => {
    emit({ reason, ms, endsAt: now() + ms });
    await sleep(ms, signal);
    checkStopped();
  };

  const record = (pk: string, outcome: UnfollowItemOutcome, detail: string | null) => {
    const item = { pk, outcome, detail, at: now() };
    results.push(item);
    if (outcome !== 'protected') {
      attempted++;
    }
    if (isDone(outcome)) {
      unfollowed++;
    }
    options.onItem?.(item);
  };

  /** One account, with a single retry on transient errors. */
  async function unfollowOne(pk: string): Promise<void> {
    let sends = 0;
    const requireSameViewer = () => {
      if (options.currentViewerId && options.currentViewerId() !== options.viewerId) {
        record(pk, 'unconfirmed', 'A sessão mudou antes da confirmação. Confira o resultado na conta de origem.');
        throw new RunStop('no_session', 'A conta mudou durante a ação. O resultado exige conferência manual.');
      }
    };
    const guardedClient: InstagramClient = {
      ...client,
      beforeWrite: async () => {
        await client.beforeWrite?.();
        checkStopped();
        if (sends > 0) {
          // Includes the token-refresh retry inside postForm after an HTML response.
          const check = await fetchFriendshipStatus(client, pk);
          requireSameViewer();
          if (check.data && action.confirmed(check.data)) {
            throw new ConfirmedBeforeRetry(check.data);
          }
          if (!check.data || !action.notDone(check.data)) {
            record(pk, 'unconfirmed', 'Não foi possível verificar o pedido anterior. Nenhuma repetição foi enviada.');
            const failure = classifyFailure(check.status, check.failure);
            throw new RunStop(failure === 'auth' || failure === 'throttled' ? 'blocked' : 'error', 'Pedido anterior sem confirmação. O lote foi interrompido.');
          }
        }
        const authorization = await options.authorize?.(pk);
        checkStopped();
        if (authorization === 'protected') {
          throw new ProtectedAccount();
        }
        if (authorization === 'cancelled') {
          throw new RunStop('stopped', 'A autorização deste lote expirou. Nenhuma nova ação será executada.');
        }
        if (authorization === 'limit') {
          throw new RunStop('limit', 'O limite interno de pedidos de alteração foi atingido. O restante ficou pausado.');
        }
        if (authorization === 'blocked') {
          throw new RunStop('blocked', 'Existe uma restrição registrada para esta conta. O lote foi interrompido.');
        }
        sends++;
      },
    };
    for (let attempt = 0; ; attempt++) {
      checkStopped();
      let result: ApiResult<FriendshipFlags>;
      try {
        result = await action.run(guardedClient, pk);
      } catch (error) {
        if (error instanceof ConfirmedBeforeRetry) {
          accepted = true;
          record(pk, action.outcome(error.flags), 'Resultado confirmado antes do reenvio. O pedido não foi repetido.');
          return;
        }
        if (error instanceof ProtectedAccount) {
          record(pk, 'protected', 'Conta protegida antes do próximo pedido. Esse pedido não foi enviado.');
          return;
        }
        throw error;
      }

      requireSameViewer();
      if (isOkStatus(result.status) && result.data) {
        accepted = true;
        if (action.notDone(result.data)) {
          record(pk, 'failed', action.stillReported);
          throw new RunStop('error', 'O Instagram informou que a ação não foi concluída. O lote foi interrompido.');
        }
        if (settings.verify) {
          const check = await fetchFriendshipStatus(client, pk);
          requireSameViewer();
          if (check.data && action.notDone(check.data)) {
            record(pk, 'failed', action.stillAfterCheck);
            throw new RunStop('error', 'A conferência não confirmou a ação. O lote foi interrompido.');
          }
          if (check.data && action.confirmed(check.data)) {
            record(pk, action.outcome(check.data), null);
            return;
          }
          record(pk, 'unconfirmed', 'O Instagram recebeu a ação, mas não foi possível confirmar o resultado. Confira o perfil manualmente.');
          const verificationFailure = classifyFailure(check.status, check.failure);
          throw new RunStop(
            verificationFailure === 'auth' || verificationFailure === 'throttled' ? 'blocked' : 'error',
            'Resultado não confirmado. O lote foi interrompido para você conferir o perfil; esta conta não será repetida automaticamente.',
          );
        }
        if (!action.confirmed(result.data)) {
          record(pk, 'unconfirmed', 'A resposta não informa o estado da relação. Confira o perfil manualmente.');
          throw new RunStop('error', 'Resultado não confirmado. O restante do lote foi pausado.');
        }
        record(pk, action.outcome(result.data), null);
        return;
      }

      const failure = result.failure;
      const kind = classifyFailure(result.status, failure);
      const detail = describeAnswer(result);
      if (failure?.actionBlocked || failure?.spam) {
        throw new RunStop(
          'blocked',
          `Instagram blocked this for now${failure.message ? ` ("${failure.message}")` : ''}. Paused for a day.`,
        );
      }
      if (kind === 'auth') {
        throw new RunStop('blocked', `Instagram asked to sign in again or finish a security check. ${action.doing} stopped.`);
      }

      if (!accepted && (kind === 'fatal' || requestRefused(result))) {
        throw new RunStop(
          'error',
          `Instagram didn't accept the ${action.request} request (${detail}). Nothing was ${action.past}; the accounts stay queued.`,
        );
      }

      if (kind === 'throttled') {
        throw new RunStop('blocked', `Instagram asked to slow down (${describeStatus(result.status)}). Paused for a day.`);
      }
      if (kind === 'transient') {
        // A lost response does not mean the POST failed. Read before any retry.
        const check = await fetchFriendshipStatus(client, pk);
        requireSameViewer();
        if (check.data && action.confirmed(check.data)) {
          record(pk, action.outcome(check.data), 'Resultado confirmado após falha de comunicação, sem reenviar a alteração.');
          return;
        }
        if (!check.data || !action.notDone(check.data)) {
          record(pk, 'unconfirmed', 'Falha de comunicação após o pedido. Não foi reenviado; confira o perfil manualmente.');
          const checkFailure = classifyFailure(check.status, check.failure);
          throw new RunStop(checkFailure === 'auth' || checkFailure === 'throttled' ? 'blocked' : 'error', 'Não foi possível verificar o resultado do pedido. O lote foi interrompido.');
        }
        if (attempt === 0) {
          await wait('retry', settings.retryAfterMs);
          continue;
        }
        throw new RunStop('error', `Instagram could not be reached. ${action.doing} stopped; try again later.`);
      }
      // The action works, so this refusal is about this one account (deleted, deactivated, not followed).
      record(pk, result.status === 404 || result.status === 400 ? 'not_found' : 'failed', detail);
      return;
    }
  }

  let outcome: UnfollowRunOutcome = 'completed';
  let message: string | null = null;
  try {
    if (!options.viewerId) {
      throw new RunStop('no_session', 'No signed-in Instagram account in this tab.');
    }
    for (; index < queue.length; index++) {
      checkStopped();
      if (attempted >= options.maxUnfollows) {
        throw new RunStop('limit', `Reached today's limit. The rest stay queued for tomorrow.`);
      }
      current = queue[index]!;
      emit();
      const before = attempted;
      await unfollowOne(current);
      current = null;
      const isLast = index === queue.length - 1;
      if (!isLast && attempted > before) {
        if (settings.pauseEvery > 0 && attempted % settings.pauseEvery === 0) {
          await wait('pause', settings.pauseMs);
        } else {
          await wait('pacing', settings.delayMs + Math.floor(random() * settings.jitterMs));
        }
      }
    }
    index = queue.length;
  } catch (error) {
    if (error instanceof RunStop) {
      outcome = error.outcome;
      message = error.message;
    } else {
      outcome = 'error';
      message = `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  current = null;
  emit();

  const handledPks = new Set(results.map(item => item.pk));
  return {
    outcome,
    message,
    results,
    remaining: queue.filter(pk => !handledPks.has(pk)),
  };
}

