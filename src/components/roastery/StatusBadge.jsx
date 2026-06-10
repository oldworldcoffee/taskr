import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusConfig = {
  live_in_store: { label: 'Live In Store', classes: 'bg-green-100 text-green-800 border-green-200' },
  live_online: { label: 'Live Online', classes: 'bg-blue-100 text-blue-800 border-blue-200' },
  waiting_for_input: { label: 'Waiting For Input', classes: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  coming_soon: { label: 'Coming Soon', classes: 'bg-purple-100 text-purple-800 border-purple-200' },
  retired: { label: 'Retired', classes: 'bg-gray-100 text-gray-600 border-gray-200' },
  processing: { label: 'Processing', classes: 'bg-blue-100 text-blue-800 border-blue-200' },
  pending_review: { label: 'Pending Review', classes: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  approved: { label: 'Approved', classes: 'bg-green-100 text-green-800 border-green-200' },
  rejected: { label: 'Rejected', classes: 'bg-red-100 text-red-800 border-red-200' },
  active: { label: 'Active', classes: 'bg-green-100 text-green-800 border-green-200' },
};

export default function StatusBadge({ status, className }) {
  const config = statusConfig[status] || { label: status, classes: 'bg-gray-100 text-gray-600 border-gray-200' };
  return (
    <Badge variant="outline" className={cn('text-xs font-medium border', config.classes, className)}>
      {config.label}
    </Badge>
  );
}