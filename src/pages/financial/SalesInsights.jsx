import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAppContext } from "@/components/financial/FinancialContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TrendingUp, Calendar, DollarSign, Loader2, AlertCircle, Clock } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function SalesInsights() {
  const { tenant, activeLocations, laborSettings } = useAppContext();
  const [selectedLocation, setSelectedLocation] = useState("");
  const [activeTab, setActiveTab] = useState("Q1");
  const [salesData, setSalesData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Set initial location when locations are loaded
  useEffect(() => {
    if (activeLocations.length > 0 && !selectedLocation) {
      setSelectedLocation(activeLocations[0].id);
    }
  }, [activeLocations]);

  useEffect(() => {
    if (selectedLocation) {
      fetchSalesData();
    }
  }, [selectedLocation, activeTab]);

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const location = activeLocations.find(l => l.id === selectedLocation);
      const metric = activeTab === "rolling" ? "rolling_3_week" : "quarterly";
      const res = await base44.functions.invoke("squareSalesData", {
        company_id: tenant.id,
        location_id: location.square_location_id,
        metric: metric,
        quarter: activeTab,
        timezone: location.timezone || 'America/Los_Angeles',
        force_refresh: true
      });
      setSalesData(res.data);
    } catch (err) {
      setError(err.message || "Failed to refresh sales data");
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesData = async () => {
    setLoading(true);
    setError(null);
    try {
      const location = activeLocations.find(l => l.id === selectedLocation);
      const metric = activeTab === "rolling" ? "rolling_3_week" : "quarterly";
      const res = await base44.functions.invoke("squareSalesData", {
        company_id: tenant.id,
        location_id: location.square_location_id,
        metric: metric,
        quarter: activeTab,
        timezone: location.timezone || 'America/Los_Angeles',
        force_refresh: false
      });
      setSalesData(res.data);
    } catch (err) {
      setError(err.message || "Failed to load sales data");
    } finally {
      setLoading(false);
    }
  };

  const prepareChartData = () => {
    if (!salesData?.by_day_hour) return [];
    
    return DAYS.map((day, dayIndex) => {
      const dayData = { name: day };
      HOURS.forEach(hour => {
        const key = `${dayIndex}-${hour}`;
        dayData[`hour_${hour}`] = salesData.by_day_hour[key] || 0;
      });
      // Calculate daily total
      dayData.daily_total = HOURS.reduce((sum, hour) => sum + (dayData[`hour_${hour}`] || 0), 0);
      return dayData;
    });
  };

  const prepareHourlyTotals = () => {
    if (!salesData?.by_day_hour) return [];
    
    return HOURS.map(hour => {
      let total = 0;
      let daysWithActivity = 0;
      for (let day = 0; day < 7; day++) {
        const key = `${day}-${hour}`;
        const val = salesData.by_day_hour[key] || 0;
        if (val > 0) {
          total += val;
          daysWithActivity++;
        }
      }
      return { hour: `${hour}:00`, total: daysWithActivity > 0 ? total / daysWithActivity : 0 };
    });
  };

  if (!tenant?.square_connected) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Square Not Connected
            </CardTitle>
            <CardDescription>
              Connect your Square account to view sales insights
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const chartData = prepareChartData();
  const hourlyTotals = prepareHourlyTotals();

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Sales Insights</h1>
          <p className="text-muted-foreground">Historical sales patterns by day and hour</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{(() => {
              const tz = activeLocations?.find(l => l.id === selectedLocation)?.timezone || 'America/Los_Angeles';
              const tzMap = {
                'America/Los_Angeles': 'Pacific Time (PT)',
                'America/Denver': 'Mountain Time (MT)',
                'America/Chicago': 'Central Time (CT)',
                'America/New_York': 'Eastern Time (ET)'
              };
              return tzMap[tz] || tz;
            })()}</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <Loader2 className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {activeLocations.length > 1 && (
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {activeLocations.map(loc => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="Q1">
            <Calendar className="w-4 h-4 mr-2" />
            Q1
          </TabsTrigger>
          <TabsTrigger value="Q2">
            <Calendar className="w-4 h-4 mr-2" />
            Q2
          </TabsTrigger>
          <TabsTrigger value="Q3">
            <Calendar className="w-4 h-4 mr-2" />
            Q3
          </TabsTrigger>
          <TabsTrigger value="Q4">
            <Calendar className="w-4 h-4 mr-2" />
            Q4
          </TabsTrigger>
          <TabsTrigger value="rolling">
            <TrendingUp className="w-4 h-4 mr-2" />
            Rolling 3-Week
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="ml-2">Refreshing sales data...</span>
            </div>
          )}

          {error && (
            <Card>
              <CardContent className="py-6">
                <div className="text-destructive">{error}</div>
              </CardContent>
            </Card>
          )}

          {!loading && !error && salesData && (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Avg Daily Sales</CardDescription>
                    <CardTitle className="text-2xl">
                      <DollarSign className="inline w-5 h-5" />
                      {salesData.avg_daily_sales?.toFixed(2) || "0.00"}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Avg Hourly Sales (Peak)</CardDescription>
                    <CardTitle className="text-2xl">
                      <DollarSign className="inline w-5 h-5" />
                      {salesData.peak_hourly_avg?.toFixed(2) || "0.00"}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Data Period</CardDescription>
                    <CardTitle className="text-2xl text-sm font-normal">
                      {activeTab === "rolling"
                        ? "Last 3 weeks (daily avg)"
                        : `${activeTab} ${new Date().getFullYear() - 1} (${salesData?.weeks_used || 13} weeks, trimmed avg)`}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Daily Sales Patterns</CardTitle>
                  <CardDescription>Average net sales by day of week</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                      <Legend />
                      <Bar dataKey="daily_total" name="Daily Total" fill="#6366f1" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Hourly Sales Patterns</CardTitle>
                  <CardDescription>Average net sales per hour (across days with activity)</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={hourlyTotals}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" />
                      <YAxis />
                      <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                      <Bar dataKey="total" name="Hourly Total" fill="#6366f1" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}