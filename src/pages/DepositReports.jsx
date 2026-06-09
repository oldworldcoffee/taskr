import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function DepositReports() {
  const { user } = useAuth();
  const [locationId, setLocationId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: user.company_id }),
  });

  const { data: receipts = [] } = useQuery({
    queryKey: ["deposits", locationId, user.company_id],
    queryFn: () => base44.entities.CashDepositReceipt.filter(locationId ? { location_id: locationId, company_id: user.company_id } : { company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  const filteredReceipts = locationId
    ? receipts.filter(r => r.location_id === locationId)
    : receipts;

  const handleDownloadPDF = (receipt) => {
    // Generate simple PDF-like HTML and print
    const billsTotal = Object.entries(receipt.bills || {}).reduce((sum, [key, count]) => {
      const values = { hundred: 100, fifty: 50, twenty: 20, ten: 10, five: 5, two: 2, one: 1 };
      return sum + (count * values[key]);
    }, 0);

    const coinsTotal = Object.entries(receipt.coins || {}).reduce((sum, [key, count]) => {
      const values = { dollar: 1, quarter: 0.25, dime: 0.1, nickel: 0.05, penny: 0.01 };
      return sum + (count * values[key]);
    }, 0);

    const rolledTotal = Object.entries(receipt.rolled_coins || {}).reduce((sum, [key, count]) => {
      const values = { dollars: 25, quarters: 10, dimes: 5, nickels: 2, pennies: 0.5 };
      return sum + (count * values[key]);
    }, 0);

    const totalCash = billsTotal + coinsTotal + rolledTotal;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cash Deposit Receipt</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { background: #333; color: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
          .title { font-size: 24px; font-weight: bold; }
          .subtitle { font-size: 14px; }
          .section { margin: 20px 0; border-bottom: 1px solid #ddd; padding-bottom: 15px; }
          .section-title { font-size: 14px; font-weight: bold; color: #d4a574; text-transform: uppercase; }
          .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
          .label { font-weight: bold; }
          .amount { text-align: right; }
          .subtotal { border-top: 1px solid #999; padding-top: 5px; margin-top: 5px; font-weight: bold; }
          .total { background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 16px; font-weight: bold; margin: 20px 0; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">CASH DEPOSIT RECEIPT</div>
          <div class="subtitle">Old World Coffee Roasters</div>
        </div>

        <div class="grid">
          <div>
            <div class="section">
              <div class="section-title">Deposit Information</div>
              <div class="row">
                <span class="label">Date:</span>
                <span>${receipt.date || 'N/A'}</span>
              </div>
              <div class="row">
                <span class="label">Initials:</span>
                <span>${receipt.initials || 'N/A'}</span>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Amounts</div>
              <div class="row">
                <span class="label">Expected Amount:</span>
                <span class="amount">$${(receipt.expected_amount || 0).toFixed(2)}</span>
              </div>
              <div class="row">
                <span class="label">Actual Amount:</span>
                <span class="amount">$${(receipt.actual_amount || 0).toFixed(2)}</span>
              </div>
              <div class="row">
                <span class="label">Deposit Amount:</span>
                <span class="amount">$${(receipt.deposit_amount || 0).toFixed(2)}</span>
              </div>
              <div class="row" style="color: ${receipt.over_short >= 0 ? '#22c55e' : '#ef4444'}">
                <span class="label">Over/Short:</span>
                <span class="amount">$${(receipt.over_short || 0).toFixed(2)}</span>
              </div>
            </div>

            ${receipt.notes ? `<div class="section">
              <div class="section-title">Notes</div>
              <div>${receipt.notes}</div>
            </div>` : ''}
          </div>

          <div>
            <div class="section">
              <div class="section-title">Bills</div>
              ${[100, 50, 20, 10, 5, 2, 1].map((val, idx) => {
                const keys = ['hundred', 'fifty', 'twenty', 'ten', 'five', 'two', 'one'];
                const count = receipt.bills?.[keys[idx]] || 0;
                return `<div class="row"><span>$${val}</span><span>x ${count} = $${(count * val).toFixed(2)}</span></div>`;
              }).join('')}
              <div class="row subtotal">
                <span>Bills Subtotal:</span>
                <span>$${billsTotal.toFixed(2)}</span>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Coins</div>
              <div class="row"><span>$1.00</span><span>x ${receipt.coins?.dollar || 0} = $${((receipt.coins?.dollar || 0) * 1).toFixed(2)}</span></div>
              <div class="row"><span>$0.25</span><span>x ${receipt.coins?.quarter || 0} = $${((receipt.coins?.quarter || 0) * 0.25).toFixed(2)}</span></div>
              <div class="row"><span>$0.10</span><span>x ${receipt.coins?.dime || 0} = $${((receipt.coins?.dime || 0) * 0.1).toFixed(2)}</span></div>
              <div class="row"><span>$0.05</span><span>x ${receipt.coins?.nickel || 0} = $${((receipt.coins?.nickel || 0) * 0.05).toFixed(2)}</span></div>
              <div class="row"><span>$0.01</span><span>x ${receipt.coins?.penny || 0} = $${((receipt.coins?.penny || 0) * 0.01).toFixed(2)}</span></div>
              <div class="row subtotal">
                <span>Coins Subtotal:</span>
                <span>$${coinsTotal.toFixed(2)}</span>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Rolled Coins</div>
              <div class="row"><span>Dollars ($25)</span><span>x ${receipt.rolled_coins?.dollars || 0} = $${((receipt.rolled_coins?.dollars || 0) * 25).toFixed(2)}</span></div>
              <div class="row"><span>Quarters ($10)</span><span>x ${receipt.rolled_coins?.quarters || 0} = $${((receipt.rolled_coins?.quarters || 0) * 10).toFixed(2)}</span></div>
              <div class="row"><span>Dimes ($5)</span><span>x ${receipt.rolled_coins?.dimes || 0} = $${((receipt.rolled_coins?.dimes || 0) * 5).toFixed(2)}</span></div>
              <div class="row"><span>Nickels ($2)</span><span>x ${receipt.rolled_coins?.nickels || 0} = $${((receipt.rolled_coins?.nickels || 0) * 2).toFixed(2)}</span></div>
              <div class="row"><span>Pennies ($0.50)</span><span>x ${receipt.rolled_coins?.pennies || 0} = $${((receipt.rolled_coins?.pennies || 0) * 0.5).toFixed(2)}</span></div>
              <div class="row subtotal">
                <span>Rolled Subtotal:</span>
                <span>$${rolledTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="total">
          TOTAL CASH: $${totalCash.toFixed(2)}
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open("", "", "width=800,height=600");
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/dashboard">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Cash Deposit Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">View and manage all cash deposit receipts</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by location..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>All Locations</SelectItem>
            {locations.map(loc => (
              <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4">
        {filteredReceipts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No deposit receipts found
            </CardContent>
          </Card>
        ) : (
          filteredReceipts.map((receipt) => {
            const billsTotal = Object.entries(receipt.bills || {}).reduce((sum, [key, count]) => {
              const values = { hundred: 100, fifty: 50, twenty: 20, ten: 10, five: 5, two: 2, one: 1 };
              return sum + (count * values[key]);
            }, 0);

            const coinsTotal = Object.entries(receipt.coins || {}).reduce((sum, [key, count]) => {
              const values = { dollar: 1, quarter: 0.25, dime: 0.1, nickel: 0.05, penny: 0.01 };
              return sum + (count * values[key]);
            }, 0);

            const rolledTotal = Object.entries(receipt.rolled_coins || {}).reduce((sum, [key, count]) => {
              const values = { dollars: 25, quarters: 10, dimes: 5, nickels: 2, pennies: 0.5 };
              return sum + (count * values[key]);
            }, 0);

            const totalCash = billsTotal + coinsTotal + rolledTotal;

            return (
              <Card key={receipt.id}>
                <CardHeader className="flex flex-row items-start justify-between pb-3">
                  <div>
                    <CardTitle className="text-base">{format(new Date(receipt.date), "MMM d, yyyy")}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {receipt.completed_by_name} · Initials: {receipt.initials}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setSelectedReceipt(receipt); setDetailOpen(true); }}
                    >
                      <Eye className="h-4 w-4 mr-1" /> View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadPDF(receipt)}
                    >
                      <Download className="h-4 w-4 mr-1" /> Print
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Expected</p>
                      <p className="font-semibold">${(receipt.expected_amount || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Actual</p>
                      <p className="font-semibold">${(receipt.actual_amount || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Deposit</p>
                      <p className="font-semibold">${(receipt.deposit_amount || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Over/Short</p>
                      <p className={`font-semibold ${receipt.over_short >= 0 ? "text-success" : "text-destructive"}`}>
                        {receipt.over_short >= 0 ? "+" : ""}{(receipt.over_short || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {selectedReceipt && (
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Deposit Receipt - {format(new Date(selectedReceipt.date), "MMM d, yyyy")}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4 pb-4 border-b">
                <div>
                  <p className="text-muted-foreground">Date</p>
                  <p className="font-medium">{selectedReceipt.date}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Initials</p>
                  <p className="font-medium">{selectedReceipt.initials}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pb-4 border-b">
                <div>
                  <p className="text-muted-foreground">Expected Amount</p>
                  <p className="font-medium">${(selectedReceipt.expected_amount || 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Actual Amount</p>
                  <p className="font-medium">${(selectedReceipt.actual_amount || 0).toFixed(2)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pb-4 border-b">
                <div>
                  <p className="text-muted-foreground">Deposit Amount</p>
                  <p className="font-medium">${(selectedReceipt.deposit_amount || 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Over/Short</p>
                  <p className={`font-medium ${selectedReceipt.over_short >= 0 ? "text-success" : "text-destructive"}`}>
                    {selectedReceipt.over_short >= 0 ? "+" : ""}{(selectedReceipt.over_short || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {selectedReceipt.notes && (
                <div className="pb-4 border-b">
                  <p className="text-muted-foreground">Notes</p>
                  <p className="font-medium">{selectedReceipt.notes}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}