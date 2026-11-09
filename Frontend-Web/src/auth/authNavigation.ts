const LOGIN_PATH = "/login";

type LoginLocation = Pick<Location, "pathname" | "replace">;

export function redirectToLogin(location: LoginLocation = window.location): boolean {
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath === LOGIN_PATH) return false;

  location.replace(LOGIN_PATH);
  return true;
}
