import { render, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { DAILY_UNFOLLOW_LIMIT } from '../../lib/actions/limits';
import type { UnfollowJob } from '../../lib/actions/state';
import { isDone, type ActionKind, type UnfollowProgress } from '../../lib/actions/unfollow';
import type { CollectionProgress } from '../../lib/collector/collect';
import { DIAGNOSTICS_ENABLED } from '../../lib/env';
import { INSTAGRAM_ORIGIN } from '../../lib/instagram/api';
import {
  sendToBackground,
  type Broadcast,
  type EnvStatus,
  type SchedulerStatus,
  type SyncStartResponse,
  type UnfollowStartError,
  type UnfollowStartResponse,
  type UnfollowStatus,
} from '../../lib/messages';
import {
  countSeries,
  estimateUnfollowMs,
  followerDiff,
  formatAgo,
  formatDuration,
  groupByDay,
  linePath,
  listsCsv,
  matchesSearch,
  panelLists,
  pendingFollowRequests,
  selectable,
  sortAccounts,
  type PanelLists,
  type SortOrder,
} from '../../lib/panel/view';
import {
  TrackerStore,
  type ActionRecord,
  type EventRecord,
  type LatestSnapshot,
  type ProfileRecord,
  type SnapshotRecord,
} from '../../lib/tracker/store';
import { useAvatars } from './avatars';
import './style.css';

const storePromise = TrackerStore.open();
const PAGE_SIZE = 100;

type ListTab = 'followers' | 'following' | 'nfb' | 'fans' | 'mutuals' | 'keep';
type Tab = ListTab | 'changes' | 'graph' | 'actions';

/** What you can do to the accounts in each list. */
const TAB_ACTIONS: Record<ListTab, readonly ActionKind[]> = {
  followers: ['follow', 'remove_follower'],
  following: ['unfollow'],
  nfb: ['unfollow'],
  fans: ['follow', 'remove_follower'],
  mutuals: ['unfollow', 'remove_follower'],
  keep: [],
};

const ACTION_WORDS: Record<ActionKind, { verb: string; doing: string; past: string }> = {
  unfollow: { verb: 'Deixar de seguir', doing: 'Deixando de seguir', past: 'deixou de seguir' },
  remove_follower: { verb: 'Remover seguidor', doing: 'Removendo seguidores', past: 'removeu' },
  follow: { verb: 'Seguir de volta', doing: 'Seguindo de volta', past: 'seguiu' },
};

const isListTab = (tab: Tab): tab is ListTab => tab in TAB_ACTIONS;

interface Data {
  readonly viewerId: string;
  readonly username: string | null;
  readonly latest: LatestSnapshot | null;
  readonly lists: PanelLists | null;
  readonly profiles: ReadonlyMap<string, ProfileRecord>;
  readonly keep: ReadonlySet<string>;
  readonly events: readonly EventRecord[];
  /** Unfollow and remove attempts since the latest snapshot, newest first. */
  readonly actions: readonly ActionRecord[];
  readonly audit: readonly ActionRecord[];
  /** Newest first, for the graph. */
  readonly snapshots: readonly SnapshotRecord[];
}

async function loadData(viewerId: string): Promise<Data> {
  const db = await storePromise;
  const [account, latest, keep, events, snapshots] = await Promise.all([
    db.getAccount(viewerId),
    db.getLatestSnapshot(viewerId),
    db.listKeep(viewerId),
    db.listEvents(viewerId, 300),
    db.listSnapshots(viewerId, 90),
  ]);
  const actions = latest ? await db.listActions(viewerId, latest.takenAt) : [];
  const audit = await db.listActions(viewerId, -Infinity, 300);
  const lists = latest ? panelLists(latest, actions) : null;
  const pks = new Set([
    ...actions.map(action => action.pk),
    ...audit.map(action => action.pk),
    ...keep,
    ...(lists?.notFollowingBack ?? []),
    ...(lists?.fans ?? []),
    ...(lists?.mutuals ?? []),
    ...events.map(event => event.pk),
  ]);
  const profiles = await db.getProfiles(viewerId, Array.from(pks));
  return { viewerId, username: account?.username ?? null, latest, lists, profiles, keep, events, actions, audit, snapshots };
}

const START_ERRORS: Record<UnfollowStartError, string> = {
  no_instagram_tab: 'Abra instagram.com em uma aba. As ações usam sua sessão nessa aba.',
  content_script_missing: 'Recarregue a aba do Instagram e tente novamente.',
  signed_out: 'Entre na sua conta na aba do Instagram e tente novamente.',
  wrong_account: 'A aba do Instagram está conectada a outra conta. Confira antes de continuar.',
  already_running: 'Há uma análise ou um lote em andamento. Aguarde ou interrompa.',
  nothing_to_do: 'Nenhuma conta disponível: as contas selecionadas estão protegidas.',
  blocked: 'O Instagram restringiu as ações por enquanto.',
  daily_limit: `Você atingiu o limite interno de ${DAILY_UNFOLLOW_LIMIT} pedidos de alteração hoje.`,
};

const EVENT_TEXT: Record<EventRecord['type'], (who: string) => string> = {
  follower_lost: who => `${who} não consta mais entre seus seguidores`,
  follower_removed: who => `Você removeu ${who} dos seguidores`,
  follower_gained: who => `${who} apareceu entre seus seguidores`,
  following_removed: who => `Você deixou de seguir ${who}`,
  following_added: who => `Você passou a seguir ${who}`,
};

function formatClock(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** `picture` is the cached profile picture; Instagram's own URLs don't load in extension pages. */
function Avatar({ profile, picture }: { profile: ProfileRecord | undefined; picture: string | undefined }) {
  if (!picture) {
    return <div class='avatar'>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</div>;
  }
  return <img class='avatar' src={picture} alt='' />;
}

function Who({ pk, profile }: { pk: string; profile: ProfileRecord | undefined }) {
  return (
    <div class='who'>
      <div class='handle'>
        {profile ? (
          <a href={`${INSTAGRAM_ORIGIN}/${encodeURIComponent(profile.username)}/`} target='_blank' rel='noreferrer'>
            @{profile.username}
          </a>
        ) : (
          <span>id {pk}</span>
        )}
        {profile?.isVerified && (
          <span class='verified' title='Verificado'>
            ✓
          </span>
        )}
      </div>
      {profile?.fullName && <div class='name'>{profile.fullName}</div>}
    </div>
  );
}

function SyncLine({
  env,
  scheduler,
  progress,
  now,
}: {
  env: EnvStatus | null;
  scheduler: SchedulerStatus | null;
  progress: CollectionProgress | null;
  now: number;
}) {
  if (progress && progress.phase !== 'done') {
    const total = progress.reportedFollowers;
    return (
      <div class='sync-line'>
        <span class='spinner' />
        Analisando… {progress.followers}
        {total ? ` de ${total}` : ''} seguidores
      </div>
    );
  }
  if (scheduler?.running) {
    return (
      <div class='sync-line'>
        <span class='spinner' />
        Analisando…
      </div>
    );
  }
  const parts: string[] = [];
  parts.push(scheduler?.lastSyncAt ? `Atualizado ${formatAgo(scheduler.lastSyncAt, now)}` : 'Nenhuma análise salva');
  const next = scheduler?.next;
  if (next?.action === 'wait' && next.reason === 'fresh' && next.until) {
    parts.push(`próxima: ${formatClock(next.until)}`);
  } else if (next?.action === 'wait' && next.reason === 'disabled') {
    parts.push('atualização manual');
  }
  if (env?.problem === 'no_instagram_tab') {
    parts.push('abra o Instagram para analisar');
  }
  return <div class='sync-line'>{parts.join(' · ')}</div>;
}

function Failures({
  kind,
  failures,
}: {
  kind: ActionKind;
  failures: ReadonlyArray<{ readonly who: string; readonly detail: string | null }>;
}) {
  if (failures.length === 0) {
    return null;
  }
  return (
    <div class='sync-line' style={{ display: 'block' }}>
      {failures.slice(0, 3).map(failure => (
        <div key={failure.who}>
          Não foi possível {ACTION_WORDS[kind].verb.toLowerCase()}: {failure.who}
          {failure.detail ? `: ${failure.detail}` : ''}
        </div>
      ))}
      {failures.length > 3 && <div>e mais {failures.length - 3}</div>}
    </div>
  );
}

function JobBanner({
  job,
  progress,
  failures,
  now,
  onStop,
  onResume,
  onDismiss,
}: {
  job: UnfollowJob;
  progress: UnfollowProgress | null;
  failures: ReadonlyArray<{ readonly who: string; readonly detail: string | null }>;
  now: number;
  onStop: () => void;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const words = ACTION_WORDS[job.kind ?? 'unfollow'];
  const done = job.total - job.queue.length;
  const percent = job.total ? Math.round((done / job.total) * 100) : 0;
  if (job.status === 'running') {
    const waiting = progress?.waiting;
    const left = waiting ? Math.max(0, waiting.endsAt - now) : 0;
    return (
      <div class='notice'>
        <b>
          {words.doing}… {job.unfollowed} de {job.total}
        </b>
        <div class='progress'>
          <div style={{ width: `${percent}%` }} />
        </div>
        <div class='sync-line'>
          {waiting
            ? waiting.reason === 'pause'
              ? `Pausa entre ações: faltam ${formatDuration(left)}`
              : `Próxima em ${formatDuration(left)}`
            : 'Processando…'}
          {' · mantenha a aba do Instagram aberta'}
        </div>
        <div class='actions'>
          <button onClick={onStop}>Interromper</button>
        </div>
      </div>
    );
  }
  if (job.status === 'paused') {
    return (
      <div class={`notice ${job.outcome === 'blocked' ? 'bad' : 'warn'}`}>
        <b>
          Pausado: {job.queue.length} restantes ({job.unfollowed} confirmadas)
        </b>
        {job.message && <div class='sync-line'>{job.message}</div>}
        <Failures kind={job.kind ?? 'unfollow'} failures={failures} />
        <div class='actions'>
          <button class='primary' onClick={onResume}>
            Retomar
          </button>
          <button onClick={onDismiss}>Descartar restantes</button>
        </div>
      </div>
    );
  }
  return (
    <div class={`notice${job.unfollowed === 0 ? ' bad' : job.skipped ? ' warn' : ''}`}>
      <b>
        Concluído: {job.unfollowed} ações confirmadas
        {job.skipped ? `, ${job.skipped} não executadas ou sem confirmação` : ''}.
      </b>
      <Failures kind={job.kind ?? 'unfollow'} failures={failures} />
      {job.unfollowed > 0 && (
        <div class='sync-line'>
          O histórico será atualizado na próxima análise. Os resultados já constam em Ações recentes.
        </div>
      )}
      <div class='actions'>
        <button onClick={onDismiss}>Fechar</button>
      </div>
    </div>
  );
}

function download(filename: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function SettingsView({
  data,
  scheduler,
  unfollow,
  onChanged,
}: {
  data: Data;
  scheduler: SchedulerStatus | null;
  unfollow: UnfollowStatus | null;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = data.username ?? data.viewerId;

  const toggleAuto = async (enabled: boolean) => {
    await sendToBackground({ type: 'scheduler:set', enabled });
    onChanged();
  };

  const exportJson = async () => {
    const everything = await (await storePromise).exportAccount(data.viewerId);
    download(`elo-${name}-${stamp}.json`, 'application/json', JSON.stringify(everything, null, 2));
  };

  const deleteAll = async () => {
    const response = await sendToBackground<{ ok: boolean }>({ type: 'account:delete', viewerId: data.viewerId });
    if (!response.ok) {
      return;
    }
    setConfirmDelete(false);
    onChanged();
  };

  return (
    <div class='settings'>
      <section>
        <h3>Atualização automática</h3>
        <label class='check'>
          <input
            type='checkbox'
            checked={scheduler?.enabled ?? false}
            onChange={event => void toggleAuto((event.currentTarget as HTMLInputElement).checked)}
          />
          Analisar uma vez ao dia enquanto uma aba do Instagram estiver aberta
        </label>
        <p class='muted'>
          {scheduler
            ? `${scheduler.budgetUsed} de ${scheduler.dailyBudget} consultas internas usadas hoje.`
            : 'Carregando…'}
        </p>
      </section>
      <section>
        <h3>Deixar de seguir, remover e seguir de volta</h3>
        <p class='muted'>
          {unfollow ? `${unfollow.today} de ${DAILY_UNFOLLOW_LIMIT} pedidos de alteração do limite interno usados hoje.` : 'Carregando…'} Contas marcadas com estrela ficam protegidas contra unfollow e remoção. Esse limite é do aplicativo e não garante ausência de restrições no Instagram.
        </p>
      </section>
      <section>
        <h3>Seus dados</h3>
        <p class='muted'>As análises ficam neste navegador. A comunicação com o Instagram usa sua sessão aberta.</p>
        <div class='buttons'>
          <button
            disabled={!data.lists}
            onClick={() => data.lists && download(`elo-${name}-${stamp}.csv`, 'text/csv', listsCsv(data.lists, data.profiles, data.keep))}
          >
            Exportar listas (CSV)
          </button>
          <button onClick={() => void exportJson()}>Exportar histórico e protegidos (JSON)</button>
        </div>
        <div class='buttons'>
          {confirmDelete ? (
            <>
              <span>Apagar todos os dados locais de @{name}?</span>
              <button class='danger' onClick={() => void deleteAll()}>
                Apagar
              </button>
              <button onClick={() => setConfirmDelete(false)}>Cancelar</button>
            </>
          ) : (
            <button class='danger' onClick={() => setConfirmDelete(true)}>
              Apagar dados locais desta conta
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ConfirmSheet({
  kind,
  count,
  accounts,
  remainingToday,
  onCancel,
  onConfirm,
}: {
  kind: ActionKind;
  count: number;
  accounts: readonly string[];
  remainingToday: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const runs = Math.min(count, remainingToday);
  const words = ACTION_WORDS[kind];
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = () => Array.from(sheet.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    buttons()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key === 'Tab') {
        const all = buttons();
        const first = all[0];
        const last = all.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [onCancel]);
  return (
    <div class='sheet-backdrop' onClick={onCancel}>
      <div ref={sheet} class='sheet' role='dialog' aria-modal='true' aria-labelledby='confirmation-title' onClick={event => event.stopPropagation()}>
        <h2 id='confirmation-title'>
          {words.verb} {count} {count === 1 ? 'conta' : 'contas'}
          {kind === 'remove_follower' ? ' da sua lista de seguidores' : ''}?
        </h2>
        <ul class='review-accounts'>{accounts.map(account => <li key={account}>@{account}</li>)}</ul>
        {kind === 'remove_follower' && (
          <p>Essas contas deixarão de seguir você. Elas poderão voltar a seguir ou solicitar acesso ao seu perfil.</p>
        )}
        {kind === 'follow' && <p>Contas privadas recebem uma solicitação, que depende de aprovação.</p>}
        <p>
          As ações serão executadas na aba do Instagram, uma por vez. Estimativa: {formatDuration(estimateUnfollowMs(runs))}. Você pode interromper a qualquer momento.
        </p>
        {count > remainingToday && (
          <p>
            Restam {remainingToday} ações no limite interno de hoje. As demais ficam pausadas para você retomar depois.
          </p>
        )}
        <p>Se o Instagram indicar uma restrição, o lote será interrompido. Intervalos entre ações não eliminam o risco de bloqueio.</p>
        <div class='actions'>
          <button onClick={onCancel}>Cancelar</button>
          <button class='primary' onClick={onConfirm}>
            {words.verb} {count}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [unfollow, setUnfollow] = useState<UnfollowStatus | null>(null);
  const [syncProgress, setSyncProgress] = useState<CollectionProgress | null>(null);
  const [unfollowProgress, setUnfollowProgress] = useState<UnfollowProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>('nfb');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingRow, setConfirmingRow] = useState<{ pk: string; kind: ActionKind } | null>(null);
  const [sheetKind, setSheetKind] = useState<ActionKind | null>(null);
  const [sort, setSort] = useState<SortOrder>('recent');
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'main' | 'settings'>('main');
  const viewerRef = useRef<string | null>(null);
  const refreshGeneration = useRef(0);

  const liveViewerId = env?.collector?.viewerId ?? null;

  const refreshStatus = useCallback(async (forViewer: string | null) => {
    const [schedulerStatus, unfollowStatus] = await Promise.all([
      sendToBackground<SchedulerStatus>({ type: 'scheduler:status' }),
      sendToBackground<UnfollowStatus>({ type: 'unfollow:status', viewerId: forViewer }),
    ]);
    if (viewerRef.current !== forViewer) {
      return;
    }
    setScheduler(schedulerStatus);
    setUnfollow(unfollowStatus);
  }, []);

  const refreshAll = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const status = await sendToBackground<EnvStatus>({ type: 'env:status' });
    let viewer = status.collector?.viewerId ?? null;
    if (!viewer) {
      viewer = (await (await storePromise).listAccounts())[0]?.viewerId ?? null;
    }
    const latestData = viewer ? await loadData(viewer) : null;
    if (generation !== refreshGeneration.current) {
      return;
    }
    viewerRef.current = viewer;
    setEnv(status);
    setViewerId(viewer);
    setData(latestData);
    setLoaded(true);
    await refreshStatus(viewer);
  }, [refreshStatus]);

  const refreshData = useCallback(async () => {
    if (viewerId) {
      const latestData = await loadData(viewerId);
      if (viewerRef.current === viewerId) {
        setData(latestData);
      }
    }
  }, [viewerId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    setSelected(new Set());
    setConfirmingRow(null);
    setSheetKind(null);
    setSyncProgress(null);
    setUnfollowProgress(null);
  }, [viewerId]);

  // Whatever this panel shows has been seen: clear the toolbar badge for it, now and whenever it is shown again.
  useEffect(() => {
    if (!viewerId) {
      return;
    }
    const clear = () => {
      if (document.visibilityState === 'visible') {
        void sendToBackground({ type: 'badge:clear', viewerId });
      }
    };
    clear();
    document.addEventListener('visibilitychange', clear);
    return () => document.removeEventListener('visibilitychange', clear);
  }, [viewerId, data]);

  useEffect(() => {
    // Listen only: never return true here, or this page would swallow replies meant for the background.
    const onMessage = (message: unknown) => {
      const msg = message as Broadcast;
      switch (msg.type) {
        case 'collector:progress':
          setSyncProgress(msg.progress);
          break;
        case 'collector:finished':
          setSyncProgress(null);
          break;
        case 'sync:committed':
          if (msg.outcome.status === 'rejected') {
            setNotice(`A análise não foi salva: ${msg.outcome.detail}`);
          }
          void refreshAll();
          break;
        case 'account:changed':
          void refreshAll();
          break;
        case 'scheduler:changed':
          void refreshStatus(viewerId);
          break;
        case 'unfollow:progress':
          setUnfollowProgress(msg.progress);
          break;
        case 'unfollow:finished':
          setUnfollowProgress(null);
          break;
        case 'unfollow:changed':
          void refreshStatus(viewerId);
          void refreshData();
          break;
        default:
          break;
      }
    };
    const onTabUpdated = (_tabId: number, change: { status?: string }) => {
      if (change.status === 'complete') {
        void refreshAll();
      }
    };
    const onTabRemoved = () => void refreshAll();
    browser.runtime.onMessage.addListener(onMessage);
    browser.tabs.onUpdated.addListener(onTabUpdated);
    browser.tabs.onRemoved.addListener(onTabRemoved);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
      browser.tabs.onRemoved.removeListener(onTabRemoved);
    };
  }, [refreshAll, refreshData, refreshStatus, viewerId]);

  const job = unfollow?.job && unfollow.job.viewerId === viewerId ? unfollow.job : null;
  const busy = job?.status === 'running' || Boolean(scheduler?.running) || (syncProgress !== null && syncProgress.phase !== 'done');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), busy ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [busy]);

  const list = useMemo(() => {
    if (!data?.lists || !isListTab(tab)) {
      return [];
    }
    const source = tab === 'keep' ? Array.from(data.keep) : data.lists[TAB_LISTS[tab]];
    return sortAccounts(source, sort, data.profiles).filter(pk => matchesSearch(data.profiles.get(pk), query));
  }, [data, tab, query, sort]);

  const canAct = viewerId !== null && liveViewerId === viewerId && !busy;
  const allowance = unfollow?.allowance ?? null;
  const remainingToday = allowance?.allowed ? allowance.remaining : 0;
  const keep = data?.keep ?? new Set<string>();
  const actions = isListTab(tab) ? TAB_ACTIONS[tab] : [];
  const relationships = useMemo(
    () => ({
      followers: new Set(data?.lists?.followers),
      following: new Set(data?.lists?.following),
      requested: pendingFollowRequests(data?.actions ?? []),
    }),
    [data],
  );
  /** Whether `kind` makes sense for this account right now. */
  const applies = (kind: ActionKind, pk: string) =>
    kind === 'follow'
      ? !relationships.following.has(pk) && !relationships.requested.has(pk)
      : kind === 'unfollow'
        ? relationships.following.has(pk)
        : relationships.followers.has(pk);
  const selectedFor = (kind: ActionKind) => Array.from(selected).filter(pk => applies(kind, pk));
  const visibleSelectable = selectable(list, keep);
  const allSelected = visibleSelectable.length > 0 && visibleSelectable.every(pk => selected.has(pk));

  const switchTab = (next: Tab) => {
    setTab(next);
    setShown(PAGE_SIZE);
    setConfirmingRow(null);
    // A selection only ever applies to the list it was made in.
    setSelected(new Set());
  };

  const toggleSelected = (pk: string) =>
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(pk)) {
        next.delete(pk);
      } else {
        next.add(pk);
      }
      return next;
    });

  const toggleKeep = async (pk: string) => {
    if (!viewerId || !data) {
      return;
    }
    const kept = data.keep.has(pk);
    const response = await sendToBackground<{ ok: boolean }>({ type: 'keep:set', viewerId, pk, kept: !kept });
    if (!response.ok) {
      setNotice('Não foi possível atualizar a proteção. Atualize o painel e tente novamente.');
      return;
    }
    if (!kept) {
      setSelected(previous => new Set([...previous].filter(id => id !== pk)));
    }
    setData(previous => {
      if (!previous || previous.viewerId !== viewerId) {
        return previous;
      }
      const nextKeep = new Set(previous.keep);
      if (kept) {
        nextKeep.delete(pk);
      } else {
        nextKeep.add(pk);
      }
      return { ...previous, keep: nextKeep };
    });
  };

  const startAction = async (kind: ActionKind, pks: readonly string[]) => {
    if (!viewerId) {
      return;
    }
    setNotice(null);
    const response = await sendToBackground<UnfollowStartResponse>({ type: 'unfollow:start', viewerId, pks, kind });
    if (response.ok) {
      setSelected(new Set());
      setConfirmingRow(null);
      setSheetKind(null);
    } else {
      setSheetKind(null);
      setNotice(
        `${START_ERRORS[response.error]}${response.until ? ` Tente novamente após ${formatClock(response.until)}.` : ''}`,
      );
    }
    await refreshStatus(viewerId);
  };

  const syncNow = async () => {
    setNotice(null);
    const response = await sendToBackground<SyncStartResponse>({ type: 'sync:start' });
    if (!response.ok) {
      setNotice(
        response.error === 'budget'
          ? 'O limite de consultas de hoje foi atingido. Você poderá continuar amanhã.'
          : response.error === 'already_running'
            ? 'Já existe uma análise ou um lote em andamento.'
            : 'Abra instagram.com em uma aba e entre na sua conta para analisar.',
      );
    }
    await refreshStatus(viewerId);
  };

  const avatars = useAvatars(
    data?.viewerId ?? null,
    tab === 'changes' ? (data?.events ?? []).slice(0, 100).map(event => event.pk) : list.slice(0, shown),
  );

  const lists = data?.lists ?? null;
  const diff = data ? followerDiff(data.events, now) : { gained: 0, lost: 0 };
  const series = useMemo(() => countSeries(data?.snapshots ?? []), [data]);
  const groups: Array<Array<{ key: Tab; value: number | null; label: string; extra?: ComponentChildren }>> = lists
    ? [
        [
          { key: 'followers', value: lists.followers.length, label: 'seguidores' },
          { key: 'following', value: lists.following.length, label: 'seguindo' },
          {
            key: 'changes',
            value: null,
            label: 'saldo · 7 dias',
            extra: (
              <span class='diff'>
                <span class='plus'>+{diff.gained}</span> <span class='minus'>−{diff.lost}</span>
              </span>
            ),
          },
          {
            key: 'graph',
            value: null,
            label: 'evolução',
            extra: (
              <svg class='spark' viewBox='0 0 64 22' preserveAspectRatio='none' aria-hidden='true'>
                <path d={linePath(series.map(point => point.followers), 64, 22)} />
              </svg>
            ),
          },
        ],
        [
          { key: 'nfb', value: lists.notFollowingBack.length, label: 'não seguem de volta' },
          { key: 'fans', value: lists.fans.length, label: 'só seguem você' },
          { key: 'mutuals', value: lists.mutuals.length, label: 'mútuos' },
        ],
        [
          { key: 'keep', value: data?.keep.size ?? 0, label: 'protegidos' },
          { key: 'actions', value: data?.audit.length ?? 0, label: 'ações recentes' },
        ],
      ]
    : [];

  return (
    <div class='app'>
      <header class='top'>
        <div class='top-row'>
          <div>
            <div class='brand'>elo<span>Seu círculo, organizado.</span></div>
            {data?.username && <div class='account'>@{data.username}</div>}
          </div>
          <div class='header-buttons'>
            <button onClick={() => void syncNow()} disabled={busy || env?.problem !== null}>
              Atualizar agora
            </button>
            <button
              class='icon'
              aria-label='Configurações'
              aria-pressed={view === 'settings'}
              title='Configurações'
              onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
            >
              <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' aria-hidden='true'>
                <circle cx='12' cy='12' r='3' />
                <path d='M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' />
              </svg>
            </button>
          </div>
        </div>
        <SyncLine env={env} scheduler={scheduler} progress={syncProgress} now={now} />
        {scheduler?.running && (
          <button class='link stop-sync' onClick={() => void sendToBackground({ type: 'sync:stop' })}>Interromper análise</button>
        )}
      </header>

      {view === 'settings' && data ? (
        <SettingsView
          data={data}
          scheduler={scheduler}
          unfollow={unfollow}
          onChanged={() => void refreshAll()}
        />
      ) : (
        <>
      {groups.map((group, index) => (
        <div key={index} class={`stats stats-${group.length}`}>
          {group.map(stat => (
            <button key={stat.key} class='stat' aria-pressed={tab === stat.key} onClick={() => switchTab(stat.key)}>
              {stat.value !== null && <b>{stat.value.toLocaleString()}</b>}
              {stat.extra}
              <span>{stat.label}</span>
            </button>
          ))}
        </div>
      ))}

      {notice && <div class='notice bad'>{notice}</div>}
      {allowance && !allowance.allowed && allowance.reason === 'blocked' && (
        <div class='notice bad'>O Instagram restringiu as ações. A pausa interna termina em {formatClock(allowance.until)}. Confira também a situação da conta no Instagram.</div>
      )}
      {viewerId && liveViewerId && liveViewerId !== viewerId && (
        <div class='notice warn'>A aba do Instagram está conectada a uma conta diferente da exibida.</div>
      )}
      {job && (
        <JobBanner
          job={job}
          progress={unfollowProgress}
          failures={(data?.actions ?? [])
            .filter(action => action.at >= job.startedAt && !isDone(action.outcome) && action.outcome !== 'protected')
            .map(action => ({
              who: `@${data?.profiles.get(action.pk)?.username ?? action.pk}`,
              detail: action.detail,
            }))}
          now={now}
          onStop={() => void sendToBackground({ type: 'unfollow:stop' })}
          onResume={() => void sendToBackground<UnfollowStartResponse>({ type: 'unfollow:resume' }).then(response => {
            if (!response.ok) {
              setNotice(START_ERRORS[response.error]);
            }
          })}
          onDismiss={() => void sendToBackground({ type: 'unfollow:discard' }).then(() => refreshStatus(viewerId))}
        />
      )}

      {!loaded ? (
        <div class='empty'>Carregando…</div>
      ) : !data?.lists ? (
        <div class='empty'>
          {env?.problem === 'no_instagram_tab'
            ? 'Abra instagram.com, entre na sua conta e clique em Atualizar agora.'
            : 'Clique em Atualizar agora para criar sua primeira análise. Nenhuma conta será alterada durante a análise.'}
        </div>
      ) : tab === 'changes' ? (
        <ChangesList events={data.events} profiles={data.profiles} avatars={avatars} />
      ) : tab === 'graph' ? (
        <GraphView snapshots={data.snapshots} events={data.events} now={now} />
      ) : tab === 'actions' ? (
        <ActionHistory actions={data.audit} profiles={data.profiles} />
      ) : (
        <>
          <div class='toolbar'>
            <input
              type='checkbox'
              aria-label='Selecionar resultados, exceto protegidos'
              title='Selecionar todos os resultados filtrados, exceto protegidos'
              checked={allSelected}
              disabled={!canAct || visibleSelectable.length === 0}
              onChange={() => setSelected(allSelected ? new Set() : new Set(visibleSelectable))}
            />
            <input
              type='search'
              placeholder='Buscar nome ou @usuário'
              value={query}
              onInput={event => {
                setQuery((event.currentTarget as HTMLInputElement).value);
                setShown(PAGE_SIZE);
              }}
            />
            <select
              aria-label='Ordenar'
              value={sort}
              onChange={event => setSort((event.currentTarget as HTMLSelectElement).value as SortOrder)}
            >
              <option value='recent'>Ordem da análise</option>
              <option value='oldest'>Ordem inversa</option>
              <option value='az'>A–Z</option>
            </select>
          </div>
          {list.length === 0 ? (
            <div class='empty'>{query ? 'Nenhum resultado para esta busca.' : tab === 'nfb' ? 'Todos que você segue aparecem entre seus seguidores.' : 'Nenhuma conta nesta lista.'}</div>
          ) : (
            <ul class='list'>
              {list.slice(0, shown).map(pk => {
                const profile = data.profiles.get(pk);
                const kept = keep.has(pk);
                const lastAttempt = data.actions.find(action => action.pk === pk);
                const tag = relationships.requested.has(pk)
                  ? 'solicitação enviada'
                  : tab === 'followers' && relationships.following.has(pk)
                    ? 'mútuo'
                    : tab === 'following'
                      ? relationships.followers.has(pk) ? 'segue você' : 'não segue de volta'
                      : null;
                return (
                  <li key={pk} class={`row${kept ? ' kept' : ''}`}>
                    <input
                      type='checkbox'
                      aria-label={`Selecionar @${profile?.username ?? pk}`}
                      checked={selected.has(pk)}
                      disabled={kept || !canAct}
                      onChange={() => toggleSelected(pk)}
                    />
                    <Avatar profile={profile} picture={avatars.get(pk)} />
                    <Who pk={pk} profile={profile} />
                    {tag && <span class='status-tag'>{tag}</span>}
                    {lastAttempt && !isDone(lastAttempt.outcome) && (
                      <span class='status-tag bad' title={lastAttempt.detail ?? undefined}>
                        {lastAttempt.outcome === 'unconfirmed' ? 'Não confirmado' : 'Falhou'}
                      </span>
                    )}
                    <button
                      class='keep'
                      aria-pressed={kept}
                      title={kept ? 'Protegido: o elo não deixa de seguir nem remove esta conta' : 'Proteger contra unfollow e remoção'}
                      onClick={() => void toggleKeep(pk)}
                    >
                      {kept ? '★' : '☆'}
                    </button>
                    {confirmingRow?.pk === pk ? (
                      <span class='confirm'>
                        Confirmar?
                        <button class='danger' onClick={() => void startAction(confirmingRow.kind, [pk])}>
                          {ACTION_WORDS[confirmingRow.kind].verb}
                        </button>
                        <button onClick={() => setConfirmingRow(null)}>Cancelar</button>
                      </span>
                    ) : (
                      <span class='row-actions'>
                        {actions
                          .filter(kind => applies(kind, pk))
                          .map(kind => (
                            <button
                              key={kind}
                              disabled={!canAct || (kept && kind !== 'follow')}
                              onClick={() => setConfirmingRow({ pk, kind })}
                            >
                              {ACTION_WORDS[kind].verb}
                            </button>
                          ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > shown && (
            <button class='more' onClick={() => setShown(shown + PAGE_SIZE)}>
              Mostrar mais ({list.length - shown} restantes)
            </button>
          )}
        </>
      )}

      {selected.size > 0 && (
        <div class='selection-bar'>
          <span>
            {selected.size} selecionados · <button class='link' onClick={() => setSelected(new Set())}>limpar</button>
          </span>
          <span class='row-actions'>
            {actions
              .filter(kind => selectedFor(kind).length > 0)
              .map(kind => (
                <button key={kind} class='primary' disabled={!canAct || !allowance?.allowed} onClick={() => setSheetKind(kind)}>
                  {ACTION_WORDS[kind].verb} {selectedFor(kind).length}
                </button>
              ))}
          </span>
        </div>
      )}

        </>
      )}

      {sheetKind && (
        <ConfirmSheet
          kind={sheetKind}
          count={selectedFor(sheetKind).length}
          accounts={selectedFor(sheetKind).map(pk => data?.profiles.get(pk)?.username ?? pk)}
          remainingToday={remainingToday}
          onCancel={() => setSheetKind(null)}
          onConfirm={() => void startAction(sheetKind, selectedFor(sheetKind))}
        />
      )}

      <footer>
        <span>Dados locais · Base IgDiff / MIT · elo 0.1.1</span>
        {DIAGNOSTICS_ENABLED && (
          <button class='link' onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/diagnostics.html') })}>
            Diagnóstico
          </button>
        )}
      </footer>
    </div>
  );
}

function ActionHistory({ actions, profiles }: {
  actions: readonly ActionRecord[];
  profiles: ReadonlyMap<string, ProfileRecord>;
}) {
  if (actions.length === 0) {
    return <div class='empty'>As ações realizadas pelo elo aparecerão aqui, com data e resultado.</div>;
  }
  const outcomes: Record<ActionRecord['outcome'], string> = {
    unfollowed: 'Confirmado: deixou de seguir',
    removed: 'Confirmado: seguidor removido',
    followed: 'Confirmado: passou a seguir',
    requested: 'Solicitação enviada',
    not_found: 'Conta indisponível',
    failed: 'Ação não concluída',
    unconfirmed: 'Resultado não confirmado — confira no Instagram',
    protected: 'Protegido: nenhuma ação enviada',
  };
  return <section class='action-history' aria-label='Histórico de ações'>
    <p class='muted'>Até 300 ações recentes. A exportação JSON inclui todo o registro.</p>
    {actions.map(action => <article key={action.id} class='action-record'>
      <Who pk={action.pk} profile={profiles.get(action.pk)} />
      <span class={`status-tag ${isDone(action.outcome) ? 'ok' : action.outcome === 'protected' ? '' : 'bad'}`}>{outcomes[action.outcome]}</span>
      <time dateTime={new Date(action.at).toISOString()}>{new Date(action.at).toLocaleString('pt-BR')}</time>
      {action.detail && <p class='muted'>{action.detail}</p>}
    </article>)}
  </section>;
}

const TAB_LISTS: Record<Exclude<ListTab, 'keep'>, keyof PanelLists> = {
  followers: 'followers',
  following: 'following',
  nfb: 'notFollowingBack',
  fans: 'fans',
  mutuals: 'mutuals',
};

function GraphView({
  snapshots,
  events,
  now,
}: {
  snapshots: readonly SnapshotRecord[];
  events: readonly EventRecord[];
  now: number;
}) {
  const series = countSeries(snapshots);
  if (series.length < 2) {
    return <div class='empty'>O gráfico aparece após duas análises. As datas indicam quando os dados foram consultados.</div>;
  }
  const first = series[0]!;
  const last = series.at(-1)!;
  const day = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' });
  const net = (to: number, from: number) => `${to - from >= 0 ? '+' : '−'}${Math.abs(to - from).toLocaleString()}`;
  const month = followerDiff(events, now, 30);
  return (
    <div class='graph'>
      {(['followers', 'following'] as const).map(key => {
        const values = series.map(point => point[key]);
        return (
        <section key={key}>
          <div class='graph-head'>
            <b>{last[key].toLocaleString('pt-BR')}</b> {key === 'followers' ? 'seguidores' : 'seguindo'}
            <span class='muted'>
              {' '}
              {net(last[key], first[key])} desde {day(first.at)}
            </span>
          </div>
          <div class='chart-box'>
            <div class='scale'>
              <span>{Math.max(...values).toLocaleString()}</span>
              <span>{Math.min(...values).toLocaleString()}</span>
            </div>
            <svg class={`chart ${key}`} viewBox='0 0 300 80' preserveAspectRatio='none' aria-label={`${key === 'followers' ? 'Seguidores' : 'Seguindo'} ao longo do tempo`}>
              <path d={linePath(values, 300, 80, 4)} />
            </svg>
          </div>
          <div class='axis'>
            <span>{day(first.at)}</span>
            <span>{day(last.at)}</span>
          </div>
        </section>
        );
      })}
      <section>
        <div class='graph-head'>Últimos 30 dias</div>
        <p class='muted'>
          <span class='plus'>+{month.gained}</span> novos seguidores, <span class='minus'>−{month.lost}</span> deixaram de aparecer na lista.
        </p>
      </section>
    </div>
  );
}

function ChangesList({
  events,
  profiles,
  avatars,
}: {
  events: readonly EventRecord[];
  profiles: ReadonlyMap<string, ProfileRecord>;
  avatars: ReadonlyMap<string, string>;
}) {
  if (events.length === 0) {
    return <div class='empty'>As mudanças aparecem após a segunda análise. A data é a da detecção, não o horário exato da mudança.</div>;
  }
  const groups = groupByDay(events, ms =>
    new Date(ms).toLocaleDateString('pt-BR', { weekday: 'short', month: 'short', day: 'numeric' }),
  );
  return (
    <div class='list'>
      <p class='history-note'>As datas indicam quando a mudança foi detectada. Uma ausência sem confirmação pode ter outras causas, como conta indisponível ou consulta incompleta.</p>
      {groups.map(group => (
        <div key={group.day}>
          <div class='day'>{group.day}</div>
          {group.items.map(event => {
            const profile = profiles.get(event.pk);
            const who = profile ? `@${profile.username}` : `id ${event.pk}`;
            return (
              <div key={event.id} class='row'>
                <Avatar profile={profile} picture={avatars.get(event.pk)} />
                <div class='who'>{EVENT_TEXT[event.type](who)}</div>
                {event.verification && (
                  <span
                    class={`status-tag ${event.verification === 'confirmed' ? 'ok' : ''}`}
                    title={
                      event.verification === 'confirmed'
                        ? 'O Instagram confirmou o estado da relação na consulta'
                        : 'Sem confirmação: a conta pode estar indisponível ou a consulta pode ter falhado'
                    }
                  >
                    {event.verification === 'confirmed' ? 'confirmado' : 'não confirmado'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

render(<App />, document.getElementById('app')!);

