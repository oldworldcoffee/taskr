import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { base44 } from './base44';
import { supabase } from './supabase';

const AuthContext = createContext(null);

// Lean version of the web app's AuthContext: just enough to gate the app on a
// Supabase session and expose the current user's profile. The web app also
// loads locations / public settings / handles pending-invite cleanup here; for
// the employee v1 slice we skip that.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const profile = await base44.auth.me();
      setUser(profile);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await refresh();
      if (active) setIsLoadingAuth(false);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        refresh();
      }
    });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [refresh]);

  const login = useCallback(
    async (email, password) => {
      await base44.auth.loginViaEmailPassword(email, password);
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    await base44.auth.logout();
    setUser(null);
  }, []);

  const value = {
    user,
    isAuthenticated: !!user,
    isLoadingAuth,
    login,
    logout,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
