export default function ProgressBar({ completed, total, className = "" }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${pct}%`,
            backgroundColor: pct === 100 ? 'hsl(var(--success))' : 'hsl(var(--primary))',
          }}
        />
      </div>
      <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
        {completed}/{total}
      </span>
    </div>
  );
}