# Revisão de código — elo 0.1.1

Data: 26/10/2026. Base revisada: o pacote 0.1.0 entregue anteriormente, conferido byte a byte com seu código-fonte. A revisão abrange ações, mensagens entre contextos, coleta, histórico, armazenamento e interface. Os problemas abaixo foram corrigidos nesta entrega.

## Achados e correções

| Prioridade | Problema na versão 0.1.0 | Correção | Arquivos principais |
| --- | --- | --- | --- |
| Alta | A proteção só era consultada ao montar/retomar a fila. Marcar uma pessoa enquanto o lote aguardava não retirava o pedido já enfileirado. | Autorizar novamente antes de cada POST, depois de carregar os tokens; consultar a proteção atual e vincular a autorização à execução, aba e alvo. | entrypoints/background.ts; lib/actions/unfollow.ts; lib/instagram/api.ts |
| Alta | Uma alteração aplicada cuja resposta se perdia podia ser enviada outra vez. A renovação após HTML também repetia sem conferir a relação. | Consultar o estado antes de repetir. Estado confirmado encerra o item; estado desconhecido interrompe o lote e exige conferência manual. | lib/actions/unfollow.ts; lib/actions/review.test.ts |
| Alta | Resultados de coleta antigos podiam ser aceitos sem correspondência com a execução/aba/conta atual, inclusive depois de apagar os dados. | Exigir correspondência da execução autorizada e rejeitar resultados antigos/duplicados. A exclusão cancela a execução e invalida sua autorização antes de apagar. | entrypoints/background.ts; lib/tracker/store.ts |
| Média | Deixar de seguir e depois seguir novamente a mesma pessoa deixava o painel com um estado incorreto. | Aplicar ações confirmadas em ordem cronológica, com desempate pelo ID do registro. | lib/panel/view.ts |
| Média | Uma execução persistida como em andamento podia ficar presa após reiniciar o navegador/worker. O aviso atrasado de aba pronta também interrompia trabalhos iniciados nos primeiros segundos. | Conferir a execução efetivamente presente na aba; pausar apenas execuções desaparecidas e preservar trabalhos ativos. Cada retomada ganha uma identidade nova. | entrypoints/background.ts; entrypoints/instagram.content.ts |
| Média | Mensagens individuais perdidas ou duplicadas podiam perder registros ou duplicar contadores. | Reconciliar resultados finais e tornar a aplicação dos eventos idempotente. Recusar mensagens de outra execução, aba ou alvo. | entrypoints/background.ts |
| Média | O limite interno e as pausas dependiam principalmente de sucessos; recusas podiam continuar sem o mesmo controle. | Reservar a cota antes do envio e interromper o lote em falhas explícitas. O limite conta pedidos de alteração, inclusive tentativas que falham. | entrypoints/background.ts; lib/actions/unfollow.ts |
| Média | Pedidos de rede não tinham prazo máximo próprio e a interrupção não era propagada à espera HTTP. | Prazo de 30 segundos para pedidos/respostas da API e propagação do sinal de cancelamento. | lib/instagram/api.ts; lib/collector/collect.ts; entrypoints/instagram.content.ts |
| Média | O carregador de imagens aceitava qualquer endereço HTTPS, embora o aplicativo descrevesse comunicação com os serviços do Instagram. | Limitar avatares aos domínios cdninstagram.com/fbcdn.net, sem credenciais na URL, portas alternativas ou redirecionamentos; restringir tipos de imagem. | lib/avatars.ts |

Também foram limpas seleções e confirmações ao trocar a conta exibida, impedidas respostas antigas de atualizar o contexto novo do painel e serializadas alterações de preferências/proteções com os trabalhos do coordenador.

## Como os problemas foram verificados

Antes das correções, novos testes reproduziram a proteção ignorada, o estado incorreto após seguir novamente, a continuidade após uma recusa explícita, os reenvios após perda de resposta e as interrupções causadas pelo sinal de aba pronta. Esses testes passaram depois das correções.

Foram acrescentados testes do coordenador real com APIs do navegador simuladas, cobrindo autorizações, remetentes, reserva de cota, duplicatas, eventos finais fora de ordem, retomada, troca de contexto e exclusão seguida de resultado atrasado. Testes adicionais cobrem troca de sessão durante a coleta, resultados antigos, prazo máximo e cancelamento da rede.

Resultado da revisão: **237 testes aprovados em 23 arquivos**, além de TypeScript, ESLint, compilação de produção e conferência do pacote. A versão anterior tinha 214 testes.

## Limitações que continuam

- A extensão compilada ainda precisa de conferência visual no Chrome/Edge. A tentativa anterior de abrir Chromium foi bloqueada pelo ambiente; os testes com DOM simulado não substituem essa conferência.
- As ações e as respostas atuais do Instagram precisam ser validadas em uma conta própria destinada a testes. A revisão não utilizou credenciais nem executou ações na conta do usuário.
- As rotas são internas e não oficiais. Limites e intervalos do aplicativo não garantem ausência de restrições pela plataforma.
- Uma proteção ou interrupção não desfaz um pedido que já saiu para o Instagram. A proteção nova é conferida antes do próximo envio.
- O JSON exportado ainda não possui restauração pela interface. Android/PWA continuam fora desta entrega.

## Atualização

Para preservar a identidade e os dados da extensão já instalada, copie os arquivos novos para a mesma pasta carregada no navegador e use Recarregar. Exporte seus registros antes. Evite desinstalar e carregar a extensão de outro caminho.
