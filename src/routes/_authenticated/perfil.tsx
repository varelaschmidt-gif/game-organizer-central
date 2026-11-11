import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { profileQuery } from "@/lib/groups";
import { resolveProfileAvatar } from "@/lib/profile-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/states";

export const Route = createFileRoute("/_authenticated/perfil")({
  validateSearch: (search: Record<string, unknown>) => ({ redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined }),
  head: () => ({ meta: [{ title: "Meu perfil | Rei da Quadra" }] }),
  component: ProfilePage,
});

const positions = ["Goleiro", "Zagueiro", "Lateral", "Volante", "Meia", "Ponta", "Atacante"] as const;
const feet = [
  { value: "direito", label: "Direito" },
  { value: "esquerdo", label: "Esquerdo" },
  { value: "ambos", label: "Ambos" },
];
const avatarBucket = "rdq-profile-avatars";

function ProfilePage() {
  const profile = useQuery(profileQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [fields, setFields] = useState({ full_name: "", phone: "", age: "", position: "", dominant_foot: "" });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile.data) return;
    setFields({
      full_name: profile.data.full_name ?? "",
      phone: profile.data.phone ?? "",
      age: profile.data.age?.toString() ?? "",
      position: profile.data.position ?? "",
      dominant_foot: profile.data.dominant_foot ?? "",
    });
  }, [profile.data]);

  useEffect(() => {
    if (photoFile) {
      const objectUrl = URL.createObjectURL(photoFile);
      setPhotoPreview(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    let active = true;
    void resolveProfileAvatar(profile.data?.avatar_url).then((url) => {
      if (active) setPhotoPreview(url ?? "");
    });
    return () => { active = false; };
  }, [photoFile, profile.data?.avatar_url]);

  function selectPhoto(file?: File) {
    if (!file) { setPhotoFile(null); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPhotoFile(null);
      toast.error("Escolha uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoFile(null);
      toast.error("A foto deve ter no máximo 5 MB.");
      return;
    }
    setPhotoFile(file);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return void toast.error("Sua sessão expirou. Entre novamente.");
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      let avatarPath = profile.data?.avatar_url ?? null;
      if (photoFile) {
        const extension = photoFile.type === "image/jpeg" ? "jpg" : photoFile.type === "image/png" ? "png" : "webp";
        uploadedPath = `${auth.user.id}/${globalThis.crypto?.randomUUID?.() ?? Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(avatarBucket).upload(uploadedPath, photoFile, {
          cacheControl: "3600",
          contentType: photoFile.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        avatarPath = uploadedPath;
      }

      const { error } = await supabase.from("profiles").upsert({
        id: auth.user.id,
        full_name: fields.full_name.trim(),
        phone: fields.phone.trim(),
        age: Number(fields.age),
        position: fields.position,
        dominant_foot: fields.dominant_foot,
        avatar_url: avatarPath,
      });
      if (error) throw error;

      const previousAvatar = profile.data?.avatar_url;
      if (uploadedPath && previousAvatar && !/^https?:\/\//i.test(previousAvatar)) {
        await supabase.storage.from(avatarBucket).remove([previousAvatar]);
      }
      await qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Perfil atualizado");
      navigate({ to: (redirect || "/dashboard") as any, replace: true });
    } catch (error) {
      if (uploadedPath) await supabase.storage.from(avatarBucket).remove([uploadedPath]);
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar seu perfil.");
    } finally {
      setBusy(false);
    }
  }

  if (profile.isLoading) return <LoadingState />;
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6">
      <h1 className="text-2xl font-bold">Complete seu perfil</h1>
      <p className="mt-1 text-sm text-muted-foreground">Informe seus dados de contato e futebol. O endereço não é necessário por enquanto.</p>
      <form onSubmit={save} className="mt-5 space-y-4">
        <div>
          <Label htmlFor="profile-name">Nome completo</Label>
          <Input id="profile-name" required autoComplete="name" value={fields.full_name} onChange={(e) => setFields({ ...fields, full_name: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="profile-email">E-mail da conta</Label>
          <Input id="profile-email" type="email" value={profile.data?.email ?? ""} readOnly aria-describedby="profile-email-help" />
          <p id="profile-email-help" className="mt-1 text-xs text-muted-foreground">Este é o e-mail usado para entrar no aplicativo.</p>
        </div>
        <div>
          <Label htmlFor="profile-phone">Celular</Label>
          <Input id="profile-phone" required type="tel" autoComplete="tel" inputMode="tel" placeholder="(11) 99999-9999" value={fields.phone} onChange={(e) => setFields({ ...fields, phone: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="profile-age">Idade</Label>
          <Input id="profile-age" required type="number" min={1} max={120} inputMode="numeric" value={fields.age} onChange={(e) => setFields({ ...fields, age: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="profile-position">Posição principal</Label>
          <select id="profile-position" required value={fields.position} onChange={(e) => setFields({ ...fields, position: e.target.value })} className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground">
            <option value="">Selecione sua posição</option>
            {positions.map((position) => <option key={position} value={position}>{position}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="profile-foot">Pé dominante</Label>
          <select id="profile-foot" required value={fields.dominant_foot} onChange={(e) => setFields({ ...fields, dominant_foot: e.target.value })} className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground">
            <option value="">Selecione</option>
            {feet.map((foot) => <option key={foot.value} value={foot.value}>{foot.label}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-photo">Foto de perfil</Label>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
              {photoPreview ? <img src={photoPreview} alt="Pré-visualização da foto de perfil" className="h-full w-full object-cover" /> : <ImagePlus className="h-7 w-7 text-muted-foreground" />}
            </div>
            <Input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => selectPhoto(e.target.files?.[0])} />
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG ou WebP · até 5 MB.</p>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Salvando…" : "Salvar perfil"}
        </Button>
      </form>
    </div>
  );
}
