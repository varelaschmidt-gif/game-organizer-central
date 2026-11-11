import { supabase } from "@/integrations/supabase/client";

const AVATAR_BUCKET = "rdq-profile-avatars";

export async function resolveProfileAvatar(path?: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

export async function loadVenueProfileAvatars(venueId: string): Promise<Record<string, string>> {
  const { data, error } = await (supabase as any).rpc("get_venue_player_avatars", {
    _venue_id: venueId,
  });
  // A migration pendente não deve derrubar a lista; fotos antigas continuam disponíveis.
  if (error) return {};

  const entries = await Promise.all(
    (data ?? []).map(async (row: { player_id: string; avatar_path: string }) => [
      row.player_id,
      await resolveProfileAvatar(row.avatar_path),
    ] as const),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => !!entry[1]));
}
