# Desenvolvimento do elo

## Ambiente

Node.js 22.12 ou superior e npm. As dependências diretas estão fixadas no package.json e as transitivas no package-lock.json.

```sh
npm ci
npm run check
```

`npm ci` gera os tipos WXT pelo postinstall. `npm run check` verifica TypeScript, ESLint, testes e compilação de produção. A extensão compilada aparece em `.output/chrome-mv3`.

Use `npm run build:dev` apenas para diagnosticar: esse modo inclui uma página e uma ponte de desenvolvimento que não devem ser distribuídas como versão de produção.

## Organização

- `entrypoints/sidepanel`: interface em português.
- `entrypoints/background.ts`: coordenação, filas, limites e persistência.
- `entrypoints/instagram.content.ts`: comunicação com o Instagram na sessão aberta.
- `lib/instagram`: adaptação das respostas e requisições internas.
- `lib/collector`: coleta, paginação e conferência das listas.
- `lib/tracker`: histórico em IndexedDB, diferenças e exportação.
- `lib/actions`: ações escolhidas pelo usuário e confirmação dos resultados.
- `lib/panel`: cálculos da interface e testes de interação.
- `lib/testing`: Instagram simulado, usado somente em testes.
- `docs`: análise das bases, validação e proveniência.

## Testes

`npm test` executa os testes unitários, de persistência e de interface com DOM simulado. Não usa credenciais reais.

O teste de navegador em `scripts/test-ui.mjs` é uma verificação adicional da extensão instalada em um perfil descartável e com a rede do Instagram simulada. Foi preparado, mas **não passou pela inicialização do navegador neste ambiente**; não é evidência de compatibilidade real.

Para executar esse teste em uma máquina que permita iniciar Chromium:

```sh
npx playwright install chromium
npm run build
npm run test:ui
```

Opcionalmente, defina `ELO_CHROME_EXECUTABLE` com o caminho de um Chrome/Chromium de testes compatível com carregamento de extensões sem compactação. A versão atual de navegadores pode restringir esse recurso. O script não utiliza nem deve receber seu perfil pessoal.

## Próxima validação

1. Instalar o pacote de produção no Chrome/Edge e verificar layout claro/escuro.
2. Conferir os totais e algumas relações antes de executar ações.
3. Em uma conta própria destinada a testes, validar uma ação por vez e confirmar o resultado diretamente no Instagram.
4. Validar pausa, retomada, troca de conta e recarga da aba.
5. Só então avaliar a execução de lotes.

## Proveniência

Base IgDiff em `2f5e3480fb7b8bf0418ecda98336b7dc0b0bbc2e`. O pacote é uma adaptação local; nenhum fork ou repositório foi publicado em sua conta do GitHub nesta entrega. Preserve os avisos MIT ao redistribuir.

