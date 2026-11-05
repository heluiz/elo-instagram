/* global process, console, URL, document, window */
/** Integration test: real packaged extension, disposable profile, fake network only. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'elo-ui-'));
const evidence = process.env.ELO_TEST_OUTPUT ? resolve(process.env.ELO_TEST_OUTPUT) : null;
const checks = [];
let context;
try {
  await build({ entryPoints: [join(root, 'lib/testing/fake-instagram.ts')], outfile: join(scratch, 'fake.mjs'), bundle: true, platform: 'node', format: 'esm' });
  const { createFakeInstagram } = await import(pathToFileURL(join(scratch, 'fake.mjs')).href);
  const fake = createFakeInstagram({
    following: [{ pk: '1', username: 'ana.dev' }, { pk: '2', username: 'bruno.ti' }, { pk: '3', username: 'carla.lab' }],
    followers: [{ pk: '1', username: 'ana.dev' }, { pk: '4', username: 'davi.lab' }],
  });
  const extension = join(root, '.output/chrome-mv3');
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    headless: true,
    channel: process.env.ELO_CHROME_EXECUTABLE ? undefined : 'chromium',
    ignoreDefaultArgs: ['--disable-extensions'],
    executablePath: process.env.ELO_CHROME_EXECUTABLE || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'],
    viewport: { width: 420, height: 900 },
    locale: 'pt-BR',
    colorScheme: 'light',
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'chrome-extension:') {return route.continue();}
    if (url.origin !== 'https://www.instagram.com') {return route.abort();}
    if (url.pathname.startsWith('/api/')) {
      const response = await fake.client.fetch(url.href, {
        method: request.method(), headers: request.headers(), body: request.postData() ?? undefined,
      });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Instagram simulado</title></head><body><script type="application/json">["DTSGInitialData",[],{"token":"dtsg-current"}],["SprinkleConfig",[],{"param_name":"jazoest","version":2,"should_randomize":false}]</script><p>Somente dados fictícios.</p></body></html>' });
  });
  await context.addCookies([
    { name: 'ds_user_id', value: fake.viewerId, url: 'https://www.instagram.com/' },
    { name: 'csrftoken', value: 'csrf-test', url: 'https://www.instagram.com/' },
  ]);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).hostname;
  const instagram = await context.newPage();
  await instagram.goto('https://www.instagram.com/');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Atualizar agora', exact: true }).waitFor();
  // The content script offers to auto-sync after 10 seconds. A new installation must decline it.
  await panel.waitForTimeout(11000);
  assert.equal(fake.requests.length, 0, 'a instalação não deve analisar automaticamente');
  checks.push('Sincronização automática desligada, inclusive após o sinal do content script');
  await panel.getByRole('button', { name: 'Atualizar agora', exact: true }).click();
  const row = name => panel.locator('.row').filter({ has: panel.getByText(`@${name}`, { exact: true }) });
  await row('bruno.ti').waitFor({ timeout: 20000 });
  assert.equal(await panel.locator('.row').count(), 2);
  checks.push('Primeira análise manual atualiza o painel sem recarregar');
  await row('bruno.ti').getByRole('button', { name: 'Proteger contra unfollow e remoção', exact: true }).click();
  await row('bruno.ti').locator('button.keep[aria-pressed="true"]').waitFor();
  await panel.getByRole('checkbox', { name: 'Selecionar resultados, exceto protegidos', exact: true }).check();
  assert.equal(await row('bruno.ti').getByRole('checkbox').isChecked(), false);
  await panel.locator('.selection-bar').getByRole('button', { name: 'Deixar de seguir 1', exact: true }).click();
  let dialog = panel.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByText('@carla.lab', { exact: true }).count(), 1);
  assert.equal(await dialog.getByText('@bruno.ti', { exact: true }).count(), 0);
  assert.deepEqual(fake.unfollowed, []);
  await panel.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(fake.unfollowed, []);
  checks.push('Protegidos excluídos da seleção; revisão mostra os nomes; Escape cancela sem alterações');
  await panel.locator('.selection-bar').getByRole('button', { name: 'Deixar de seguir 1', exact: true }).click();
  dialog = panel.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Deixar de seguir 1', exact: true }).click();
  await row('carla.lab').waitFor({ state: 'hidden', timeout: 10000 });
  assert.deepEqual(fake.unfollowed, ['3']);
  checks.push('Unfollow confirmado por nova consulta; lista atualiza');
  await panel.getByRole('button', { name: /^1\s*protegidos$/ }).click();
  await row('bruno.ti').waitFor();
  assert.equal(await panel.locator('.row').count(), 1);
  checks.push('Lista própria de protegidos');
  await panel.getByRole('button', { name: /^2\s*seguidores$/ }).click();
  await row('davi.lab').getByRole('button', { name: 'Remover seguidor', exact: true }).click();
  assert.deepEqual(fake.removedFollowers, []);
  await row('davi.lab').locator('.confirm').getByRole('button', { name: 'Remover seguidor', exact: true }).click();
  await row('davi.lab').waitFor({ state: 'hidden', timeout: 10000 });
  assert.deepEqual(fake.removedFollowers, ['4']);
  checks.push('Remoção de seguidor exige confirmação e verifica resultado');
  await panel.getByRole('button', { name: /ações recentes/ }).click();
  await panel.locator('.action-record').nth(1).waitFor();
  assert.match(await panel.locator('.action-history').innerText(), /Confirmado: seguidor removido/);
  assert.match(await panel.locator('.action-history').innerText(), /Confirmado: deixou de seguir/);
  checks.push('Histórico de ações inclui unfollow e remoção');
  await panel.getByRole('button', { name: 'Configurações', exact: true }).click();
  const pendingDownload = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Exportar histórico e protegidos (JSON)', exact: true }).click();
  const download = await pendingDownload;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.keep[0].pk, '2');
  assert.equal(exported.actions.length, 2);
  assert.doesNotMatch(JSON.stringify(exported), /csrftoken|sessionid|dtsg-current/);
  checks.push('Exportação contém ações e protegidos sem cookies ou tokens');
  await panel.getByRole('button', { name: 'Configurações', exact: true }).click();
  for (const width of [360, 420, 800]) {
    await panel.setViewportSize({ width, height: 900 });
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow em ${width}px`);
  }
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await panel.setViewportSize({ width: 420, height: 900 });
    await panel.screenshot({ path: join(evidence, 'elo-light.png'), fullPage: true });
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.screenshot({ path: join(evidence, 'elo-dark.png'), fullPage: true });
  }
  checks.push('Layout sem rolagem horizontal em 360, 420 e 800px');
  assert.deepEqual(errors, []);
  checks.push('Nenhum erro JavaScript nas páginas');
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  if (evidence) {await writeFile(join(evidence, 'ui-results.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));}
} finally {
  await context?.close();
  await rm(scratch, { recursive: true, force: true });
}
