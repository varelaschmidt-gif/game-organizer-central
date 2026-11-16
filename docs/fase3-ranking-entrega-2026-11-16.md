# RELATÓRIO PARA ATUALIZAÇÃO DO TRELLO — REI DA QUADRA

16/11/2026 — Fase 3: avaliações e ranking. Entrega autorizada: instalar e testar na cópia Supabase e criar commit. Produção, push e publicação não autorizados nesta rodada.

## Cartões e resultado

- Fase 3 — https://trello.com/c/4rjMm1HW
- T10 — Implementar placares e estatísticas — https://trello.com/c/FpOvTRuC
- I01 — Média de estrelas do jogador e regra de notas por evento — https://trello.com/c/ia3VJr9o

Resultado: função instalada e testada na cópia; ranking integrado localmente à página Jogadores e médias dos eventos. Habilitação restrita ao endereço da cópia onde a migration foi aplicada. Versão padrão de produção não chama a nova função nem mostra o ranking. Sem alterações no Trello. Recomendar Em conferência somente deste recorte; não Concluído.

## Regras definidas pelo usuário

- Ranking por média das avaliações, sem gols, assistências, placares ou vitórias. Resultados esportivos pertencem ao setor Campeonatos.
- Avaliação explícita de 1 a 5; presente elegível sem avaliação contribui com 3 somente no cálculo, distinguido de voto recebido.
- Elegível: na lista do evento, confirmado, presença marcada true, evento finalizado e mesmo grupo/quadra. Ausente, presença não registrada, espera, cancelado ou pessoa sem registro na lista não entra.
- Todas as participações elegíveis contam, sem filtro anual/mensal. Exemplo validado: duas notas 5 e duas faltas mantêm5; uma participação adicional sem nota produziria 4,33.
- Dívida aberta com saldo positivo e mais de 10 dias de atraso zera a pontuação. Exatamente 10 dias não zera ; 11 zera. Pagamento parcial não libera; dívida em outra quadra não interfere.
- Resposta explícita do usuário sobre quitação: “Zerar definitivamente e começar uma nova média”. Após regularizar, notas antigas não voltam à média. Até nova participação, permanece 0. Avaliações e financeiro antigos não são apagados.
- Administrador continua responsável pela avaliação; votação entre jogadores permanece desativada. Não foi aprovada obrigação de uma nota 1 por evento. Limite existente de apenas uma nota 5 foi preservado.

## Implementação e critérios operacionais

A consulta utiliza attendances/events/event_player_ratings e histórico append-only finance_charges/finance_ledger. Não cria notas 3 fictícias, cobranças, pagamentos ou jobs; não modifica nenhuma rotina financeira. Reconstitui os marcos de quitação tardia pelo histórico existente, inclusive quando ninguém abriu o ranking durante o atraso.

O reinício usa o horário created_at do registro financeiro, impedindo que um lançamento retroativo restaure pontos eliminados. Só eventos com starts_at a partir da última regularização entram no novo ciclo. Cancelamento tardio de cobrança ainda não paga também encerra o bloqueio sem restaurar pontos anteriores. Cancelamento de uma cobrança paga em dia não causa penalidade. Várias dívidas, estornos e nova quitação seguem a última regularização; dívida tardia ainda em aberto mantém 0.

Essas escolhas operacionais estavam na proposta apresentada para autorização e estão preservadas. Zero é exceção punitiva à escala normal1–5; quem nunca participou e nunca foi penalizado permanece sem nota/sem posição. Empates usam a média exibida com duas casas, mesma posição (dense_rank); ordenação por ID estabiliza a paginação sem desempate esportivo.

Segurança: função interna SECURITY DEFINER em ranking_internal não exposto, search_path vazio e autorização por auth.uid/is_court_member; fachada pública SECURITY INVOKER. PUBLIC/anon sem EXECUTE. Não retorna valores/vencimentos/extratos financeiros de terceiros, apenas pontuação/contagens/flags necessárias. O teste com jogador confirma ranking completo da quadra mesmo sem acesso às cobranças de outro jogador; acesso de outra quadra/grupo é negado/retorna vazio conforme a operação.

## Banco e migration

Aplicação efetiva SOMENTE em iuwgpfhvauyhxfzlxlbu, cópia de testes:

- 20261116171956_player_rating_ranking
- Cria schema ranking_internal, ranking_internal.court_player_ranking e public.get_court_player_ranking; grants restritos.
- Não substitui o antigo get_court_rating_averages nem altera tabelas/RPCs financeiras.

Arquivo criado inicialmente pelo CLI oficial 3.2.0 via migration new (versão local inicial 171928) e alinhado à versão efetivamente registrada pelo conector (171956). O gerador agora verifica a igualdade da fonte com a migration aplicada e não reescreve migrations; mudanças futuras exigem nova versão.

Contrato da nova função extraído dos tipos regenerados da cópia e incorporado ao arquivo existente de tipos sem remover/reformatar tipos financeiros. Adaptador local corrige a nulabilidade de average/rank/nickname que o metadata RETURNS TABLE não expressa.

Produção Lovable 4da725dc-7e83-464c-939d-fffde39dadf4 não recebeu migration, alteração de conexão ou escrita nesta rodada. O gate por endereço da cópia impede novas chamadas nela. Não houve push, integração em main ou deploy.

## Arquivos do commit

- supabase/migrations/20261116171956_player_rating_ranking.sql e supabase/queries/player-rating-ranking.sql: função versionada/fonte do cálculo.
- supabase/tests/player_rating_ranking_readonly.sql:26 cenários sintéticos SELECT-only.
- supabase/tests/player_rating_ranking_rpc.sql:30 asserções/rejeições com RPCs reais, papéis e fixtures revertidas.
- scripts/prepare-rating-ranking.mjs: verifica migration imutável e gera as fixtures de leitura a partir da fonte.
- src/lib/player-rating-ranking.ts e respectivo teste: tipos/adaptador, tamanho de página e habilitação apenas na cópia.
- src/components/player-rating-ranking.tsx: média, posição, participações, avaliações recebidas, padrões 3, zero/reinício e estados de erro/carregamento.
- src/components/court-player-rating-ranking.tsx: consulta paginada de 50, linha extra para detectar próxima página, nova tentativa, atualização ao focar/por intervalo de 60 segundos e reset de página ao mudar quadra.
- src/components/event-player-ratings.tsx: seção existente extraída, médias novas na cópia, fallback da média explícita em produção, mensagens de erro, autorização visual, rótulos por jogador, nota selecionada e recuperação após falha de transporte.
- src/routes/_authenticated/jogadores.tsx e events.$eventId.tsx: integração sem reescrever o financeiro ou o restante das páginas.
- src/integrations/supabase/types.ts: apenas contrato da nova RPC.
- src/test/player-rating-ranking.test.tsx, court-player-rating-ranking.test.tsx e event-player-ratings.test.tsx.
- docs/fase3-ranking-entrega-2026-11-16.md: este relatório.

## Branch, commit e preservação

Branch criada no mesmo HEAD, sem mudar arquivos: codex/fase3-avaliacoes-ranking. Base 56ce2e90844d284008b80aed8533ae9253f19c17, conteúdo financeiro já existente. Identificador final do commit: informado na resposta da rodada.

Arquivos preparados explicitamente, sem git add global. Permanecem fora do commit alterações anteriores em AGENTS, journal, package, autenticação, times, propostas Drizzle, presença, cópia Supabase, scripts de cópia/testes, baseline, lockfiles e relatórios de rodadas anteriores. Tudo preservado.

Main remoto confirmado em 8c04b16d7368f2c903d636a24dfb37dedccb1823 nesta sequência. A cópia local ainda difere das melhorias remotas em eventos/avatares/seleção de quadras. Para futura integração, aplicar apenas o diff desta entrega sobre main preservando essas melhorias; não substituir os arquivos remotos inteiros pela árvore antiga. Mensagens históricas “Fase 3” do financeiro não indicam entrega de ranking.

## Testes e evidências

| Verificação | Resultado | Evidência/limite |
|---|---|---|
| Vitest da árvore de trabalho | PASSOU |13 arquivos / 57 testes, incluindo 14 novos do ranking/avaliações |
| Snapshot isolado dos arquivos preparados para commit | PASSOU |9 arquivos / 39 testes; exclui os testes/alterações locais não commitados das rodadas anteriores |
| TypeScript | PASSOU |tsc --noEmit na árvore de trabalho e no snapshot |
| Build padrão do snapshot | PASSOU |vite build, saída 0; .ranking-commit-check.local/.ranking-snapshot-build.log |
| Build Supabase de testes do snapshot | PASSOU |modo supabase-test com endereço da cópia verificado, saída 0; .ranking-commit-check.local/.ranking-snapshot-test-build.log |
| Lint dos arquivos novos JS/TS | PASSOU |ESLint sem erros; sem formatação geral das páginas antigas |
| Cálculo SQL SELECT-only | PASSOU |26/26 cenários; empate e isolamento sintético também true |
| RPCs reais na cópia | PASSOU |30 asserções/rejeições: notas, padrão 3, ausência, limites, correção/remoção,10/11dias, parcial, quitação, reinício, estorno, papéis, RLS e outro grupo |
| Ausência de resíduos | PASSOU |Após rollback: 0 grupos/contas de fixture e 0 cobranças/ledger/avaliações na cópia |
| Interface autenticada real e sessão via API pública | NÃO EXECUTADO |Testes de componentes usam consultas simuladas; SQL usa ROLE authenticated e identidades de fixture |
| Disputa concorrente em duas conexões | NÃO EXECUTADO |Unicidade existente preservada e rejeição sequencial testada; sem alegação de concorrência real |
| Lint geral | NÃO EXECUTADO |Dívida anterior fora do escopo; não corrigida em massa |
| Produção/push/deploy | NÃO EXECUTADO |Fora da autorização desta rodada |

A primeira exportação isolada usou a conversão CRLF do Git do Windows e gerou 849 erros de lint exclusivamente de fim de linha. A exportação foi refeita com core.autocrlf=false, preservando os bytes LF do índice; lint dos novos arquivos passou nessa versão. Não foi alterada a configuração global nem feita formatação em massa.

O teste SQL inicial esperava “administrador” para outro grupo; o backend corretamente rejeitou antes com “Sem acesso a este evento”. Corrigida a expectativa, execução completa passou. Todas as fixtures estavam em transação e foram revertidas inclusive na falha. Um evento finalizado sintético com horário futuro testa apenas a fronteira após pagamento criado na mesma transação; não muda a regra produtiva de finalizar somente após o término.

Advisors após aplicação: nenhum achado específico novo de ranking_internal identificado na resposta; permanecem alertas existentes de RPCs SECURITY DEFINER públicas e configuração de proteção de senhas. Isso não constitui auditoria global. Referências: https://supabase.com/docs/guides/database/functions e https://supabase.com/docs/guides/database/postgres/row-level-security.

## Checklist reproduzido e recomendações

Fase 3 no Trello continua 1/8 informado:
- [x] Formação de times a partir dos confirmados (Editável) — fora da validação desta rodada.
- [ ] Avaliação de jogadores para equilíbrio — Validar — avaliação/ranking testados no recorte; integração ao sorteio continua fora.
- [ ] Sorteio completamente aleatório — pendente.
- [ ] Sorteio equilibrado por nível e posição — pendente.
- [ ] Troca manual de jogadores entre equipes — T09 pendente.
- [ ] Salvar escalações e histórico de times — fora deste recorte.
- [ ] Registro de placares — usuário reservou para Campeonatos.
- [ ] Estatísticas e ranking de jogadores — implementado/testado na cópia no recorte de avaliações; conferência visual, integração em main e produção pendentes.

T10: “Escopo aprovado após validação da Fase 2”, “Autorizado registra e corrige placar”, “Estatísticas sem contagem duplicada”, “Evidências registradas e aprovação explícita na Conferência do Desenvolvimento” permanecem desmarcados; este ranking não aprova placares.

I01: padrão 3 e distinção de contagens implementados/testados na cópia; responsável administrador preservado. Obrigação de um 5 e um 1 não foi definida/aplicada. Correções e isolamento foram testados; concorrência real e aprovação da Conferência continuam pendentes. Não marcar o cartão completo.

Recomendar Em conferência do ranking/avaliações com limites acima. Nenhum cartão/checklist foi alterado. Nunca recomendar Concluído sem aprovação explícita referenciada.

## Próxima tarefa e conferência

1. Entrar na cópia de testes e abrir Jogadores: ranking aparece somente nesse backend. Conferir celular/desktop, paginação, troca de quadra, vazio/erro e distinção de votos/padrões.
2. Como administrador, avaliar presentes em evento finalizado. Conferir duas notas 5 seguidas de faltas, padrão 3, correção sem duplicação e remoção passando a padrão 3. Jogador comum não edita.
3. Conferir casos de atraso 10/11 dias e reinício com pagamentos do ambiente de testes; não criar cobranças produtivas para validar.
4. Conferir que usuário de outro grupo não obtém ranking/notas, membro não vê extratos alheios e nenhum detalhe financeiro de terceiros aparece.
5. Após aprovação, receber autorização separada para envio/integração em main e aplicação em produção. Só habilitar o ranking no backend produtivo depois de aplicar/verificar a migration nele. Publicação é uma etapa separada.

## Atualização — publicação autorizada em 16/11/2026

O usuário autorizou publicar esta versão e definiu commit e publicação como padrão para futuras alterações do projeto, salvo pedido contrário. Essa orientação foi registrada em AGENTS.md. As restrições de publicação do registro histórico abaixo foram superadas para esta entrega de ranking.

Integração preparada sobre main 8c04b16d7368f2c903d636a24dfb37dedccb1823, preservando avatares, escopo de eventos, seletor de quadras e financeiro atuais. Commit de integração inicial dc55629; ativação produtiva em commit posterior desta branch codex/fase3-publicacao. Sem force push, reset ou mistura das alterações locais pendentes.

A SQL versionada do ranking foi executada em transação no Lovable de produção, sem alterar dados de jogadores, avaliações ou financeiro. Cache da API atualizado. As duas funções têm definições iguais às da cópia após normalizar CRLF. EXECUTE anônimo permanece negado, facade pública invoker e helper privado definer. Uma consulta com papel authenticated e identidade administrativa existente retornou 3 linhas acessíveis, sem pontuação fora de 0–5. Nenhuma fixture foi inserida em produção.

Habilitação agora inclui tanto a cópia Supabase como o endereço produtivo existente owneaksnqdgpilnhjzwp.supabase.co, com a mesma conexão e chaves já usadas pelo sistema. Não há troca de backend.

Validação da árvore integrada: 10 arquivos / 43 testes passaram; TypeScript e build padrão passaram. Os 30 testes reais de RPC e os 26 cenários SELECT permanecem comprovados na cópia, conforme registro abaixo. Login e interface autenticada de ponta a ponta não foram alegados como testados nesta publicação.

A confirmação do envio ao GitHub, versão reconhecida pelo Lovable e resultado da hospedagem será informada na resposta desta rodada. Este trecho registra a versão preparada para publicação; o restante é o histórico anterior da entrega em testes.

## Registro anterior — entrega na cópia de testes
