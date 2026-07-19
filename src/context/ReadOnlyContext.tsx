import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { ROLES } from "../types/auth";
import { getReadOnlyState } from "../services/access.service";
import { READ_ONLY_EVENT } from "../services/api";

// S2.7 — global read-only state. One fetch of /access/read-only per
// authenticated tenant session drives the global banner and every disabled
// write control, so no page re-derives billing status. DEVELOPER (no company)
// is never read-only. Also listens for the READ_ONLY_EVENT that apiFetch
// fires when any write is rejected with READ_ONLY_MODE, so the UI catches up
// immediately even if a control wasn't disabled up front.

type ReadOnlyContextValue = {
  readOnly: boolean;
  isLoading: boolean;
  refresh: () => void;
};

const ReadOnlyContext = createContext<ReadOnlyContextValue | undefined>(undefined);

export function ReadOnlyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [readOnly, setReadOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Only tenant users (owners/employees) have a billing state; the platform
  // operator (DEVELOPER, no company) never enters read-only.
  const isTenantUser =
    isAuthenticated && user != null && user.role !== ROLES.DEVELOPER && user.companyId != null;

  function refresh() {
    if (!isTenantUser) {
      setReadOnly(false);
      setIsLoading(false);
      return;
    }
    getReadOnlyState()
      .then((state) => setReadOnly(state.readOnly))
      .catch(() => setReadOnly(false))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTenantUser]);

  // A rejected write (READ_ONLY_MODE) means we're read-only now — reflect it
  // without waiting for the next refresh.
  useEffect(() => {
    function onReadOnly() {
      setReadOnly(true);
    }
    window.addEventListener(READ_ONLY_EVENT, onReadOnly);
    return () => window.removeEventListener(READ_ONLY_EVENT, onReadOnly);
  }, []);

  return (
    <ReadOnlyContext.Provider value={{ readOnly, isLoading, refresh }}>
      {children}
    </ReadOnlyContext.Provider>
  );
}

export function useReadOnly(): ReadOnlyContextValue {
  const context = useContext(ReadOnlyContext);
  if (!context) {
    throw new Error("useReadOnly must be used within a ReadOnlyProvider");
  }
  return context;
}
