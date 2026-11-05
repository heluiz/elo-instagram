# Validação — elo 0.1.1

## Verificações realizadas

- Instalação das dependências com npm e arquivo de versões fixadas.
- TypeScript e ESLint.
- **237 testes aprovados em 23 arquivos**, incluindo 203 testes herdados da base.
- Testes adicionais de estado desconhecido após ação, falha 429 na verificação, troca de conta, exportação de protegidos/ações, configuração manual inicial e interação com o painel.
- Na revisão 0.1.1: autorização por pedido, proteção durante o lote, reenvios, recuperação, identidade de execução, resultados atrasados/duplicados, cronologia, exclusão coordenada, prazo máximo e cancelamento HTTP. Veja REVISAO-CODIGO.md.
- Compilação de produção Chrome Manifest V3.
- Verificação do manifesto, ícones e ausência da página/ponte de diagnóstico no pacote de produção.

## Teste de interface

O teste com DOM simulado exercita: ausência de ações automáticas; proteção persistida; seleção excluindo protegidos; revisão dos nomes; Esc para cancelar; envio do unfollow apenas após confirmar; remoção com confirmação individual; lista própria de protegidos.

Os endpoints internos são simulados nos testes de lógica. Isso verifica o comportamento do código diante das respostas previstas e das falhas testadas, sem afirmar que o Instagram mantém essas respostas.

## O que ficou pendente

A tentativa de abrir um Chromium de testes foi bloqueada pelo ambiente antes da abertura da janela, com falha de socket. Assim, **não foi concluído o teste com a extensão instalada no navegador nem a conferência visual**. O script scripts/test-ui.mjs permanece como teste adicional para uma máquina compatível; não foi contado entre os testes aprovados.

Não houve autenticação nem ação na conta real do usuário. Unfollow, remoção, seguir de volta, imagens de perfil, funcionamento real no Chrome/Edge e layout final ainda precisam ser conferidos na instalação local.

Esta entrega revisada continua experimental, sem certificação ou validação pela Meta.
