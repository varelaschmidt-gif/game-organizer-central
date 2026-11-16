# RELATÓRIO PARA ATUALIZAÇÃO DO TRELLO — REI DA QUADRA

16/11/2026 — Fase 3, organização da área de jogadores.

Cartão: [Fase 3](https://trello.com/c/4rjMm1HW); recorte de interface do [T10](https://trello.com/c/FpOvTRuC). Trello não alterado.

## Resultado

O ranking foi retirado da lista principal de jogadores. Um botão Ranking abre /jogadores/ranking, página própria dentro da área Jogadores, com nome da quadra, tabela de médias, paginação e ação Voltar para jogadores. A tela de cadastro/gestão fica sem a tabela de ranking. O novo caminho usa o mesmo AppShell e a proteção de autenticação, sem renderizar a listagem administrativa como página pai.

Sem alteração do cálculo, avaliações, permissões de banco, financeiro ou dados. Nenhuma migration necessária.

## Arquivos

- src/routes/_authenticated/jogadores.tsx: troca da tabela pelo botão no cabeçalho; controles administrativos preservados.
- src/routes/_authenticated/jogadores_.ranking.tsx: página independente com estados de carregamento/erro/quadra não selecionada, retorno e componente de ranking existente.
- src/routeTree.gen.ts: gerado automaticamente, registra /jogadores/ranking como filho da área autenticada.
- docs/fase3-ranking-pagina-2026-11-16.md: relatório.

Base atual: edf4b7f, principal consultada antes de editar. Branch: codex/fase3-pagina-ranking, cópia isolada. Commit final e publicação informados na resposta desta rodada. Alterações locais de outras fases foram preservadas e ficaram fora da entrega.

## Verificações

- PASSOU: 10 arquivos / 43 testes existentes do projeto.
- PASSOU: build de produção, log .ranking-page-build.log.
- PASSOU: TypeScript sem emissão.
- PASSOU: lint da página nova e git diff --check.
- PASSOU: rota gerada com fullPath /jogadores/ranking e pai _authenticated; lista de jogadores não contém mais o componente de ranking.
- NÃO EXECUTADO: navegação autenticada com conta real em navegador. Não confundir compilação/testes simulados com essa verificação.
- Banco/RPC/RLS não alterados; testes mutáveis remotos não necessários para mover a interface.

## Conferência recomendada

1. Abrir Jogadores: somente lista, filtros, ações e botão Ranking; nenhuma tabela de médias nessa tela.
2. Clicar Ranking: abrir /jogadores/ranking, conferir quadra e médias na área separada.
3. Usar Voltar para jogadores e o menu Jogadores; conferir navegação em celular e computador.
4. Trocar a quadra e conferir carregamento/paginação da tabela existente.

Recomendar Em conferência deste ajuste visual, sem marcar Concluído nem modificar os checklists gerais da Fase 3. O checklist anterior de funcionalidades não muda por esta reorganização. Publicação segue a autorização permanente dada pelo usuário em 16/11/2026.
