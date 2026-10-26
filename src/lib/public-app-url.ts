const PUBLIC_APP_URL = (import.meta.env["VITE_PUBLIC_APP_URL"]?.trim() || "https://game-organizer-central.lovable.app")
  .replace(/\/+$/, "");

export function publicAppUrl(path: string) {
  return `${PUBLIC_APP_URL}/${path.replace(/^\/+/, "")}`;
}
