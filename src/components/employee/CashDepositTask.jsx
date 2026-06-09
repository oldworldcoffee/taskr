import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import UserAvatar from "@/components/shared/UserAvatar";
import { Check, Flag } from "lucide-react";

export default function CashDepositTask({ task, completion, instanceId, locationId, companyId, user, onComplete, onFlag }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [expectedAmount, setExpectedAmount] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [notes, setNotes] = useState("");
  
  // Bills
  const [bills, setBills] = useState({
    hundred: 0, fifty: 0, twenty: 0, ten: 0, five: 0, two: 0, one: 0
  });
  
  // Coins
  const [coins, setCoins] = useState({
    dollar: 0, quarter: 0, dime: 0, nickel: 0, penny: 0
  });
  
  // Rolled coins
  const [rolledCoins, setRolledCoins] = useState({
    dollars: 0, quarters: 0, dimes: 0, nickels: 0, pennies: 0
  });
  
  const [submitting, setSubmitting] = useState(false);

  const billValues = { hundred: 100, fifty: 50, twenty: 20, ten: 10, five: 5, two: 2, one: 1 };
  const coinValues = { dollar: 1, quarter: 0.25, dime: 0.1, nickel: 0.05, penny: 0.01 };
  const rolledValues = { dollars: 25, quarters: 10, dimes: 5, nickels: 2, pennies: 0.5 };

  const billsTotal = Object.entries(bills).reduce((sum, [key, count]) => sum + (count * billValues[key]), 0);
  const coinsTotal = Object.entries(coins).reduce((sum, [key, count]) => sum + (count * coinValues[key]), 0);
  const rolledTotal = Object.entries(rolledCoins).reduce((sum, [key, count]) => sum + (count * rolledValues[key]), 0);
  const totalCash = billsTotal + coinsTotal + rolledTotal;
  const actual = parseFloat(actualAmount) || 0;
  const depositAmount = actual - 200;
  const overShort = actual - (parseFloat(expectedAmount) || 0);

  const handleSubmit = async () => {
    if (!expectedAmount || !actualAmount) return;
    setSubmitting(true);
    
    const receipt = await base44.entities.CashDepositReceipt.create({
      instance_id: instanceId,
      task_id: task.id,
      company_id: user.company_id || companyId,
      location_id: locationId,
      date,
      initials: (user.full_name || user.email).split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 3),
      expected_amount: parseFloat(expectedAmount),
      actual_amount: actual,
      deposit_amount: depositAmount,
      over_short: overShort,
      bills,
      coins,
      rolled_coins: rolledCoins,
      notes: notes.trim(),
      completed_by_email: user.email,
      completed_by_name: user.full_name || user.email,
    });
    
    await onComplete(task.id, receipt.id);
    setDialogOpen(false);
    setSubmitting(false);
  };

  const isCompleted = !!completion;

  return (
    <div className="py-4 border-b border-border/50">
      <div className="flex items-start justify-between">
        <div>
          <h3 className={`font-medium text-base ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </h3>
          {task.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{task.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {!isCompleted && (
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Check className="h-4 w-4" /> Start Deposit
            </Button>
          )}
          {!isCompleted && (
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => onFlag(task.id)}>
              <Flag className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {isCompleted && (
        <div className="mt-3 flex items-center gap-2">
          <UserAvatar name={completion.completed_by_name} size="xs" />
          <span className="text-xs text-muted-foreground">
            {completion.completed_by_name} · {format(new Date(completion.created_date), "h:mm a")}
          </span>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cash Deposit Receipt</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Deposit Information */}
            <div className="space-y-3 border-b pb-4">
              <h3 className="font-semibold text-sm text-primary">Deposit Information</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Date</label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Amounts */}
            <div className="space-y-3 border-b pb-4">
              <h3 className="font-semibold text-sm text-primary">Amounts</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Expected Amount ($)</label>
                  <Input type="number" step="0.01" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Actual Amount ($)</label>
                  <Input type="number" step="0.01" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Over/Short ($)</label>
                  <div className={`px-3 py-2 rounded-md border text-sm font-medium ${overShort >= 0 ? "text-success" : "text-destructive"}`}>
                    {overShort >= 0 ? "+" : ""}{overShort.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* Bills */}
            <div className="space-y-3 border-b pb-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-primary">Bills</h3>
                <span className="text-sm font-medium">${billsTotal.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "hundred", label: "$100" },
                  { key: "fifty", label: "$50" },
                  { key: "twenty", label: "$20" },
                  { key: "ten", label: "$10" },
                  { key: "five", label: "$5" },
                  { key: "two", label: "$2" },
                  { key: "one", label: "$1" }
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs w-8 text-muted-foreground">{label}</span>
                    <Input
                      type="number"
                      min="0"
                      value={bills[key]}
                      onChange={(e) => setBills({ ...bills, [key]: parseInt(e.target.value) || 0 })}
                      className="h-8"
                    />
                    <span className="text-xs w-12 text-right">${(bills[key] * billValues[key]).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Coins */}
            <div className="space-y-3 border-b pb-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-primary">Coins</h3>
                <span className="text-sm font-medium">${coinsTotal.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "dollar", label: "$1" },
                  { key: "quarter", label: "$0.25" },
                  { key: "dime", label: "$0.10" },
                  { key: "nickel", label: "$0.05" },
                  { key: "penny", label: "$0.01" }
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs w-12 text-muted-foreground">{label}</span>
                    <Input
                      type="number"
                      min="0"
                      value={coins[key]}
                      onChange={(e) => setCoins({ ...coins, [key]: parseInt(e.target.value) || 0 })}
                      className="h-8"
                    />
                    <span className="text-xs w-12 text-right">${(coins[key] * coinValues[key]).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rolled Coins */}
            <div className="space-y-3 border-b pb-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-primary">Rolled Coins</h3>
                <span className="text-sm font-medium">${rolledTotal.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "dollars", label: "Dollars ($25)" },
                  { key: "quarters", label: "Quarters ($10)" },
                  { key: "dimes", label: "Dimes ($5)" },
                  { key: "nickels", label: "Nickels ($2)" },
                  { key: "pennies", label: "Pennies ($0.50)" }
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex-1">{label}</span>
                    <Input
                      type="number"
                      min="0"
                      value={rolledCoins[key]}
                      onChange={(e) => setRolledCoins({ ...rolledCoins, [key]: parseInt(e.target.value) || 0 })}
                      className="h-8 w-16"
                    />
                    <span className="text-xs w-12 text-right">${(rolledCoins[key] * rolledValues[key]).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="space-y-2 bg-muted/50 p-4 rounded-lg">
              <div className="flex justify-between text-sm">
                <span>Total Cash:</span>
                <span className="font-semibold">${totalCash.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Deposit Amount (Actual - $200 drawer):</span>
                <span className="font-semibold">${depositAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes or discrepancies..."
                className="min-h-20"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!expectedAmount || !actualAmount || submitting}
            >
              {submitting ? "Saving..." : "Complete Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}