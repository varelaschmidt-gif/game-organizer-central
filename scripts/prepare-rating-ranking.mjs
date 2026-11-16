import { readFileSync, writeFileSync } from "node:fs";

const query = readFileSync(
  new URL("../supabase/queries/player-rating-ranking.sql", import.meta.url),
  "utf8",
).trim();
const returns = `player_id uuid, name text, nickname text, average numeric,
  events_count bigint, explicit_count bigint, default_count bigint,
  blocked boolean, restarted boolean, rank bigint`;
const proposal = `-- Ranking migration. Apply to the authorized test copy first.
-- Production application requires separate authorization.
-- Reuses immutable finance_* history; never updates debts, payments or evaluations.
create schema if not exists ranking_internal;
revoke all on schema ranking_internal from public, anon;
grant usage on schema ranking_internal to authenticated;

create or replace function ranking_internal.court_player_ranking(_venue_id uuid)
returns table (${returns})
language sql stable security definer set search_path = '' as $ranking$
${query}
$ranking$;
revoke all on function ranking_internal.court_player_ranking(uuid) from public, anon;
grant execute on function ranking_internal.court_player_ranking(uuid) to authenticated;

create or replace function public.get_court_player_ranking(_venue_id uuid)
returns table (${returns})
language sql stable security invoker set search_path = '' as $ranking$
  select * from ranking_internal.court_player_ranking(_venue_id);
$ranking$;
revoke all on function public.get_court_player_ranking(uuid) from public, anon;
grant execute on function public.get_court_player_ranking(uuid) to authenticated;
-- No replacement of the old averages RPC until its consumers are migrated.
`;
// Never rewrite an applied migration when regenerating fixtures. Future changes
// to the query require a new versioned migration and a corresponding generator.
const migration = readFileSync(
  new URL("../supabase/migrations/20261116171956_player_rating_ranking.sql", import.meta.url),
  "utf8",
);
if (migration.replaceAll("\r\n", "\n").trim() !== proposal.replaceAll("\r\n", "\n").trim()) {
  throw new Error(
    "Ranking SQL changed. Create a new migration instead of rewriting the applied one.",
  );
}

// SELECT-only fixtures: execute the exact query body, replacing relations with
// in-memory CTEs. This does NOT validate RPC grants, RLS or deployed integration.
const players = [],
  events = [],
  attendances = [],
  ratings = [],
  charges = [],
  ledger = [],
  expected = [];
let seq = 0;
const quote = (value) =>
  value === null
    ? "null"
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
const rows = (data, columns) =>
  `select * from (values ${data.map((row) => `(${row.map(quote).join(",")})`).join(",\n")}) as v(${columns})`;
function player(
  id,
  average,
  count,
  explicit,
  blocked = false,
  restarted = false,
  venue = "court-a",
  group = "group-a",
) {
  players.push([id, id, null, group, venue]);
  if (venue === "court-a")
    expected.push([id, average, count, explicit, count - explicit, blocked, restarted]);
}
function participation(
  id,
  rating,
  {
    at = "2026-11-01T18:00:00Z",
    attended = true,
    status = "confirmed",
    done = true,
    venue = "court-a",
    group = "group-a",
    listed = true,
  } = {},
) {
  const event = `event-${++seq}`;
  events.push([event, group, venue, done ? "done" : "scheduled", at]);
  if (listed) attendances.push([id, event, group, status, attended]);
  if (rating !== null) ratings.push([id, event, group, venue, rating]);
}
function charge(
  id,
  {
    due = "2026-11-01",
    status = "open",
    cancelled = null,
    venue = "court-a",
    group = "group-a",
  } = {},
) {
  const key = `charge-${++seq}`;
  charges.push([key, id, group, venue, 100, due, status, "2026-11-01T00:00:00Z", cancelled]);
  return (delta, at) =>
    ledger.push([key, id, group, venue, delta, at, delta > 0 ? "payment" : "payment_reversal"]);
}
player("two-fives-then-absent", 5, 2, 2);
participation("two-fives-then-absent", 5);
participation("two-fives-then-absent", 5);
participation("two-fives-then-absent", null, { attended: false });
participation("two-fives-then-absent", null, { attended: false });
player("default-three", 3, 1, 0);
participation("default-three", null);
player("explicit-minimum", 1, 1, 1);
participation("explicit-minimum", 1);
player("not-listed", null, 0, 0);
participation("not-listed", 5, { listed: false });
player("waiting-not-eligible", null, 0, 0);
participation("waiting-not-eligible", 5, { status: "waitlist" });
player("ten-days", 5, 1, 1);
participation("ten-days", 5);
charge("ten-days", { due: "2026-11-06" });
player("eleven-days", 0, 0, 0, true);
participation("eleven-days", 5);
charge("eleven-days", { due: "2026-11-05" });
player("partial-overdue", 0, 0, 0, true);
participation("partial-overdue", 5);
charge("partial-overdue")(40, "2026-11-14T12:00:00Z");
player("paid-late-new-default", 3, 1, 0, false, true);
participation("paid-late-new-default", 5);
charge("paid-late-new-default")(100, "2026-11-13T12:00:00Z");
participation("paid-late-new-default", null, { at: "2026-11-15T18:00:00Z" });
player("paid-early", 5, 1, 1);
participation("paid-early", 5);
charge("paid-early")(100, "2026-11-05T12:00:00Z");
player("cancelled-late-new-four", 4, 1, 1, false, true);
participation("cancelled-late-new-four", 5);
charge("cancelled-late-new-four", { status: "cancelled", cancelled: "2026-11-14T12:00:00Z" });
participation("cancelled-late-new-four", 4, { at: "2026-11-15T18:00:00Z" });
player("paid-late-no-new-events", 0, 0, 0, false, true);
participation("paid-late-no-new-events", 5);
charge("paid-late-no-new-events")(100, "2026-11-13T12:00:00Z");
player("other-court-debt", 5, 1, 1);
participation("other-court-debt", 5);
charge("other-court-debt", { venue: "court-b" });
player("reversed-then-paid", 2, 1, 1, false, true);
participation("reversed-then-paid", 5);
const pay = charge("reversed-then-paid");
pay(100, "2026-11-05T12:00:00Z");
pay(-100, "2026-11-13T12:00:00Z");
pay(100, "2026-11-14T12:00:00Z");
participation("reversed-then-paid", 2, { at: "2026-11-15T18:00:00Z" });
player("paid-early-cancelled-later", 5, 1, 1);
participation("paid-early-cancelled-later", 5);
charge("paid-early-cancelled-later", { status: "cancelled", cancelled: "2026-11-15T12:00:00Z" })(
  100,
  "2026-11-05T12:00:00Z",
);
player("mixed-real-default", 4, 2, 1);
participation("mixed-real-default", 5);
participation("mixed-real-default", null);
player("unknown-presence", null, 0, 0);
participation("unknown-presence", 5, { attended: null });
player("unfinished-event", null, 0, 0);
participation("unfinished-event", 5, { done: false });
player("wrong-event-court", null, 0, 0);
participation("wrong-event-court", 5, { venue: "court-b" });
player("cancelled-early", 5, 1, 1);
participation("cancelled-early", 5);
charge("cancelled-early", { status: "cancelled", cancelled: "2026-11-05T12:00:00Z" });
player("two-debts-last-clearance", 4, 1, 1, false, true);
participation("two-debts-last-clearance", 5);
charge("two-debts-last-clearance")(100, "2026-11-13T12:00:00Z");
charge("two-debts-last-clearance")(100, "2026-11-15T12:00:00Z");
participation("two-debts-last-clearance", 5, { at: "2026-11-14T18:00:00Z" });
participation("two-debts-last-clearance", 4, { at: "2026-11-16T18:00:00Z" });
player("one-debt-still-open", 0, 0, 0, true, true);
participation("one-debt-still-open", 5);
charge("one-debt-still-open")(100, "2026-11-13T12:00:00Z");
charge("one-debt-still-open");
player("payment-reversal-same-instant", 0, 0, 0, true);
participation("payment-reversal-same-instant", 5);
const sameInstant = charge("payment-reversal-same-instant");
sameInstant(100, "2026-11-13T12:00:00Z");
sameInstant(-100, "2026-11-13T12:00:00Z");
player("wrong-rating-scope", 3, 1, 0);
participation("wrong-rating-scope", 5);
ratings[ratings.length - 1][3] = "court-b";
player("cancelled-attendance", null, 0, 0);
participation("cancelled-attendance", 5, { status: "cancelled" });
player("late-partials-then-full", 3, 1, 0, false, true);
participation("late-partials-then-full", 5);
const partials = charge("late-partials-then-full");
partials(40, "2026-11-13T12:00:00Z");
partials(60, "2026-11-15T12:00:00Z");
participation("late-partials-then-full", 5, { at: "2026-11-14T18:00:00Z" });
participation("late-partials-then-full", null, { at: "2026-11-16T18:00:00Z" });
player("outsider", 5, 1, 1, false, false, "court-b", "group-b");
participation("outsider", 5, { venue: "court-b", group: "group-b" });

const fixtureQuery = query
  .replace(
    /public\.(players|events|attendances|event_player_ratings|finance_charges|finance_ledger)\b/g,
    "fixture_$1",
  )
  .replaceAll("auth.uid() is not null", "true")
  .replaceAll("public.is_court_member($1)", "true")
  .replaceAll("public._fin_today()", "date '2026-11-16'")
  .replaceAll("$1", "'court-a'")
  .replace(/;\s*$/, "");
const fixtureSql = `-- SELECT-only tests, with synthetic rows; no persistent fixtures or DDL.
with fixture_players as (${rows(players, "id,name,nickname,group_id,venue_id")}),
fixture_events as (select id,group_id,venue_id,status,starts_at::timestamptz from (${rows(events, "id,group_id,venue_id,status,starts_at")}) x),
fixture_attendances as (${rows(attendances, "player_id,event_id,group_id,status,attended")}),
fixture_event_player_ratings as (${rows(ratings, "player_id,event_id,group_id,venue_id,rating")}),
fixture_finance_charges as (select id,player_id,group_id,venue_id,amount_cents,due_date::date,status,created_at::timestamptz,cancelled_at::timestamptz from (${rows(charges, "id,player_id,group_id,venue_id,amount_cents,due_date,status,created_at,cancelled_at")}) x),
fixture_finance_ledger as (select charge_id,player_id,group_id,venue_id,amount_cents,created_at::timestamptz,entry_type from (${rows(ledger, "charge_id,player_id,group_id,venue_id,amount_cents,created_at,entry_type")}) x),
expected as (${rows(expected, "player_id,average,events_count,explicit_count,default_count,blocked,restarted")}),
actual as (${fixtureQuery})
select e.player_id,
  (a.player_id is not null and a.average is not distinct from e.average and a.events_count=e.events_count
    and a.explicit_count=e.explicit_count and a.default_count=e.default_count and a.blocked=e.blocked and a.restarted=e.restarted) as passed,
  a.average,a.events_count,a.explicit_count,a.default_count,a.blocked,a.restarted,
  (select count(*)=0 from actual where player_id='outsider') as other_court_excluded,
  (select min(rank)=max(rank) from actual where average=5) as equal_scores_share_rank
from expected e left join actual a using(player_id) order by e.player_id;
`;
writeFileSync(
  new URL("../supabase/tests/player_rating_ranking_readonly.sql", import.meta.url),
  fixtureSql,
);
if (process.argv.includes("--print-tests")) process.stdout.write(fixtureSql);
else
  process.stdout.write(
    `Verified migration and prepared ${expected.length} SELECT-only scenarios.\n`,
  );
