<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project rules

- Group access is checked only via security-definer helpers (is_group_member, is_group_admin, has_group_permission) in RLS — avoids recursive policies.
- Privileged writes (create group, invites, joining) go through database RPCs, never direct table inserts — keeps role assignment server-side.
- Any signed-in user with a complete profile may create a group (validated in create_group); group_creator is no longer required. Max 3 admins per group, enforced by a group_members trigger; role changes go through set_group_admin RPC.
- Player-editable vs admin-only columns on players are enforced by a trigger — RLS can't restrict columns.
- Signed-in pages live under src/routes/_authenticated (client-only gate) and share AppShell.
- Event ratings (1-5 stars, admin-only, one 5-star per event via partial unique index) live in event_player_ratings; peer voting table is kept but disabled by its trigger — preserves old votes.
