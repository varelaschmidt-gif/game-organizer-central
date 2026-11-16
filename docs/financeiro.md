# Financeiro — regras e operação

Referência: 16/11/2026. O módulo usa o modelo **finance_*** já instalado no Lovable, ligado a jogadores, quadras, grupos e eventos. A antiga proposta local `drizzle/migrations/0010_financial_module.sql`, com tabelas `financial_*`, não corresponde ao banco ativo e **não deve ser aplicada**. A referência histórica correta é `supabase/pending-migrations/0010_court_finance.sql`; também não deve ser reaplicada num ambiente inicializado.

## Ambientes e instalação

Produção: Lovable `4da725dc-7e83-464c-939d-fffde39dadf4`. Cópia independente: Supabase `iuwgpfhvauyhxfzlxlbu`. As migrations incrementais foram aplicadas e testadas somente nessa cópia:

- `supabase/migrations/20261116153918_finance_hardening_and_player_terms.sql`: condições mensais por jogador, histórico protegido, consistência de idempotência e fechamento, resumo por período.
- `supabase/migrations/20261116154235_finance_atomic_expenses_and_cancellation.sql`: despesa/rateio atômicos e cancelamento auditável.
- `supabase/migrations/20261116155840_finance_cash_initialization_and_precision.sql`: exige configuração inicial antes de movimentar caixa, protege a precisão dos centavos e completa a validação de replay da despesa.

Nenhuma migration desta entrega foi aplicada em produção. Antes da aplicação autorizada, comparar novamente as funções do Lovable para preservar mudanças posteriores. Não executar todo o histórico Drizzle nem repetir o baseline. O config.toml antigo não seleciona a cópia correta: confirmar explicitamente o projeto.

A RPC finance_get_instructions informa finance_version. A interface consulta condições individuais somente na versão 15+ e usa operação atômica/cancelamento de despesa na 16+. O banco antigo atende às operações já existentes, sem consultas às novas tabelas. As novas proteções de servidor só estarão em produção após autorização e aplicação das migrations.

## Valores e cobranças

Valores persistem em centavos inteiros. A entrada usa conversão decimal exata, rejeitando frações de centavo, formatos inválidos e valores fora da precisão segura. O servidor valida sinal, limites, saldo e elegibilidade. Cobranças têm categorias monthly, daily, expense_share e manual. Cobrança em aberto não é receita recebida.

Mensalidades: gestor define valor padrão e vencimento de 1 a 28 por quadra. Custo/capacidade são simulações e não recalculam a tarifa. Geração manual é do mês atual; a automática diária gera quando chega o vencimento efetivo. Na cópia o agendamento permanece inativo. Entram mensalistas ativos da mesma quadra/grupo, sem convidados. Condição individual substitui valor/vencimento: null usa padrão, zero isenta emissões futuras. Exige motivo e registra autor, horário e antes/depois em audit_logs. Não há pró-rata implícito. Mudanças não recalculam cobranças emitidas; chave por quadra/jogador/competência impede duplicação. Outros períodos/exceções usam cobrança manual justificada.

Diárias: valor padrão é referência; daily_fee_cents do evento precisa ser explicitamente ativado. null/zero desativa. O gestor emite a cobrança do avulso, com valor específico quando necessário. Não se cobra automaticamente todo confirmado. Preservada a regra existente: mensalistas e convidados são isentos; avulso precisa quitar a diária ativada antes de confirmar. Uma cobrança ativa por evento/jogador não duplica. O detalhe do evento consulta as instruções e o saldo da própria quadra/evento.

Pix é manual: o aplicativo mostra a chave e o responsável confere o recebimento. Não há integração bancária automática ou QR dinâmico nesta entrega.

## Pagamentos e correções

Uma cobrança aceita vários pagamentos parciais até a quitação. Recebido líquido = pagamentos menos estornos; saldo = cobrado menos recebido líquido. Parcial vencido continua em atraso. Não há política de crédito/adiantamento: acima do saldo é recusado. Registram-se data, valor, forma, observações, responsável e horário. Recebimentos futuros, anteriores ao saldo inicial ou em mês fechado são recusados.

Pagamentos não são editados/apagados. Estorno cria linha oposta vinculada ao original, com data atual e motivo; só pode ocorrer uma vez e restaura o saldo da dívida. Ajuste de caixa tem sinal e motivo; corrigir ajuste exige outro compensatório. Cancelar cobrança exige estornar seus recebimentos antes e preserva a linha. Valor/vencimento emitidos são imutáveis; correções usam cancelamento e nova cobrança com descrição justificando a origem.

## Despesas e rateios

Despesa guarda descrição, categoria, data, vencimento, valor, observações e autor. Sem pagamento é obrigação pendente, não saída de caixa. Pagamento integral registra saída; estorno restaura caixa e obrigação. Pagamentos parciais são suportados nas cobranças dos jogadores; despesas são pagas integralmente nesta versão.

Rateio é opt-in, inicialmente “Sem rateio”. Pode usar mensalistas ativos, jogadores selecionados ou confirmados marcados presentes em um evento. Exclui convidados, ausentes e outra quadra. Divisão igual usa inteiros e distribui centavos restantes numa ordem determinística; valores personalizados exigem parcela positiva por selecionado e soma exata. Parcela zero de divisão igual não gera cobrança. Cada parcela é uma cobrança com pagamentos próprios; ratear não registra receita fictícia.

Na versão 16, despesa/rateio são uma transação: falha em qualquer parte não grava nada. Replay retorna o lançamento existente; a mesma chave com dados/rateio diferentes é recusada. Cancelamento exige motivo, estorno do pagamento da despesa e dos recebimentos de parcelas e período reaberto quando necessário. Despesa e parcelas continuam no histórico como canceladas.

## Caixa, períodos e fechamento

Saldo inicial é informado na primeira configuração, com data de referência, e fica imutável no servidor. Saldo atual = inicial + movimentos reais da referência até hoje. Não são aceitos movimentos anteriores à referência. Correção do inicial é ajuste auditável, sem reescrever o passado nem contabilizar o inicial como receita.

Datas seguem America/Sao_Paulo. Receitas/despesas entram na data real do recebimento/pagamento: dívida antiga recebida hoje entra no caixa de hoje. Resumos separam saldo atual, abertura/final do período, recebimentos/despesas líquidos, ajustes, a receber, vencidos e despesas pendentes. Categorias usam movimentos reais; o snapshot de fechamento preserva a apuração histórica.

Só mês encerrado pode ser fechado. Guarda snapshot, autor e horário e bloqueia movimentos e alterações de obrigações no período. Escritas e fechamento usam a mesma trava por quadra. Reabrir exige administrador e motivo de pelo menos cinco caracteres. Refechar registra nova fotografia; audit_logs preserva as anteriores. Receber hoje cobrança antiga não exige reabertura do mês de emissão.

## Permissões e relatórios

Administrador e organizador com permissão finance gerenciam; só administrador reabre mês. Jogadores leem somente suas cobranças, condições e movimentos, além das instruções compartilhadas. Não têm escrita direta. RLS/RPCs verificam grupo e quadra no servidor; esconder controles é apenas outra camada. Livro caixa é append-only.

A interface oferece resumo geral, extrato individual, filtros aberta/parcial/paga/vencida/cancelada, inadimplentes, relatório mensal, movimentos por período/categoria e detalhamento das parcelas. CSV inclui centavos, datas e responsável quando administrativo, com proteção contra fórmulas em textos. Consultas paginam para evitar relatórios silenciosamente truncados pela API.

## Validação e limites

`supabase/tests/finance_phase3.sql` cria fixtures aleatórias e termina com rollback. Testa RPCs, centavos, parcial/quitação/excesso, estornos, rateios customizados/atômicos, duplicidade, condições individuais e geração automática, isenção, caixa, fechamento/reabertura, imutabilidade e RLS sob jogador/outro grupo. Não executar em produção.

Testes locais cobrem moeda, status, rateios, relatórios paginados/CSV e tela com backend simulado. Não substituem login real, Pix bancário ou disputa entre duas conexões simultâneas. Resultados/arquivos: `docs/financeiro-fase3-auditoria.md`.
