import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  name?: string | null;
  profileAvatar?: string | null | undefined;
  photoPath?: string | null;
  size?: string;
};

export function PlayerAvatar({ name, profileAvatar, photoPath, size = "h-9 w-9" }: Props) {
  const legacy = useQuery({
    enabled: !profileAvatar && !!photoPath,
    queryKey: ["player-photo", photoPath],
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("player-photos").createSignedUrl(photoPath!, 3600);
      if (error) return null;
      return data.signedUrl;
    },
  });
  const src = profileAvatar || legacy.data;
  const initial = name?.trim().charAt(0).toLocaleUpperCase("pt-BR") || "?";

  return (
    <div className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold`}>
      {src ? <img src={src} alt={name ? `Foto de ${name}` : "Foto do jogador"} className="h-full w-full object-cover" /> : initial}
    </div>
  );
}
