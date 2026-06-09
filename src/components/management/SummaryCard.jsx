import { Card, CardContent } from "@/components/ui/card";

export default function SummaryCard({ title, value, icon: Icon, color = "text-primary" }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`h-12 w-12 rounded-xl flex items-center justify-center bg-primary/10 ${color}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}