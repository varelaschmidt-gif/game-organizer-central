import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AdminManager } from "@/components/AdminManager";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
afterEach(() => {
  cleanup();
  rpc.mockReset();
});

it("refreshes the player badges on promotion and disables promotion when the group reaches three admins", async () => {
  let members = [
    { member_id: "1", user_id: "1", full_name: "Ana", email: "", role: "admin" },
    { member_id: "2", user_id: "2", full_name: "Bia", email: "", role: "admin" },
    { member_id: "3", user_id: "3", full_name: "Caio", email: "", role: "player" },
    { member_id: "4", user_id: "4", full_name: "Davi", email: "", role: "player" },
  ];
  rpc.mockImplementation(async (name, args) => {
    if (name === "set_group_admin") {
      members = members.map((member) =>
        member.user_id === args._user_id ? { ...member, role: "admin" } : member,
      );
      return { error: null };
    }
    return { data: members, error: null };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <AdminManager groupId="g" />
    </QueryClientProvider>,
  );
  const recruit = await screen.findAllByRole("button", { name: "Promover a admin" });
  fireEvent.click(recruit[0]!);
  await waitFor(() => expect(screen.getByText("3 de 3 administradores")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Promover a admin" })).toBeDisabled();
  expect(
    within(screen.getByText("Caio").closest(".rounded-lg")!).getByText("Administrador"),
  ).toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["group-admin-accounts", "g"] });
});
