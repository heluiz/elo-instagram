# Comparativo de projetos para gerenciar seguidores

Pesquisa e revisão dirigida em 25/10/2026. Objetivo: analisar a própria conta, manter histórico, proteger pessoas, deixar de seguir e remover seguidores, com dados locais.

A comparação combina documentação dos autores, licenças e inspeção dirigida de código. Não é uma auditoria integral de segurança nem comprovação de funcionamento com o Instagram atual.

| Projeto | Recursos relevantes encontrados | Licença / ressalva | Decisão |
| --- | --- | --- | --- |
| [IgDiff](https://github.com/mzhao1599/igdiff) | Histórico, protegidos, unfollow, remoção, seguir de volta, IndexedDB e testes | Arquivo LICENSE MIT presente; pacote e código examinados | Base escolhida |
| [SantiagoLevii/instagram-follower-analyzer](https://github.com/SantiagoLevii/instagram-follower-analyzer) | Histórico, protegidos, exportação e unfollow; o módulo de API também contém seguir | MIT; remoção não encontrada no módulo de API examinado | Boa alternativa, exige mais implementação |
| [UIG / adrigo](https://github.com/adrigo/unfollowers-for-instagram) | Filtros, cache, comparação entre consultas e unfollow sequencial | README declara MIT; nenhum arquivo de licença encontrado na árvore consultada | Referência de interface e coleta, não usado como base |
| [UNKchr/ig-analyzer](https://github.com/UNKchr/ig-analyzer) | Histórico e análise mais extensa documentados | Licença própria source-available, não comercial, com restrições para derivados | Não incorporar código |
| [Aswinajay/ig-unfollow-manager](https://github.com/Aswinajay/ig-unfollow-manager) | README e content.js incluem remoção de seguidores | Nenhum LICENSE na raiz consultada; metadados sem licença identificada | Não incorporar código |
| [dev-ggomes/auto-unfollow-and-remove-follower4-instagram](https://github.com/dev-ggomes/auto-unfollow-and-remove-follower4-instagram) | CLI Python para unfollow e remoção, conforme README | MIT declarada; exige credenciais de Instagram no programa | Menos adequado à preferência por sessão do navegador |

## Por que a recomendação mudou

O IgDiff reúne as duas ações desejadas e parte importante da infraestrutura de histórico. A base é WXT + Preact + TypeScript, com persistência em IndexedDB. Isso permite reaproveitar funções existentes e testes, em vez de combinar três aplicações diferentes.

A tradução pt_BR original abrangia metadados da extensão. O painel ainda tinha textos em inglês; por isso, esta entrega traduz a interface principal diretamente. Mensagens técnicas originadas da base ou retornadas pelo Instagram podem permanecer em inglês.

A base é pequena e pouco validada por uso público. A existência de testes e uma licença permissiva não comprova a confiabilidade em produção.

## Problemas encontrados na revisão dirigida

### Resultado tratado como sucesso sem confirmação suficiente

Em [IgDiff/lib/actions/unfollow.ts](https://github.com/mzhao1599/igdiff/blob/2f5e3480fb7b8bf0418ecda98336b7dc0b0bbc2e/lib/actions/unfollow.ts), a rotina podia usar a resposta original da ação quando a consulta posterior não respondia. Campos de relação ausentes também podiam não impedir um resultado positivo.

No elo, um estado insuficiente passa a ser **não confirmado**. O lote para, a conta fica no histórico para revisão e não é repetida automaticamente. Essa tentativa também consome o limite interno.

### Identidade verificada no início, sem releitura por ação

O elo recebe explicitamente o ID esperado e confere a sessão antes de cada ação, inclusive em tentativas posteriores. Uma troca de conta interrompe o lote.

### Exportação incompleta

A exportação original incluía histórico e perfis, mas não a lista de protegidos nem o registro de ações. A exportação do elo inclui ambos e identifica o formato e sua versão.

### Limitações da coleta no UIG

No [src/api.ts examinado](https://github.com/adrigo/unfollowers-for-instagram/blob/0089bf6042be1306afd17e030acbc5d27a37cf7f/src/api.ts), o unfollow retorna sucesso conforme o status HTTP. A sinalização de lista truncada cobre o teto interno de páginas; não garante detectar uma interrupção silenciosa feita pelo Instagram.

## Limites que precisam ficar claros

- Rodar localmente e não pedir uma senha separada não elimina o acesso da extensão à sessão.
- As rotas são internas e podem mudar. Nenhum intervalo constitui um limite oficial ou garantia contra restrições.
- Histórico começa na primeira análise salva. Não reconstrói automaticamente eventos anteriores.
- A data da detecção não informa o horário exato da mudança.
- Contagens e listas podem divergir por indisponibilidade, desativação ou coleta incompleta; não se deve inferir bloqueio, bot ou inatividade só dessas diferenças.
- O suporte inicial entregue é para extensão no computador. Android/PWA e importação de exportações oficiais ficam para outra etapa.

## Escopo da primeira versão

Análise, histórico, protegidos, unfollow, remoção e seguir de volta; confirmação antes das ações; dados por conta; exportação CSV/JSON. Sem backend, SQL ou transmissão dos registros a um serviço do elo.

A execução real no Instagram ainda precisa de validação, conforme [VALIDACAO.md](VALIDACAO.md).
