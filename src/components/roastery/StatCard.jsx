import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function StatCard({ title, value, subtitle, icon: Icon, trend, className }) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-semibold text-foreground mt-1.5">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            {trend && (
              <p className={cn('text-xs mt-1 font-medium', trend.positive ? 'text-green-600' : 'text-red-500')}>
                {trend.label}
              </p>
            )}
          </div>
          {Icon && (
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
              <Icon className="w-4.5 h-4.5 text-accent-foreground" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}