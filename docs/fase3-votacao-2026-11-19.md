# RELATÓRIO PARA ATUALIZAÇÃO DO TRELLO — REI DA QUADRA

19/11/2026 — Fase 3: votação guiada após Tirar times.

## Cartões e resultado

Fase 3: https://trello.com/c/4rjMm1HW; avaliações I01: https://trello.com/c/ia3VJr9o; T08/C11 como base das equipes existentes. Trello consultado somente para leitura, sem qualquer edição.

Implementado o caminho Times → Tirar times → Iniciar votação → confirmar presentes/encerrar → Craque do dia → Pereba da partida → confirmar salvamento. O componente de entrada aparece após existir formação salva com jogadores. Em eventos já encerrados, oferece Abrir votação. O evento selecionado é preservado no retorno à tela Times.

O fluxo continua administrativo, conforme o modelo existente. Não foi reativada votação entre jogadores. A instrução atual resolve a escolha de um craque com 5 e outro jogador com 1 por evento no fluxo guiado.

## Comportamento

- Antes de encerrar, o administrador confirma quem realmente compareceu. Marcação prévia de presença é preservada na seleção inicial; confirmação sem presença registrada não é presumida. Há seleção explícita de todos e aviso de que não selecionados serão marcados ausentes.
- Exige ao menos dois presentes diferentes. Espera, cancelados, jogadores fora da lista, de outra quadra/grupo ou IDs repetidos são recusados no servidor.
- A confirmação encerra o evento imediatamente, inclusive antes do término previsto. O aviso é explícito. A regra normal de finish_event permanece intacta para outros fluxos.
- Encerrar não apaga, recria ou sorteia os times. Sorteio/inclusões em equipes de evento encerrado passam a ser bloqueados também nas RPCs, usando a trava já existente do evento.
- Primeira etapa: todos aparecem com 3 estrelas; seleção do Craque do dia mostra 5. Segunda etapa muda para tema visual rosa e seleção do Pereba da partida com 1. O craque fica visível, mas não pode ser escolhido como pereba.
- Nenhuma nota é alterada entre as duas etapas. Ao confirmar, uma transação grava os dois escolhidos. Os demais presentes continuam com 3 por padrão no cálculo do ranking, sem fabricar votos explícitos.
- Refazer a votação requer confirmação antes de substituir as notas anteriores; o estado anterior é registrado em audit_logs. Presenças e avaliações são conferidas contra o snapshot antes de salvar, evitando sobrescrita silenciosa de uma lista/avaliação alterada.
- Repetir a mesma operação após resposta perdida é idempotente; escolhas iguais não duplicam avaliações/auditoria. A falha em uma escolha não deixa votação parcialmente gravada.
- Sair antes de concluir conserva avaliações salvas. O evento já encerrado não é reaberto; a interface explica isso. É possível voltar depois e concluir a votação.
- Unicidade de 1 e de 5 por evento também é protegida no banco. A edição individual legada foi preservada, com bloqueio visual da segunda nota 1 e mensagem de servidor correspondente.

## Estado anterior auditado

Base main ec567f4. A tela Times não tinha entrada de avaliação. O detalhe de evento mostrava estrelas somente em status done; finish_event só permitia encerrar após o horário de término. Os dois ambientes tinham 0 avaliações e nenhum evento com duplicação de nota 1. As três RPCs de equipes ainda permitiam alterações em evento done. O algoritmo de sorteio existente foi preservado, inclusive suas pendências históricas de equilíbrio; esta rodada não o aprova nem altera sua distribuição.

## Banco e migrations

Instaladas e verificadas na cópia Supabase iuwgpfhvauyhxfzlxlbu e depois em produção Lovable 4da725dc-7e83-464c-939d-fffde39dadf4, conforme a autorização permanente de publicar as alterações:

- 20261119140333_event_voting_workflow: índice único parcial de nota 1; reforço de set_player_rating para nota 1/presença confirmada; helpers privados e fachadas públicas start_event_voting e complete_event_voting.
- 20261119142631_closed_event_team_guard: apenas guarda de status nas três RPCs existentes de sorteio/inclusão; algoritmos, autorização e persistência restantes preservados.
- 20261119143013_event_voting_permissions: normaliza a ACL legada de set_player_rating, retirando acesso anônimo e mantendo authenticated. A função já verificava autorização no corpo, mas a produção tinha grant anônimo diferente da cópia.

Arquivos criados pelo CLI oficial e alinhados às versões efetivamente registradas na cópia. Produção recebeu SQL transacional compatível e reload do cache da API, sem fixtures. Nenhum evento produtivo foi encerrado nem recebeu voto para testar. Consulta após aplicação confirmou 0 eventos done e 0 avaliações, como antes.

Os novos métodos públicos são SECURITY INVOKER; operações privilegiadas ficam em ranking_internal com search_path vazio e checagens de usuário, grupo e administrador. Execução anônima negada. As oito definições relevantes foram comparadas entre ambientes com MD5 normalizado de CRLF e eram iguais. Não houve mudança de backend, financeiro, ranking, cron ou políticas RLS.

## Arquivos

- src/components/start-event-voting.tsx: confirmação de presença e encerramento, entrada/reabertura a partir de Times.
- src/components/event-voting-wizard.tsx: duas etapas, estrelas, temas, revisão e confirmação atômica.
- src/lib/event-voting.ts: elenco confirmado paginado, validação de escopo e snapshot ordenado.
- src/routes/_authenticated/times_.votacao.$eventId.tsx: página da mesma votação, autorização, resumo salvo e reabertura.
- src/routes/_authenticated/times.tsx: botão após formação, seleção do evento no retorno e bloqueio visual de sorteio/inclusão após encerrar.
- src/components/event-player-ratings.tsx: bloqueio visual de uma segunda nota 1.
- src/integrations/supabase/types.ts: contratos extraídos dos tipos regenerados da cópia.
- src/routeTree.gen.ts: rota gerada /times/votacao/$eventId, sob a área autenticada, sem renderizar a tela Times como pai.
- src/test/event-voting-wizard.test.tsx, start-event-voting.test.tsx e teams-voting-entry.test.tsx.
- As três migrations acima e supabase/tests/event_voting_workflow.sql.
- docs/fase3-votacao-2026-11-19.md: relatório.

Branch codex/fase3-votacao-evento, em cópia isolada .event-voting.local, sobre main ec567f4. Commit final e publicação informados na resposta da rodada. Todas as alterações anteriores das outras fases, inclusive autenticação, financeiro e trabalho local de times, permaneceram preservadas fora desta entrega. Sem reset, force push ou replay de histórico Drizzle.

## Testes

| Verificação | Resultado e evidência | Limites |
|---|---|---|
| Vitest completo | PASSOU — 13 arquivos / 57 testes, incluindo 14 novos | Componentes com dados simulados |
| SQL do novo fluxo | PASSOU — 44 asserções/rejeições em RPCs reais | Na cópia, ROLE authenticated e fixtures em transação revertida |
| Regressão SQL do ranking | PASSOU — 30 verificações reais do arquivo player_rating_ranking_rpc.sql | Na cópia, incluindo pagamentos/estornos e reinício da média |
| TypeScript | PASSOU — tsc --noEmit, saída 0 | Versão integrada atual |
| Build | PASSOU — vite build, saída 0; .event-voting-build.log | Compilação não é teste com conta real |
| Lint dos arquivos novos e componente de avaliação | PASSOU | Sem formatação em massa das páginas antigas |
| git diff --check | PASSOU | Avisos CRLF do Git não tratados como falha funcional |
| Resíduos da cópia | PASSOU — 0 contas/grupos de fixture e 0 avaliações após rollback | Nenhum dado de fixture persistido |
| Definições e ACL em produção | PASSOU — funções equivalentes, novos métodos e setter sem execução anônima | Inspeção e SQL de leitura, sem encerrar eventos reais |
| Navegador autenticado e disputa em duas conexões simultâneas | NÃO EXECUTADO | Não confundir com teste de componentes ou snapshots sequenciais |

Um teste inicial simulava o link Abrir votação como span e procurava papel de botão; o mock foi corrigido para link real e a execução final passou. Dois acessos de propriedade em validateSearch foram ajustados para o padrão de TypeScript do projeto antes da validação final.

Os testes verificam: entrada só após times formados, ausência de entrada administrativa para jogador, confirmação explícita de presença, encerramento antes do horário, times preservados, ausência/espera excluídas, uma nota 5 e uma nota 1, demais com 3, mesma pessoa impedida nas duas escolhas, confirmação antes de gravar, tentativa repetida, erro sem sucesso falso, revisão/swap atômico, snapshots desatualizados e negação a outro grupo/anônimo. A guarda de encerramento é verificada nas três RPCs de equipes.

Advisors da cópia consultados; permanecem alertas legados de RPCs definer e configurações de autenticação. O novo desenho evita novos métodos públicos definer. Isso não é auditoria global do projeto.

## Checklist e recomendação

Fase 3 continua com o estado informado no Trello, sem atualizações automáticas. Este recorte implementa o acesso à avaliação e a votação guiada; não conclui sorteio equilibrado, trocas manuais, histórico de times ou resultados esportivos. Placares/gols/assistências continuam reservados a Campeonatos por decisão do usuário.

I01 — checklist nativo segue desmarcado no quadro; estado técnico:
- Confirmar regra por evento, elegibilidade, notas permitidas e responsável: fluxo atual definido pelo pedido; administrador preservado.
- Garantir um jogador com nota 5 e um com nota 1: implementado/testado no fluxo guiado, com unicidade no banco.
- Considerar 3 para presente elegível sem avaliação: preservado e testado sem voto fictício.
- Exibir média e contagem com distinção de padrão: ranking separado existente preservado.
- Validar correções, unicidade concorrente e isolamento: correções, locks, snapshot e isolamento testados; duas conexões reais ainda não executadas.
- Aprovação na Conferência do Desenvolvimento: pendente.

Recomendar Em conferência da votação guiada, nunca Concluído sem aprovação explícita. Nenhum cartão ou checklist alterado.

## Conferência pelo usuário

1. Em Times, escolher o evento e Tirar times. Conferir a formação salva.
2. Usar Iniciar votação. Marcar apenas quem compareceu e confirmar Encerrar evento e iniciar votação. São necessários dois presentes diferentes.
3. Na etapa Craque do dia, escolher uma pessoa para 5 e continuar.
4. Na etapa Pereba da partida, escolher outra pessoa para 1. Confirmar Salvar votação; os demais ficam com 3 no cálculo.
5. Conferir o resumo, voltar aos times do mesmo evento e abrir a votação novamente. Refazer somente após revisar a confirmação de substituição.
6. Conferir o ranking em Jogadores → Ranking. Faltas não entram; as regras de inadimplência já definidas continuam iguais.
