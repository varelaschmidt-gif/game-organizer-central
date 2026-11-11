export function isMissingGuestSchema(error: unknown) {
  const value = error as { code?: string; message?: string } | null;
  const code = value?.code;
  if (["42703", "PGRST200", "PGRST204"].includes(code ?? "")) return true;

  const message = value?.message?.toLowerCase() ?? "";
  return message.includes("schema cache") ||
    message.includes("could not find the") && (message.includes("column") || message.includes("relationship")) ||
    message.includes("column") && message.includes("does not exist");
}
