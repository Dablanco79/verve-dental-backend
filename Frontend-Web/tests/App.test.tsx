import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/App.js";

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getHealth: vi.fn().mockResolvedValue({
      status: "ok",
      service: "@verve/backend",
      timestamp: "2026-06-11T00:00:00.000Z",
    }),
  }),
}));

describe("App", () => {
  it("renders the platform shell and health status", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Operational Suite" })).toBeInTheDocument();
    expect(await screen.findByText("@verve/backend")).toBeInTheDocument();
  });
});
