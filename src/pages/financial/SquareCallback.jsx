import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

// Square OAuth redirect lands here. The backend (financialSquareOAuth) scopes the
// token exchange to the authenticated user's company, so we only forward the code.
export default function SquareCallback() {
  const [status, setStatus] = useState("loading"); // loading | success | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      setStatus("error");
      setMessage(`Square error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`);
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("No authorization code received from Square.");
      return;
    }

    base44.functions
      .invoke("financialSquareOAuth", { action: "exchange_code", code })
      .then((res) => {
        if (res.data?.success) {
          setStatus("success");
          setMessage(`Square connected! ${res.data.locations_count || 0} location(s) synced.`);
        } else {
          setStatus("error");
          setMessage(res.data?.error || "Failed to connect Square.");
        }
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.message || "Something went wrong.");
      });
  }, []);

  return (
    <div className="flex items-center justify-center py-16 px-4">
      <div className="bg-card border border-border rounded-2xl shadow-sm p-10 w-full max-w-md text-center">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground">Connecting to Square…</h2>
            <p className="text-muted-foreground mt-2 text-sm">Finalizing the connection.</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground">Square Connected!</h2>
            <p className="text-muted-foreground mt-2 text-sm">{message}</p>
            <Link
              to="/dashboard/financial"
              className="mt-6 inline-block bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Go to Financial Dashboard →
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground">Connection Failed</h2>
            <p className="text-muted-foreground mt-2 text-sm">{message}</p>
            <Link
              to="/dashboard/financial/settings"
              className="mt-6 inline-block bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Back to Settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
