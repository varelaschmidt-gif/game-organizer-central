import { supabase } from "@/integrations/supabase/client";

const AVATAR_BUCKET = "rdq-profile-avatars";

export async function resolveProfileAvatar(path?: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}
