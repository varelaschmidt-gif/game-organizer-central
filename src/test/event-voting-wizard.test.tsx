import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventVotingWizard } from "@/components/event-voting-wizard";

const players = ["Ana", "Bia", "Caio"].map((name, i) => ({
  id: `p${i + 1}`,
  name,
  nickname: null,
}));
afterEach(cleanup);
function show(save = vi.fn().mockResolvedValue(undefined)) {
  const cancel = vi.fn();
  render(<EventVotingWizard players={players} ratings={[]} onSave={save} onCancel={cancel} />);
  return { save, cancel };
}
function chooseBoth() {
  fireEvent.click(screen.getByRole("radio", { name: /Ana/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar para o pereba" }));
  fireEvent.click(screen.getByRole("radio", { name: /Bia/ }));
  fireEvent.click(screen.getByRole("button", { name: "Concluir votação" }));
}
describe("guided event evaluation", () => {
  it("starts everyone at three and requires a best-player choice", () => {
    const { save } = show();
    expect(screen.getByRole("heading", { name: "Craque do dia" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("3 estrelas")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Continuar para o pereba" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it("changes the theme and excludes the best player from the worst selection", () => {
    show();
    fireEvent.click(screen.getByRole("radio", { name: /Ana/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar para o pereba" }));
    expect(screen.getByRole("heading", { name: "Pereba da partida" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Ana/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Bia/ }));
    expect(screen.getAllByLabelText("5 estrelas")).toHaveLength(1);
    expect(screen.getAllByLabelText("1 estrela")).toHaveLength(1);
    expect(screen.getAllByLabelText("3 estrelas")).toHaveLength(1);
  });
  it("saves both choices together only after confirmation", async () => {
    const { save } = show();
    chooseBoth();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar votação" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith("p1", "p2", ["p1", "p2", "p3"], []),
    );
  });
  it("clears an incompatible worst choice when revising the best player", () => {
    show();
    fireEvent.click(screen.getByRole("radio", { name: /Ana/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar para o pereba" }));
    fireEvent.click(screen.getByRole("radio", { name: /Bia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao craque" }));
    fireEvent.click(screen.getByRole("radio", { name: /Bia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar para o pereba" }));
    expect(screen.getByRole("button", { name: "Concluir votação" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Bia/ })).toBeDisabled();
  });
  it("retains choices and displays a save failure without claiming success", async () => {
    show(vi.fn().mockRejectedValue(new Error("A votação foi alterada. Atualize.")));
    chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Salvar votação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A votação foi alterada");
    expect(screen.getByRole("button", { name: "Salvar votação" })).toBeEnabled();
  });
  it("sends one request for repeated confirmation clicks", async () => {
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const save = vi.fn().mockReturnValue(pending);
    show(save);
    chooseBoth();
    const confirm = screen.getByRole("button", { name: "Salvar votação" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
  it("lets the user exit without saving", () => {
    const { save, cancel } = show();
    fireEvent.click(screen.getByRole("button", { name: "Sair da votação" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
