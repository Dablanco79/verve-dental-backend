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
    recordActivity: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

vi.mock("../src/auth/tokenStorage.js", () => ({
  ACCESS_TOKEN_KEY: "verve.accessToken",
  LAST_USER_ACTIVITY_KEY: "verve.lastUserActivityAt",
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
  getLastUserActivityAt: vi.fn(() => null),
  setLastUserActivityAt: vi.fn(),
  clearLastUserActivityAt: vi.fn(),
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

    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
