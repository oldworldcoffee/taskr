// Unified per-location feature gating.
//
// A module shows for a user at a location only when it is enabled at all three
// layers: company (companies.enabled_features, unchanged) AND location (the new
// is_<module>_enabled flags) AND user (users.feature_permissions, via
// userHasFeature). The location flag can only NARROW access.
//
// The per-module company/user gates below intentionally mirror EXACTLY what each
// module enforces today (see DashboardLayout NavLinks + the route guards) so this
// layer never widens access:
//   * inventory  -> enabled_features.'inventory' AND userHasFeature('inventory')
//   * financial  -> userHasFeature('financial') only (no company gate today)
//   * roastery   -> (enabled_features.'roastery' OR a roastery/hybrid location)
//                   AND (userHasFeature('roastery') OR an admin/manager with such
//                   a location)
//   * task_checklist -> always on (core module, no company/user gate)

export const MODULE_FEATURES = ['task_checklist', 'inventory', 'roastery', 'financial'];

// Maps a feature key to its boolean column on the locations row.
export const FEATURE_LOCATION_FLAG = {
  task_checklist: 'is_task_checklist_enabled',
  inventory: 'is_inventory_enabled',
  roastery: 'is_roastery_enabled',
  financial: 'is_financial_enabled',
};

const ADMIN_ROLES = ['admin', 'manager', 'super_admin'];

function enabledFeatures(company) {
  return company?.enabled_features || [];
}

function hasRoasteryLocation(locations = []) {
  return locations.some((loc) => ['roastery', 'hybrid'].includes(loc?.location_type));
}

// Company-level gate, preserving today's behavior per module.
function companyAllows(feature, { company, locations = [] } = {}) {
  switch (feature) {
    case 'inventory':
      return enabledFeatures(company).includes('inventory');
    case 'roastery':
      return enabledFeatures(company).includes('roastery') || hasRoasteryLocation(locations);
    case 'financial':
    case 'task_checklist':
    default:
      return true;
  }
}

// User-level gate. Location-aware: prefers a per-location predicate
// (userHasFeatureAtLocation) bound to `locationId`, falling back to the global
// userHasFeature for callers that don't pass a location (e.g. brand-new company
// with no locations yet).
function userAllows(feature, { userHasFeatureAtLocation, userHasFeature, role, locationId = null, locations = [] } = {}) {
  const can = (f) => {
    if (typeof userHasFeatureAtLocation === 'function' && locationId != null) {
      return userHasFeatureAtLocation(f, locationId);
    }
    if (typeof userHasFeature === 'function') return userHasFeature(f);
    return false;
  };
  switch (feature) {
    case 'inventory':
      return can('inventory');
    case 'financial':
      return can('financial');
    case 'roastery':
      return can('roastery') || (hasRoasteryLocation(locations) && ADMIN_ROLES.includes(role));
    case 'task_checklist':
    default:
      return true;
  }
}

// Location flag. An absent column (undefined/null) is treated as ENABLED so the
// gate behaves correctly before the migration is applied and during transition;
// only an explicit `false` narrows access.
export function locationFlagEnabled(feature, location) {
  const flag = FEATURE_LOCATION_FLAG[feature];
  if (!flag) return true;
  const value = location?.[flag];
  if (value === undefined || value === null) return true;
  return Boolean(value);
}

// company AND location AND user, for one specific location.
// ctx: { company, locations, userHasFeature, role }
//   - company:        company-info object (with enabled_features)
//   - locations:      the user's accessible locations (for roastery auto-enable)
//   - userHasFeature: AuthContext.userHasFeature
//   - role:           user.role
export function isFeatureEnabledForLocation(feature, location, ctx = {}) {
  return (
    companyAllows(feature, ctx) &&
    locationFlagEnabled(feature, location) &&
    userAllows(feature, { ...ctx, locationId: location?.id })
  );
}

// True if the feature is enabled at ANY of the given (accessible) locations,
// checking the per-location user grant at each. Used for nav/route visibility;
// per-location filtering happens inside modules.
export function isFeatureEnabledAnywhere(feature, locations = [], ctx = {}) {
  const ctxWithLocations = { ...ctx, locations };
  if (!companyAllows(feature, ctxWithLocations)) return false;
  if (!locations.length) {
    // No locations yet: fall back to the global user gate (don't hide on a
    // brand-new company before any location exists).
    return userAllows(feature, ctxWithLocations);
  }
  return locations.some(
    (loc) =>
      locationFlagEnabled(feature, loc) &&
      userAllows(feature, { ...ctxWithLocations, locationId: loc?.id })
  );
}
