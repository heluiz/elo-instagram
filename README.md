# elo — Gerenciador de Instagram

**Versão 0.1.1 · experimental · licença MIT.** A extensão pronta para instalar fica em [Releases](https://github.com/heluiz/elo-instagram/releases/latest); este repositório contém o código-fonte.

Extensão para Chrome e Edge no computador, em português, baseada no [IgDiff](https://github.com/mzhao1599/igdiff), sob licença MIT. O projeto original e seus autores estão identificados em LICENSE e NOTICE.md.

## Instalar sem programar

A extensão já vem compilada no ZIP de cada [Release](https://github.com/heluiz/elo-instagram/releases/latest). Não precisa instalar Python, Node.js ou npm para usá-la.

1. Baixe `elo-instagram-0.1.1-chrome.zip` em [Releases](https://github.com/heluiz/elo-instagram/releases/latest) e extraia todo o conteúdo para uma pasta permanente.
2. No Chrome, abra `chrome://extensions`. No Edge, abra `edge://extensions`.
3. Ative **Modo do desenvolvedor** e escolha **Carregar sem compactação**.
4. Selecione a pasta onde fica o arquivo `manifest.json`.
5. Abra `https://www.instagram.com/` e entre na conta que deseja analisar.
6. Clique no ícone do elo e em **Atualizar agora**.

A extensão abre um painel lateral. Se já havia uma aba do Instagram aberta durante a instalação, recarregue essa aba. A atualização automática começa desligada.

## Atualizar uma instalação existente

Exporte os dados antes de atualizar. Extraia o conteúdo do novo ZIP sobre a mesma pasta da versão já carregada, mantendo o caminho. Em chrome://extensions ou edge://extensions, clique em **Recarregar**. Recarregue também a aba do Instagram. Evite desinstalar a extensão, pois isso pode apagar os registros locais.

## O que esta versão faz

- Analisa seguidores e seguindo, mostrando mútuos, quem não segue de volta e quem só segue você.
- Salva análises por ID da conta, mantendo histórico e gráfico.
- Mantém uma lista de **Protegidos**. A estrela impede unfollow e remoção pelo elo.
- Permite deixar de seguir, remover seguidores e seguir de volta, individualmente ou por seleção.
- Mostra os nomes selecionados antes de confirmar um lote; cancelar ou pressionar Esc não executa ações.
- Verifica o resultado das ações. Se não houver confirmação suficiente, registra **não confirmado**, interrompe o lote e pede conferência manual.
- Exibe até 300 ações recentes no painel; o registro completo fica na exportação.
- Exporta listas em CSV e histórico, protegidos e ações em JSON.

O painel não executa ações de seguir/remover apenas por analisar ou selecionar contas. Essas ações dependem de confirmação no painel.

## Limitações desta entrega

**Os 237 testes locais passaram. As ações reais não foram testadas em uma conta do Instagram.** A conferência visual e o teste completo no Chrome ficaram pendentes porque o ambiente de desenvolvimento bloqueou a abertura do navegador. O teste de interface com DOM simulado passou.

As rotas utilizadas são internas e não oficiais do Instagram. Podem mudar ou recusar pedidos. Pausas e limites internos não garantem que a conta não sofrerá restrições. A versão inicial deve ser tratada como experimental.

A data de uma mudança indica a consulta que a detectou, não o momento exato em que alguém deixou de seguir. Uma ausência sem confirmação pode ter outras causas, como conta indisponível ou coleta incompleta.

O JSON exportado é um arquivo para consulta e preservação dos registros; esta versão **não tem restauração/importação pela interface**. Não há APK, integração com o aplicativo nativo do Instagram, identificação confiável de contas inativas ou classificação de seguidores como bots.

## Dados e privacidade

Os registros ficam no navegador, no espaço da própria extensão. Não há servidor do elo, conta no elo, telemetria ou serviço de assinatura. A extensão usa sua sessão aberta para falar com o Instagram e seus serviços de imagem. Não solicita senha em uma tela própria e não exporta cookies ou tokens nos arquivos de dados.

Ao desinstalar a extensão ou apagar o perfil do navegador, você pode perder os registros locais. Exporte os dados antes. Apagar os dados de uma conta pelo painel não desfaz ações já realizadas no Instagram e não limpa os limites internos de execução.

## Para desenvolver

Veja [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ANALISE-PROJETOS.md](docs/ANALISE-PROJETOS.md) e [docs/VALIDACAO.md](docs/VALIDACAO.md).

As correções da versão 0.1.1 estão descritas em [docs/REVISAO-CODIGO.md](docs/REVISAO-CODIGO.md).

Este repositório contém o código-fonte completo; o ZIP de cada Release traz os arquivos de produção para instalação.

Não associado, patrocinado ou endossado por Instagram ou Meta.

