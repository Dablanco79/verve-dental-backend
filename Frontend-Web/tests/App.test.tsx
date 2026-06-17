import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/auth/AuthProvider.js";
import { LoginPage } from "../src/pages/LoginPage.js";

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn().mockRejectedValue(new Error("No refresh cookie")),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

vi.mock("../src/auth/tokenStorage.js", () => ({
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

describe("LoginPage", () => {
  it("renders the sign-in form", () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
