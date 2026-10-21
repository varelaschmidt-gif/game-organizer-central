import { createFileRoute, Link } from "@tanstack/react-router";
import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rei da Quadra | Futebol amador" },
      { name: "description", content: "Rei da Quadra — gestão de grupos de futebol amador." },
      { property: "og:title", content: "Rei da Quadra | Futebol amador" },
      { property: "og:description", content: "Rei da Quadra — gestão de grupos de futebol amador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <Crown className="h-12 w-12 text-pink-500" />
      <h1 className="mt-4 text-5xl font-bold uppercase md:text-7xl">Rei da Quadra</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        Organize jogos, jogadores e o caixa do seu grupo de futebol amador.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild size="lg">
          <Link to="/auth" search={{ redirect: undefined, mode: undefined }}>Entrar</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to="/auth" search={{ redirect: undefined, mode: "signup" }}>Criar conta</Link>
        </Button>
      </div>
    </main>
  );
}
