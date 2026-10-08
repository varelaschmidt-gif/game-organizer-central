import { createFileRoute } from "@tanstack/react-router";

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
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <h1 className="text-center text-4xl font-bold">Rei da Quadra</h1>
    </main>
  );
}
