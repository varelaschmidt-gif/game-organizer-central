import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessState } from "@/components/states";

type Mode = "login" | "signup" | "forgot";

function safePath(p: unknown) {
  if (typeof p !== "string") return "/dashboard";
  try {
    const u = new URL(p, "http://x");
    if (p.startsWith("http") && typeof window !== "undefined" && u.origin !== window.location.origin)
      return "/dashboard";
    return u.pathname.startsWith("/") && !u.pathname.startsWith("//") ? u.pathname + u.search : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
    mode: s.mode === "signup" ? ("signup" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar | Rei da Quadra" },
      { name: "description", content: "Entre ou crie sua conta no Rei da Quadra." },
      { property: "og:title", content: "Entrar | Rei da Quadra" },
      { property: "og:description", content: "Entre ou crie sua conta no Rei da Quadra." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const target = safePath(search.redirect);
  const [mode, setMode] = useState<Mode>(search.mode ?? "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: target, replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === "SIGNED_IN" && s) navigate({ to: target, replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, target]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDone(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + target, data: { full_name: name } },
        });
        if (error) {
          if (/already|registered/i.test(error.message)) throw new Error("Este e-mail já está cadastrado. Faça login ou recupere sua senha.");
          throw error;
        }
        if (data.user && data.user.identities?.length === 0)
          throw new Error("Este e-mail já está cadastrado. Faça login ou recupere sua senha.");
        setDone("Conta criada! Confira seu e-mail para confirmar o cadastro.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setDone("Se o e-mail existir, enviamos um link para redefinir a senha.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (search.redirect) sessionStorage.setItem("rdq-after-login", target);
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error("Não foi possível entrar com Google.");
  }

  useEffect(() => {
    const p = sessionStorage.getItem("rdq-after-login");
    if (p) {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) {
          sessionStorage.removeItem("rdq-after-login");
          navigate({ to: safePath(p), replace: true });
        }
      });
    }
  }, [navigate]);

  const title = { login: "Entrar", signup: "Criar conta", forgot: "Recuperar senha" }[mode];

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Crown className="h-7 w-7 text-primary" />
          <span className="font-display text-2xl font-bold uppercase">Rei da Quadra</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h1 className="text-2xl font-bold">{title}</h1>
          {done ? (
            <div className="mt-4">
              <SuccessState message={done} />
              <Button variant="link" className="mt-2 px-0" onClick={() => { setDone(null); setMode("login"); }}>
                Voltar ao login
              </Button>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="mt-4 space-y-3">
                {mode === "signup" && (
                  <div>
                    <Label htmlFor="name">Nome</Label>
                    <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {mode !== "forgot" && (
                  <div>
                    <Label htmlFor="password">Senha</Label>
                    <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Aguarde..." : title}
                </Button>
              </form>
              {mode !== "forgot" && (
                <Button variant="outline" className="mt-3 w-full" onClick={google}>
                  Continuar com Google
                </Button>
              )}
              <div className="mt-4 flex flex-col gap-1 text-sm">
                {mode === "login" && (
                  <>
                    <button className="text-left text-primary" onClick={() => setMode("signup")}>Não tem conta? Cadastre-se</button>
                    <button className="text-left text-muted-foreground" onClick={() => setMode("forgot")}>Esqueci minha senha</button>
                  </>
                )}
                {mode !== "login" && (
                  <button className="text-left text-primary" onClick={() => setMode("login")}>Já tenho conta</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
