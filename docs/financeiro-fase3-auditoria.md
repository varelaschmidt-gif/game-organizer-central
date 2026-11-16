# Fase 3 — auditoria e entrega do financeiro

Data: 16/11/2026, Brasília. Pedido: auditar/completar o sistema financeiro e criar commit com mensagem `Fase 3`. O usuário denominou esta entrega Fase 3; isso não altera o cartão anterior de sorteio nem representa aprovação dos itens do Trello. Quadro permanece somente leitura.

## Estado encontrado

Branch local `codex/court-link`, HEAD inicial `86b5b97`, com trabalho anterior não commitado. Remoto main consultado pelo conector GitHub em `4eddd5ebf0459101131275bdc11959722f312a1a`. Sem merge, rebase ou push.

O banco real e o remoto já tinham finance_settings, finance_charges, finance_expenses, finance_ledger, finance_month_closings e finance_charge_balances, com RPCs finance_*. A página local e a migration Drizzle 0010 ainda apontavam para a proposta financial_*, que não estava instalada. Essa divergência impedia a integração correta. A documentação local dizia incorretamente que a estrutura financeira ainda não fora aplicada.

A página remota, helpers e referência SQL instalada foram reaproveitados. As versões locais anteriores da página, tipos, detalhe de evento e documento financeiro foram preservadas em arquivos `.local` ignorados pelo Git. A proposta Drizzle antiga e seu journal não foram apagados, aplicados ou incluídos no commit desta entrega.

## Esquema apresentado antes da aplicação

Foi informado ao usuário que seria necessária uma tabela de condições mensais individuais e a revisão das funções existentes, sem recriar tabelas financeiras. Depois, identificada a operação não atômica de despesa/rateio, foi apresentada a necessidade de três campos opcionais de cancelamento de despesa.

Aplicação efetiva **somente na cópia de testes** Supabase `iuwgpfhvauyhxfzlxlbu`:

| Migration | Mudanças |
|---|---|
| 20261116153918_finance_hardening_and_player_terms | finance_player_terms com RLS e escrita por RPC; condições individuais; saldo inicial imutável; obrigações/histórico protegidos; idempotência confere dados do replay; trava comum por quadra entre escritas e fechamento; resumo com início/final/pêndencias |
| 20261116154235_finance_atomic_expenses_and_cancellation | cancelled_at/cancelled_by/cancel_reason em finance_expenses; despesa+rateio na mesma transação; cancelamento auditável de despesa/parcelas; proteção contra pagamento de despesa cancelada |
| 20261116155840_finance_cash_initialization_and_precision | exige configuração inicial antes de movimentos; impede valores/saldos fora da precisão segura dos centavos; completa comparação da data de pagamento no replay de criação de despesa |

As migrations não apagam dados, não recriam o banco e não alteram a conexão. O registro de migrations da cópia confirma essas três versões. A referência 0010 já aplicada no Lovable foi apenas recuperada no repositório local, não executada novamente.

Produção Lovable `4da725dc-7e83-464c-939d-fffde39dadf4` permaneceu somente leitura. Consulta posterior confirmou que finance_player_terms e os campos de cancelamento ainda não existem nela. **Aplicação em produção e publicação continuam pendentes de autorização.** As capacidades anunciadas pelo backend protegem a interface contra chamadas às novas estruturas antes dessa aplicação.

## Atendimento ao pedido

| Área | Implementação/reaproveitamento e regra |
|---|---|
| Categorias | Mensalidade, diária, parcela de despesa e cobrança manual separadas de pagamento, estorno, saída efetiva e ajuste |
| Mensalidades | Valor/vencimento por quadra e substituições individuais auditadas; valor zero isenta futuras emissões; geração manual/automática; unicidade por jogador/competência; tarifa emitida preservada |
| Diárias | Opt-in por evento; emissão explícita pelo gestor; valor específico permitido; unicidade da cobrança ativa; sem cobrar todos os confirmados; mantida a regra existente de prepagamento para avulsos em evento com diária ativada |
| Pagamentos | Vários parciais por cobrança, quitação e saldo líquido; sem crédito implícito; excesso/zero/futuro recusados; responsável/data/forma/observação; jogador não altera registros administrativos |
| Despesas/rateios | Cadastro completo, vencimento antes ausente na tela, pagamento integral de despesa; rateio opcional entre mensalistas/selecionados/presentes elegíveis; divisão igual com centavos ou customizada exata; parcelas e saldos exibidos; gravação atômica e cancelamento sem exclusão |
| Caixa | Saldo inicial separado e imutável; só dinheiro real movimenta saldo; a receber inclui vencidos; vencidos destacados; despesas pendentes separadas; abertura/final do mês, ajustes e categorias reais |
| Fechamento | Mês encerrado, snapshot com responsáveis/horários; bloqueio de movimentações/obrigações; reabertura administrativa com motivo; refechamento mantém auditoria; recebimento de dívida antiga na data real |
| Histórico/acesso | Ledger append-only, estornos vinculados e únicos, cancelamentos preservados, RLS e RPCs; administrador/financeiro gerenciam, jogador lê apenas o próprio extrato |
| Relatórios | Resumo, extrato por jogador e pessoal, inadimplentes, filtros de vencidas/parciais/canceladas, relatório mensal, movimentos por período/categoria, parcelas, CSV com proteção de textos contra fórmulas |
| Precisão/duplicidade | Conversão decimal exata para centavos; validação no servidor; paginação de relatórios para evitar corte silencioso; idempotência por requisição e trava por quadra |

Regras detalhadas, datas e operação estão em `docs/financeiro.md`. Não foi acrescentada regra de pró-rata, adiantamento, crédito, juros ou confirmação bancária. Despesa é paga integralmente; pagamentos parciais se aplicam às cobranças dos jogadores. Correção de ajuste usa lançamento compensatório, sem apagar o original.

## Arquivos do commit

- `src/routes/_authenticated/financeiro.tsx`: módulo integrado ao schema ativo, formulários, extratos, filtros, pagamentos, despesas, rateios, fechamento, configuração e proteção de requisições repetidas.
- `src/routes/_authenticated/events.$eventId.tsx`: integração da diária com finance_charge_balances/instruções reais, removendo chamadas à proposta de schema inexistente.
- `src/components/finance-player-terms.tsx`, `src/components/finance-reports.tsx`: condições individuais e relatórios/CSV.
- `src/lib/finance-client.ts`: fronteira tipada de RPCs/retornos, incluindo compatibilidade com argumentos SQL nullable.
- `src/lib/finance.ts`, `src/lib/finance.test.ts`: helpers monetários locais existentes reaproveitados e seus testes.
- `src/lib/finance-view.ts`, `src/lib/finance-view.test.ts`: helpers remotos de visualização reaproveitados, com status parcial explícito.
- `src/lib/finance-report.ts`, `src/lib/finance-report.test.ts`: moeda exata, paginação sem truncamento e CSV seguro.
- `src/test/finance-page.test.tsx`: controles administrativos, validação de valores, envio único e erro real de servidor.
- `src/components/AppShell.tsx`, `src/routeTree.gen.ts`: navegação/rota financeira preexistentes no trabalho local incorporadas à entrega.
- `src/integrations/supabase/types.ts`: tipos regenerados a partir da cópia atual e formatados; o diff também contém formatação do arquivo gerado.
- `supabase/migrations/20261116153918_finance_hardening_and_player_terms.sql`, `20261116154235_finance_atomic_expenses_and_cancellation.sql`, `20261116155840_finance_cash_initialization_and_precision.sql`.
- `supabase/pending-migrations/0010_court_finance.sql`: referência histórica do remoto, já instalada; não reaplicar.
- `supabase/tests/finance_phase3.sql`: testes reais das RPCs e políticas em transação com rollback.
- `docs/financeiro.md` e este relatório.

Fora do commit permanecem alterações anteriores em autenticação, AGENTS.md, package.json, scripts de cópia/testes, proposta Drizzle, presenças, formação de times e outros arquivos locais. Não foram descartadas nem misturadas ao commit financeiro. A mensagem solicitada é `Fase 3`; o identificador final é informado na resposta da rodada.

## Testes e evidências desta rodada

| Verificação | Resultado | Evidência/limite |
|---|---|---|
| Vitest | PASSOU — 9 arquivos / 38 testes | `node node_modules/vitest/vitest.mjs run`; inclui 4 testes da tela, 4 de relatório, moeda/status/rateio e regressões existentes; consultas da tela simuladas |
| Snapshot exato dos arquivos preparados para commit | PASSOU — 5 arquivos / 25 testes | Árvore preparada exportada com git archive para cópia isolada; não contém as alterações locais anteriores excluídas do commit. TypeScript e build também verificados nessa cópia; dependências instaladas existentes são compartilhadas |
| SQL do financeiro | PASSOU — 55 asserções/rejeições esperadas | `supabase/tests/finance_phase3.sql` na cópia; retorno PASSOU; RPCs reais, ROLE authenticated e identidades descartáveis para RLS; inclui parcial, quitação, estorno, duplicidade, centavos, rateio customizado/atômico, cancelamento, geração individual/automática/isenta, caixa, fechamento/reabertura e precisão |
| TypeScript | PASSOU | `node node_modules/typescript/bin/tsc --noEmit` |
| Build padrão | PASSOU | `node node_modules/vite/bin/vite.js build`; `.finance-production-build.log`; compilação não publica |
| Build da cópia Supabase | PASSOU | `node scripts/supabase-test.mjs build`; `.finance-build.log`; script/configuração de testes já presentes na árvore local, fora do commit financeiro |
| Lint do módulo financeiro/tipos | PASSOU | ESLint nos helpers, componentes, página, teste e tipos financeiros; sem erros |
| Lint geral | FALHOU | 7.512 erros e 12 avisos, sobretudo formatação/CRLF e código antigo fora do módulo; log `.finance-global-lint.log`. Não houve correção geral automática |
| Resíduos de testes | PASSOU | Consulta após rollback: zero configurações, despesas, cobranças, ledger e condições financeiras; zero grupos com nome de fixture; cron financeiro continua inativo na cópia |
| Produção | NÃO EXECUTADO para escrita/migrations/testes mutáveis | Apenas inspeção; novos campos/tabela ausentes, conforme esperado |
| Login real/interface autenticada e Pix bancário | NÃO EXECUTADO | Testes de tela usam dados simulados; autenticação de ponta a ponta e pagamento bancário não foram alegados |
| Disputa em duas conexões simultâneas | NÃO EXECUTADO | Locks/unicidade implementados e replay sequencial testado; sem alegação de teste concorrente real |

As verificações SQL criaram contas/grupos/jogadores apenas dentro de transação revertida. Nenhuma fixture permanece na cópia; não foram alterados dados produtivos.

## Segurança e pendências de aprovação

Advisors da cópia: sem erro de RLS ausente identificado na rodada; permanecem avisos sobre RPCs SECURITY DEFINER expostas a papéis previstos pelo modelo e proteção de senhas vazadas desativada. Cada nova RPC verifica o gestor/grupo e revoga acesso anônimo; a exposição autenticada é intencional para o funcionamento da API e foi testada com jogador/outro grupo. Isso não é uma auditoria global de todas as RPCs do projeto.

Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [RPCs SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Pendências: autorizar aplicação das três migrations em produção, validar a interface com contas reais na cópia, realizar disputa concorrente em duas conexões e aprovar funcionalmente a entrega. Pix automático/QR bancário, juros, crédito/adiantamento ou pró-rata exigem decisões adicionais se forem desejados. Não impedem o funcionamento das regras explicitamente entregues.

Nenhum push, deploy, alteração no Trello ou autorização implícita de produção. O código foi preparado para revisão e commit local, preservando o backend integrado existente.

## Atualização — integração solicitada ao projeto principal

Após a rodada acima, o usuário autorizou enviar a implementação pelo GitHub para a branch principal conectada ao Lovable. A integração foi preparada sobre main 4eddd5ebf0459101131275bdc11959722f312a1a, em codex/fase3-lovable, por cherry-pick do recorte 56ce2e9 com resolução explícita de conflitos. Foram preservados navegação, seletor de quadras, avatares, notificações, escopo de eventos e as alterações de times já presentes no remoto. Nenhuma tabela, view ou função dos tipos atuais foi removida.

Validação dessa árvore integrada: 6 arquivos / 29 testes PASSARAM; TypeScript e build PASSARAM. O commit mantém a mensagem Fase 3. O envio à main é uma atualização normal, sem force push ou reescrita de histórico. Produção continua sem execução das migrations financeiras e sem publicação do site. O identificador do commit integrado e a confirmação de sincronização no Lovable são informados na resposta desta rodada.
