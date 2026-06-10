import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import UserAvatar from "@/components/shared/UserAvatar";
import { Check, Flag, Minus, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const DEFAULT_DRAWER_AMOUNT = 200;

function parseConfiguredAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export default function CashDepositTask({ task, completion, instanceId, locationId, companyId, user, onComplete, onFlag }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [expectedAmount, setExpectedAmount] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [countTouched, setCountTouched] = useState(false);
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
  const drawerCompanyId = user?.company_id || companyId;

  const { data: location, isLoading: locationLoading } = useQuery({
    queryKey: ["cash-deposit-location", locationId],
    queryFn: () => base44.entities.Location.filter({ id: locationId }).then((rows) => rows[0] || null),
    enabled: !!locationId,
  });

  const { data: company, isLoading: companyLoading } = useQuery({
    queryKey: ["cash-deposit-company", drawerCompanyId],
    queryFn: () => base44.entities.Company.filter({ id: drawerCompanyId }).then((rows) => rows[0] || null),
    enabled: !!drawerCompanyId,
  });

  const billValues = { hundred: 100, fifty: 50, twenty: 20, ten: 10, five: 5, two: 2, one: 1 };
  const coinValues = { dollar: 1, quarter: 0.25, dime: 0.1, nickel: 0.05, penny: 0.01 };
  const rolledValues = { dollars: 25, quarters: 10, dimes: 5, nickels: 2, pennies: 0.5 };

  const billsTotal = Object.entries(bills).reduce((sum, [key, count]) => sum + (count * billValues[key]), 0);
  const coinsTotal = Object.entries(coins).reduce((sum, [key, count]) => sum + (count * coinValues[key]), 0);
  const rolledTotal = Object.entries(rolledCoins).reduce((sum, [key, count]) => sum + (count * rolledValues[key]), 0);
  const totalCash = billsTotal + coinsTotal + rolledTotal;
  const actual = parseFloat(actualAmount) || 0;
  const locationDrawerAmount = parseConfiguredAmount(location?.cash_drawer_amount);
  const companyDrawerAmount = parseConfiguredAmount(company?.cash_drawer_amount);
  const drawerAmount = locationDrawerAmount ?? companyDrawerAmount ?? DEFAULT_DRAWER_AMOUNT;
  const drawerSettingsLoading = Boolean((locationId && locationLoading) || (drawerCompanyId && companyLoading));
  const depositAmount = actual - drawerAmount;
  const overShort = actual - (parseFloat(expectedAmount) || 0);

  useEffect(() => {
    if (countTouched) {
      setActualAmount(totalCash.toFixed(2));
    }
  }, [countTouched, totalCash]);

  const parseCount = (value) => Math.max(0, parseInt(value, 10) || 0);

  const updateCount = (setCounts, key, value) => {
    setCountTouched(true);
    setCounts((current) => ({ ...current, [key]: parseCount(value) }));
  };

  const adjustCount = (setCounts, key, delta) => {
    setCountTouched(true);
    setCounts((current) => ({
      ...current,
      [key]: Math.max(0, (current[key] || 0) + delta),
    }));
  };

  const preventNegativeEntry = (event) => {
    if (["-", "+", "e", "E"].includes(event.key)) {
      event.preventDefault();
    }
  };

  const CountRow = ({ label, detail, count, subtotal, onChange, onDecrement, onIncrement }) => (
    <div className="rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={onDecrement}
            disabled={count <= 0}
            aria-label={`Decrease ${label}`}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Input
            type="number"
            min="0"
            inputMode="numeric"
            pattern="[0-9]*"
            value={count}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={preventNegativeEntry}
            className="h-11 w-16 rounded-lg text-center text-base font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={onIncrement}
            aria-label={`Increase ${label}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="mt-2 text-right text-xs font-medium text-muted-foreground">
        ${subtotal.toFixed(2)}
      </div>
    </div>
  );

  const billOptions = [
    { key: "hundred", label: "$100 bills", value: billValues.hundred },
    { key: "fifty", label: "$50 bills", value: billValues.fifty },
    { key: "twenty", label: "$20 bills", value: billValues.twenty },
    { key: "ten", label: "$10 bills", value: billValues.ten },
    { key: "five", label: "$5 bills", value: billValues.five },
    { key: "two", label: "$2 bills", value: billValues.two },
    { key: "one", label: "$1 bills", value: billValues.one },
  ];

  const coinOptions = [
    { key: "dollar", label: "$1 coins", value: coinValues.dollar },
    { key: "quarter", label: "Quarters", value: coinValues.quarter },
    { key: "dime", label: "Dimes", value: coinValues.dime },
    { key: "nickel", label: "Nickels", value: coinValues.nickel },
    { key: "penny", label: "Pennies", value: coinValues.penny },
  ];

  const rolledCoinOptions = [
    { key: "dollars", label: "Dollar rolls", value: rolledValues.dollars },
    { key: "quarters", label: "Quarter rolls", value: rolledValues.quarters },
    { key: "dimes", label: "Dime rolls", value: rolledValues.dimes },
    { key: "nickels", label: "Nickel rolls", value: rolledValues.nickels },
    { key: "pennies", label: "Penny rolls", value: rolledValues.pennies },
  ];

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
      drawer_amount: drawerAmount,
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
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => onFlag && onFlag(task.id)}>
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
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6">
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Expected Amount ($)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={expectedAmount}
                    onChange={(e) => setExpectedAmount(e.target.value)}
                    onKeyDown={preventNegativeEntry}
                    className="h-11 text-base"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Actual Amount ($)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={actualAmount}
                    onChange={(e) => setActualAmount(e.target.value)}
                    onKeyDown={preventNegativeEntry}
                    className="h-11 text-base font-semibold"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Over/Short ($)</label>
                  <div className={`h-11 px-3 py-2 rounded-md border text-sm font-medium flex items-center ${overShort >= 0 ? "text-success" : "text-destructive"}`}>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {billOptions.map(({ key, label, value }) => (
                  <CountRow
                    key={key}
                    label={label}
                    detail={`$${value.toFixed(0)} each`}
                    count={bills[key]}
                    subtotal={bills[key] * value}
                    onChange={(nextValue) => updateCount(setBills, key, nextValue)}
                    onDecrement={() => adjustCount(setBills, key, -1)}
                    onIncrement={() => adjustCount(setBills, key, 1)}
                  />
                ))}
              </div>
            </div>

            {/* Coins */}
            <div className="space-y-3 border-b pb-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-primary">Coins</h3>
                <span className="text-sm font-medium">${coinsTotal.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {coinOptions.map(({ key, label, value }) => (
                  <CountRow
                    key={key}
                    label={label}
                    detail={`$${value.toFixed(2)} each`}
                    count={coins[key]}
                    subtotal={coins[key] * value}
                    onChange={(nextValue) => updateCount(setCoins, key, nextValue)}
                    onDecrement={() => adjustCount(setCoins, key, -1)}
                    onIncrement={() => adjustCount(setCoins, key, 1)}
                  />
                ))}
              </div>
            </div>

            {/* Rolled Coins */}
            <div className="space-y-3 border-b pb-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-primary">Rolled Coins</h3>
                <span className="text-sm font-medium">${rolledTotal.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {rolledCoinOptions.map(({ key, label, value }) => (
                  <CountRow
                    key={key}
                    label={label}
                    detail={`$${value.toFixed(2)} per roll`}
                    count={rolledCoins[key]}
                    subtotal={rolledCoins[key] * value}
                    onChange={(nextValue) => updateCount(setRolledCoins, key, nextValue)}
                    onDecrement={() => adjustCount(setRolledCoins, key, -1)}
                    onIncrement={() => adjustCount(setRolledCoins, key, 1)}
                  />
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="space-y-2 bg-muted/50 p-4 rounded-lg">
              <div className="flex justify-between text-sm">
                <span>Counted Cash:</span>
                <span className="font-semibold">${totalCash.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Deposit Amount (Actual - ${drawerAmount.toFixed(2)} drawer):</span>
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

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!expectedAmount || !actualAmount || submitting || drawerSettingsLoading}
              className="w-full sm:w-auto"
            >
              {submitting ? "Saving..." : "Complete Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
