import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';
import { useIsMobile } from '@/hooks/useIsMobile';

const asArray = (value) => Array.isArray(value) ? value : [];
const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const money = (value) => asNumber(value).toFixed(2);
const formatSentAt = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : format(date, 'MMM d, h:mm a');
};

export default function OrderHistory({ orders = [], locName, vendorName, onView, onEdit, onDelete }) {
  const isMobile = useIsMobile();
  const orderRows = asArray(orders);

  if (isMobile) {
    return (
      <div className="space-y-3">
        {orderRows.length === 0 ? (
          <div className="bg-card border border-border rounded-xl px-4 py-12 text-center text-muted-foreground text-sm">
            No orders yet. Create your first order using the "New Order" button.
          </div>
        ) : orderRows.map(o => (
          <div key={o.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono font-semibold text-sm">{o.order_number}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{locName(o.location_id)} · {vendorName(o.vendor_id)}</p>
              </div>
              <StatusBadge status={o.status} />
            </div>
            <div className="flex items-center justify-between text-sm border-t border-border pt-2">
              <span className="text-muted-foreground">{asArray(o.items).length} items{o.status === 'partial' && <span className="text-green-600 font-medium ml-1">({asArray(o.items).reduce((s, i) => s + asNumber(i.quantity_received), 0)} received)</span>}</span>
              <span className="font-semibold">${money(o.total_amount)}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => onView(o)}>
                <Eye className="w-3.5 h-3.5 mr-1" />View
              </Button>
              {o.status === 'draft' && (
                <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => onEdit(o)}>
                  <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                </Button>
              )}
              {(o.status === 'draft' || o.status === 'sent' || o.status === 'viewed') && (
                <Button variant="outline" size="sm" className="h-8 w-8 text-red-600 hover:text-red-700 px-0" onClick={() => onDelete(o)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {['Order #', 'Location', 'Vendor', 'Items', 'Total', 'Status', 'Sent', 'Actions'].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orderRows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                No orders yet. Create your first order using the "New Order" button.
              </td>
            </tr>
          ) : orderRows.map(o => (
            <tr key={o.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium font-mono">{o.order_number}</td>
              <td className="px-4 py-3">{locName(o.location_id)}</td>
              <td className="px-4 py-3">{vendorName(o.vendor_id)}</td>
              <td className="px-4 py-3">
                <div className="text-muted-foreground">{asArray(o.items).length} items</div>
                {o.status === 'partial' && (
                  <div className="text-xs text-green-600 font-medium">
                    {asArray(o.items).reduce((sum, item) => sum + asNumber(item.quantity_received), 0)} received
                  </div>
                )}
              </td>
              <td className="px-4 py-3 font-medium">${money(o.total_amount)}</td>
              <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
              <td className="px-4 py-3 text-muted-foreground text-xs">
                {formatSentAt(o.email_sent_at)}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {o.status === 'draft' && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(o)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(o.status === 'draft' || o.status === 'sent' || o.status === 'viewed') && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => onDelete(o)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onView(o)}>
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
