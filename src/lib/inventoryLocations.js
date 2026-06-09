export function enrichLocationsWithInventorySettings(locations = [], settings = []) {
  const settingsByLocationId = new Map(
    (settings || []).map((setting) => [setting.location_id, setting])
  );

  return (locations || []).map((location) => {
    const setting = settingsByLocationId.get(location.id);
    const inventoryType = setting?.type || location.type || 'location';

    return {
      ...location,
      inventory_settings: setting || null,
      inventory_type: inventoryType,
      type: inventoryType,
    };
  });
}

export function isCommissaryLocation(location) {
  return (location?.inventory_type || location?.type) === 'commissary';
}

export function getVendorCommissaryLocationId(vendor, locations = []) {
  const directLocationId = vendor?.commissary_location_id || vendor?.commissioned_location_id;
  if (directLocationId) return directLocationId;
  if (!vendor?.is_commissary) return null;

  const vendorName = vendor.name?.toLowerCase();
  const vendorEmail = vendor.email?.toLowerCase();
  const matchingLocation = locations.find((location) => {
    if (!isCommissaryLocation(location)) return false;
    return (
      (vendorName && location.name?.toLowerCase() === vendorName) ||
      (vendorEmail && location.email?.toLowerCase() === vendorEmail)
    );
  });

  return matchingLocation?.id || null;
}
