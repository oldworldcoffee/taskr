import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  pushSupported,
  pushConfigured,
  isPushEnabled,
  enablePush,
  disablePush,
} from "@/lib/push";

export default function PushToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  const supported = pushSupported();
  const configured = pushConfigured();

  useEffect(() => {
    let active = true;
    (async () => {
      if (supported) {
        const on = await isPushEnabled().catch(() => false);
        if (active) setEnabled(on);
      }
      if (active) setChecked(true);
    })();
    return () => {
      active = false;
    };
  }, [supported]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        toast.success("Push notifications turned off");
      } else {
        await enablePush();
        setEnabled(true);
        toast.success("Push notifications turned on");
      }
    } catch (e) {
      toast.error(e.message || "Could not update push notifications");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <p className="text-sm text-muted-foreground">
        Push notifications aren't supported on this device or browser.
      </p>
    );
  }

  if (!configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Push notifications aren't set up for this app yet.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        {enabled ? (
          <Bell className="h-5 w-5 text-primary mt-0.5" />
        ) : (
          <BellOff className="h-5 w-5 text-muted-foreground mt-0.5" />
        )}
        <div>
          <p className="text-sm font-medium">Push notifications</p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "On for this device. You'll get a push when something is completed."
              : "Get notified on this device, even when the app is closed."}
          </p>
        </div>
      </div>
      <Button
        variant={enabled ? "outline" : "default"}
        size="sm"
        onClick={toggle}
        disabled={busy || !checked}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}
