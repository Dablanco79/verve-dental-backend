import { describe, expect, it, vi } from "vitest";

import { redirectToLogin } from "../src/auth/authNavigation.js";

describe("redirectToLogin", () => {
  it("uses a full document navigation to the login page", () => {
    const replace = vi.fn();

    expect(redirectToLogin({ pathname: "/inventory", replace })).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it.each(["/login", "/login/"])(
    "does not redirect when already on %s",
    (pathname) => {
      const replace = vi.fn();

      expect(redirectToLogin({ pathname, replace })).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    },
  );
});
