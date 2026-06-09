import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { enrichLocationsWithInventorySettings, isCommissaryLocation } from '@/lib/inventoryLocations';

const AuthContext = createContext();

async function loadCompanyLocations(companyId) {
  if (!companyId) return [];

  const [locations, settings] = await Promise.all([
    base44.entities.Location.filter({ company_id: companyId }),
    base44.entities.InventoryLocationSetting.filter({ company_id: companyId }).catch(() => []),
  ]);

  return enrichLocationsWithInventorySettings(locations, settings);
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings] = useState({ public_settings: {} });
  const [allLocations, setAllLocations] = useState([]);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);

    try {
      const currentUser = await base44.auth.me();
      const isEnrollRoute = window.location.pathname === '/enroll';

      if (!currentUser.company_id && currentUser.role !== 'super_admin' && !isEnrollRoute) {
        try {
          await base44.functions.invoke('cleanupPendingInvite', { data: { email: currentUser.email } });
          const updatedUser = await base44.auth.me();

          if (!updatedUser.company_id && updatedUser.role !== 'super_admin') {
            setAuthError({ type: 'user_not_registered', message: 'No company association found.' });
            setIsAuthenticated(false);
            return;
          }

          try {
            const locations = await loadCompanyLocations(updatedUser.company_id);
            setAllLocations(locations);
          } catch {
            setAllLocations([]);
          }
          setUser(updatedUser);
          setIsAuthenticated(true);
          return;
        } catch {
          setAuthError({ type: 'user_not_registered', message: 'No company association found.' });
          setIsAuthenticated(false);
          return;
        }
      }

      if (currentUser.company_id) {
        try {
          const locations = await loadCompanyLocations(currentUser.company_id);
          setAllLocations(locations);
        } catch {
          setAllLocations([]);
        }
      } else {
        setAllLocations([]);
      }
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (error) {
      if (error.status === 401) {
        setUser(null);
        setAllLocations([]);
        setIsAuthenticated(false);
      } else {
        setAuthError({
          type: 'unknown',
          message: error.message || 'Authentication failed',
        });
        setIsAuthenticated(false);
      }
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  const checkAppState = useCallback(async () => {
    setIsLoadingPublicSettings(false);
    await checkUserAuth();
  }, [checkUserAuth]);

  useEffect(() => {
    checkAppState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      checkUserAuth();
    });

    return () => subscription.unsubscribe();
  }, [checkAppState, checkUserAuth]);

  const logout = () => {
    setUser(null);
    setAllLocations([]);
    setIsAuthenticated(false);
    base44.auth.logout();
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin();
  };

  const companyId = user?.company_id || null;
  const assignedLocations = user?.assigned_locations || [];
  const canAccessLocation = useCallback((locationId) => {
    if (!locationId) return false;
    if (['admin', 'super_admin'].includes(user?.role)) return true;
    if (!assignedLocations.length) return true;
    return assignedLocations.includes(locationId);
  }, [assignedLocations, user?.role]);
  const canAccessCommissary = useCallback(() => {
    if (['admin', 'super_admin'].includes(user?.role)) return true;
    const commissaryLocations = allLocations.filter(isCommissaryLocation);
    if (!assignedLocations.length) return commissaryLocations.length > 0;
    return commissaryLocations.some((location) => assignedLocations.includes(location.id));
  }, [allLocations, assignedLocations, user?.role]);
  const getManagedCommissaryLocationIds = useCallback(() => {
    const commissaryLocations = allLocations.filter(isCommissaryLocation);
    if (['admin', 'super_admin'].includes(user?.role) || !assignedLocations.length) {
      return commissaryLocations.map((location) => location.id);
    }
    return commissaryLocations
      .filter((location) => assignedLocations.includes(location.id))
      .map((location) => location.id);
  }, [allLocations, assignedLocations, user?.role]);
  const userPermission = user
    ? {
        role: user.role,
        permissions: {
          master_catalog: ['admin', 'manager'].includes(user.role),
          hq_reports: ['admin', 'manager'].includes(user.role),
          all_locations: ['admin', 'super_admin'].includes(user.role) || assignedLocations.length === 0,
          location_ids: assignedLocations,
        },
      }
    : null;

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState,
      allLocations,
      companyId,
      canAccessLocation,
      canAccessCommissary,
      getManagedCommissaryLocationIds,
      userPermission
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
