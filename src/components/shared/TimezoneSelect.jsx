import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

// Radix Select items cannot use an empty-string value.
export const TIMEZONE_UNSET = 'unset';

export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || TIMEZONE_UNSET;
  } catch {
    return TIMEZONE_UNSET;
  }
}

function allTimezones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return COMMON_TIMEZONES;
  }
}

function labelFor(zone) {
  return zone.replace(/_/g, ' ');
}

export default function TimezoneSelect({ value, onChange, placeholder = 'Not set (UTC)' }) {
  const otherZones = useMemo(
    () => allTimezones().filter((zone) => !COMMON_TIMEZONES.includes(zone)),
    []
  );

  return (
    <Select value={value || TIMEZONE_UNSET} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={TIMEZONE_UNSET}>{placeholder}</SelectItem>
        <SelectGroup>
          <SelectLabel>Common</SelectLabel>
          {COMMON_TIMEZONES.map((zone) => (
            <SelectItem key={zone} value={zone}>
              {labelFor(zone)}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>All timezones</SelectLabel>
          {otherZones.map((zone) => (
            <SelectItem key={zone} value={zone}>
              {labelFor(zone)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
