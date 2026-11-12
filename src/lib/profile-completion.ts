const PROFILE_POSITIONS = new Set(["Goleiro", "Zagueiro", "Lateral", "Volante", "Meia", "Ponta", "Atacante"]);
const PROFILE_FEET = new Set(["direito", "esquerdo", "ambos"]);

export type BasicProfile = {
  email?: string | null | undefined;
  full_name?: string | null;
  phone?: string | null;
  age?: number | string | null;
  position?: string | null;
  dominant_foot?: string | null;
};

export function isProfileComplete(profile: BasicProfile | null | undefined): boolean {
  return Boolean(
    profile?.email?.trim() &&
    profile.full_name?.trim() &&
    profile.phone?.trim() &&
    Number(profile.age) >= 1 &&
    Number(profile.age) <= 120 &&
    PROFILE_POSITIONS.has(profile.position ?? "") &&
    PROFILE_FEET.has(profile.dominant_foot ?? "")
  );
}
