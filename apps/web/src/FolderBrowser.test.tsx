// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { browseDirectories } = vi.hoisted(() => ({ browseDirectories: vi.fn() }));
vi.mock("./api", () => ({ api: { browseDirectories } }));
import { FolderBrowser } from "./FolderBrowser";

describe("sélecteur de dossiers du serveur", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("parcourt un volume et renvoie le dossier sélectionné", async () => {
    browseDirectories
      .mockResolvedValueOnce({ path: null, parentPath: null, roots: [{ name: "volume1", path: "/volume1" }], directories: [{ name: "volume1", path: "/volume1" }] })
      .mockResolvedValueOnce({ path: "/volume1", parentPath: null, roots: [], directories: [{ name: "Multimédia", path: "/volume1/Multimédia" }] })
      .mockResolvedValueOnce({ path: "/volume1/Multimédia", parentPath: "/volume1", roots: [], directories: [{ name: "Film", path: "/volume1/Multimédia/Film" }] });
    const select = vi.fn();
    render(<FolderBrowser onSelect={select} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /volume1/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Multimédia/ }));
    await waitFor(() => expect(screen.getByLabelText("Dossier actuel")).toHaveTextContent("/volume1/Multimédia"));
    fireEvent.click(screen.getByRole("button", { name: "Choisir ce dossier" }));
    expect(select).toHaveBeenCalledWith("/volume1/Multimédia");
  });
});
