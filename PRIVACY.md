# Privacidade — elo 0.1.1

O elo é uma adaptação local do IgDiff. Não tem servidor próprio, telemetria ou anúncios.

## O que a extensão acessa

- Sua sessão já aberta em www.instagram.com, para consultar listas e executar as ações que você confirmou.
- Identificadores, nomes de usuário, nomes de exibição, imagens e atributos retornados nas listas.
- Os serviços de imagem do Instagram/Meta, para carregar avatares.

Os cookies não são enviados a um servidor do elo. O navegador anexa a sessão às requisições ao Instagram. O código lê os valores necessários à identidade da conta e às requisições; não solicita sua senha em uma tela própria.

## O que fica salvo

Análises, perfis consultados, relações entre contas, histórico, protegidos, registros de ações e cache de imagens ficam na área da extensão no navegador. A coordenação e os limites ficam em storage.local/session.

Os arquivos JSON/CSV exportados contêm dados pessoais dos perfis. Cookies, senhas e tokens de autenticação não fazem parte do formato de exportação do aplicativo. Guarde os arquivos com o mesmo cuidado que os dados da sua conta.

## Exclusão

O painel permite apagar os dados locais de uma conta. Isso não desfaz unfollows ou remoções já realizados. Contadores internos de execução podem permanecer até sua expiração para não reiniciar os limites. Desinstalar a extensão remove o armazenamento da extensão conforme o comportamento do navegador.

## Permissões

Acesso ao domínio www.instagram.com; armazenamento local; armazenamento de histórico; alarmes para a atualização opcional. Não há permissão para ler todas as páginas que você visita.

Não associado, patrocinado ou endossado por Instagram ou Meta.

