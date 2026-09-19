import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { SESSION_REQUIRED_EVENT, fetchAuthStatus, logout as logoutRequest } from "./lib/registry.js";
import type { AuthPermission, AuthStatus } from "./lib/types.js";

export interface AuthContextValue {
  /** null until the first session check completes. */
  status: AuthStatus | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: AuthPermission) => boolean;
}

export const AuthContext = createContext<AuthContextValue>({
  status: null,
  refresh: async () => {},
  signOut: async () => {},
  can: () => true,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchAuthStatus());
    } catch {
      // The API is unreachable; treat the dashboard as open so the error surfaces
      // where it happens instead of behind a sign-in wall.
      setStatus({ required: false, principal: null });
    }
  }, []);

  const signOut = useCallback(async () => {
    setStatus(await logoutRequest());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onRequired = () => { setStatus((current) => current ? { ...current, required: true, principal: null } : current); };
    window.addEventListener(SESSION_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(SESSION_REQUIRED_EVENT, onRequired);
  }, []);

  // Without a principal (authentication off) everything is allowed, as before.
  const can = useCallback((permission: AuthPermission) =>
    !status?.principal || status.principal.permissions.includes(permission), [status]);

  return <AuthContext.Provider value={{ status, refresh, signOut, can }}>{children}</AuthContext.Provider>;
}
