// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Etoiles } from "./Etoiles";

afterEach(cleanup);

describe("la note en étoiles (r14)", () => {
  it("se lit en entier aux lecteurs d'écran, et remplit l'or à la demi-étoile près", () => {
    const { container } = render(<Etoiles note={{ surCinq: 3.7, votes: 1520, source: "tmdb" }} />);
    expect(screen.getByRole("img", { name: /Note : 3,7 sur 5, 1\s520 votes sur TMDB/ })).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>(".etoiles-or")!.style.width).toBe("70%");
    expect(container.querySelector(".etoiles-chiffre")).toHaveTextContent("3,7");
  });
  it("arrondit à la demi-étoile la plus proche", () => {
    const { container } = render(<Etoiles note={{ surCinq: 4.3, votes: 12, source: "tmdb" }} compacte />);
    expect(container.querySelector<HTMLElement>(".etoiles-or")!.style.width).toBe("90%");
    expect(container.querySelector(".etoiles")).toHaveClass("compactes");
  });
});
