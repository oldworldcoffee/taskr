import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, Unplug, Plug } from "lucide-react";

export default function ConnectSquareButton({ tenantId, connected, onDisconnect }) {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    const baseUrl = window.location.origin;
    const res = await base44.functions.invoke("squareOAuth", { action: "get_auth_url", company_id: tenantId, base_url: baseUrl });
    if (res.data?.auth_url) {
      window.location.href = res.data.auth_url;
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    await base44.functions.invoke("squareOAuth", { action: "disconnect", company_id: tenantId });
    setLoading(false);
    onDisconnect?.();
  };

  if (connected) {
    return (
      <Button variant="outline" onClick={handleDisconnect} disabled={loading} className="gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
        Disconnect Square
      </Button>
    );
  }

  return (
    <Button onClick={handleConnect} disabled={loading} className="gap-2">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
      Connect Square
    </Button>
  );
}