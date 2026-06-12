import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { enrichLocationsWithInventorySettings, isCommissaryLocation } from '@/lib/inventoryLocations';
import {
  isFeatureEnabledForLocation as computeFeatureForLocation,
  isFeatureEnabledAnywhere as computeFeatureAnywhere,
} from '@/lib/featureAccess';

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
  // The current user's per-(location, module) access rows. null = not yet loaded;
  // [] = loaded with no overrides (or an auto-grant role that needs none).
  const [moduleAccess, setModuleAccess] = useState(null);
  const authCheckedRef = useRef(false);
  const isAuthenticatedRef = useRef(false);

  useEffect(() => {
    authCheckedRef.current = authChecked;
  }, [authChecked]);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  const checkUserAuth = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setIsLoadingAuth(true);
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
      if (showLoading) setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  const checkAppState = useCallback(async () => {
    setIsLoadingPublicSettings(false);
    await checkUserAuth({ showLoading: true });
  }, [checkUserAuth]);

  // Re-fetch just the company's locations (and their feature flags) without a
  // full auth round-trip. Call after editing a location so nav gating reflects
  // toggle changes immediately.
  const refreshLocations = useCallback(async () => {
    const cid = user?.company_id;
    if (!cid) return;
    try {
      const locations = await loadCompanyLocations(cid);
      setAllLocations(locations);
    } catch {
      /* keep prior locations on failure */
    }
  }, [user?.company_id]);

  useEffect(() => {
    checkAppState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setAllLocations([]);
        setIsAuthenticated(false);
        setAuthError(null);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        return;
      }

      if (event === 'SIGNED_IN' && authCheckedRef.current && isAuthenticatedRef.current) {
        return;
      }

      checkUserAuth({ showLoading: !authCheckedRef.current });
    });

    return () => subscription.unsubscribe();
  }, [checkAppState, checkUserAuth]);

  // Load the signed-in user's module-access matrix. Auto-grant roles
  // (admin/manager/super_admin) need no rows. Re-runs when the user changes.
  const refreshModuleAccess = useCallback(async () => {
    const uid = user?.id;
    if (!uid) {
      setModuleAccess(null);
      return;
    }
    if (['admin', 'manager', 'super_admin'].includes(user?.role)) {
      setModuleAccess([]);
      return;
    }
    try {
      const rows = await base44.entities.UserLocationModuleAccess.filter({ user_id: uid });
      setModuleAccess(rows || []);
    } catch {
      setModuleAccess([]);
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    refreshModuleAccess();
  }, [refreshModuleAccess]);

  const logout = () => {
    setUser(null);
    setAllLocations([]);
    setModuleAccess(null);
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

  // Per-user feature access & roastery permissions (users.feature_permissions).
  const featurePermissions = user?.feature_permissions || {};
  // A roastery/hybrid location automatically enables roastery functionality.
  const hasRoasteryLocation = allLocations.some(
    (loc) => ['roastery', 'hybrid'].includes(loc?.location_type)
  );
  // Legacy global grant from users.feature_permissions. Used only as a transition
  // fallback for users whose module-access matrix hasn't loaded / has no rows yet
  // (mirrors the SQL has_module_access legacy branch). Removed once fully cut over.
  const legacyHasFeature = useCallback((feature) => {
    const grant = (user?.feature_permissions || {})[feature];
    return grant === true || (grant && typeof grant === 'object' && grant.enabled === true);
  }, [user?.feature_permissions]);

  // Per-(feature, location) gate. Managers/admins auto-grant; task_checklist is
  // always on; otherwise resolve from the matrix (override wins, no row => no
  // access for non-managers). locationId null => "enabled at ANY location".
  const userHasFeatureAtLocation = useCallback((feature, locationId = null) => {
    if (['admin', 'manager', 'super_admin'].includes(user?.role)) return true;
    if (feature === 'task_checklist') return true;
    const rows = moduleAccess;
    if (!rows || rows.length === 0) return legacyHasFeature(feature);
    if (!locationId) return rows.some((r) => r.module === feature && r.enabled);
    const row = rows.find((r) => r.location_id === locationId && r.module === feature);
    return row ? !!row.enabled : false;
  }, [user?.role, moduleAccess, legacyHasFeature]);

  // "Enabled at any accessible location" — back-compat shape used widely.
  const userHasFeature = useCallback(
    (feature) => userHasFeatureAtLocation(feature, null),
    [userHasFeatureAtLocation]
  );

  // Roastery sub-permissions: view_production, manage_production,
  // inventory_adjustments, reporting. Admins/managers get all. Optional
  // locationId scopes the check to a single location.
  const hasRoasteryPermission = useCallback((permission, locationId = null) => {
    if (['admin', 'manager', 'super_admin'].includes(user?.role)) return true;
    const rows = moduleAccess;
    if (!rows || rows.length === 0) {
      const roastery = (user?.feature_permissions || {}).roastery;
      return Boolean(roastery && typeof roastery === 'object' && roastery[permission]);
    }
    const relevant = rows.filter(
      (r) => r.module === 'roastery' && r.enabled && (!locationId || r.location_id === locationId)
    );
    return relevant.some((r) => r.roastery_perms && r.roastery_perms[permission]);
  }, [user?.role, moduleAccess, user?.feature_permissions]);

  // The locations this user may access (admins/unassigned see all).
  const accessibleLocations = allLocations.filter((loc) => canAccessLocation(loc.id));

  // Unified gating: company AND location AND user. Callers pass `company`
  // (company-info, holds enabled_features) since that lives in a separate query.
  const isFeatureEnabledForLocation = useCallback((feature, location, company) =>
    computeFeatureForLocation(feature, location, {
      company,
      locations: accessibleLocations,
      userHasFeature,
      userHasFeatureAtLocation,
      role: user?.role,
    }),
  [accessibleLocations, userHasFeature, userHasFeatureAtLocation, user?.role]);

  const isFeatureEnabledAnywhere = useCallback((feature, company) =>
    computeFeatureAnywhere(feature, accessibleLocations, {
      company,
      userHasFeature,
      userHasFeatureAtLocation,
      role: user?.role,
    }),
  [accessibleLocations, userHasFeature, userHasFeatureAtLocation, user?.role]);

  // Locations the user may access AND where `feature` is enabled. For module
  // location pickers, so a location with the feature toggled off drops out.
  const accessibleLocationsForFeature = useCallback((feature, company) =>
    accessibleLocations.filter((loc) =>
      computeFeatureForLocation(feature, loc, {
        company,
        locations: accessibleLocations,
        userHasFeature,
        userHasFeatureAtLocation,
        role: user?.role,
      })),
  [accessibleLocations, userHasFeature, userHasFeatureAtLocation, user?.role]);

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
      refreshLocations,
      refreshModuleAccess,
      moduleAccess,
      allLocations,
      accessibleLocations,
      companyId,
      canAccessLocation,
      canAccessCommissary,
      getManagedCommissaryLocationIds,
      userPermission,
      featurePermissions,
      hasRoasteryLocation,
      userHasFeature,
      userHasFeatureAtLocation,
      hasRoasteryPermission,
      isFeatureEnabledForLocation,
      isFeatureEnabledAnywhere,
      accessibleLocationsForFeature
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
