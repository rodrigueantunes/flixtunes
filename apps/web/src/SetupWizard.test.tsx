// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./api", () => ({ api: { completeSetup: vi.fn() } }));
import { SetupWizard, createDraftId } from "./SetupWizard";

describe("assistant de configuration", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("ajoute films et séries lorsque randomUUID est indisponible en HTTP local", () => {
    vi.stubGlobal("crypto", {});
    render(<SetupWizard onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Ajouter des films/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ajouter des séries TV/ }));

    expect(screen.getByRole("button", { name: "Retirer Films" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer Séries TV" })).toBeInTheDocument();
    expect(screen.getAllByText("Chemin du dossier")).toHaveLength(2);
  });

  it("génère des identifiants distincts sans contexte sécurisé", () => {
    vi.stubGlobal("crypto", {});
    expect(createDraftId()).toMatch(/^draft-/);
    expect(createDraftId()).not.toBe(createDraftId());
  });
});
