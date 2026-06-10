import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import GoogleIcon from "@/components/GoogleIcon";
import { toast } from "sonner";

export default function SelfEnroll() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const stepFromUrl = urlParams.get("step");

  const [step, setStep] = useState(stepFromUrl === "company" ? "company" : "register");
  const [loading, setLoading] = useState(false);
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  
  // Registration fields
  const [formData, setFormData] = useState({
    name: sessionStorage.getItem("enroll_full_name") || "",
    email: "",
    password: "",
    confirmPassword: "",
    companyName: sessionStorage.getItem("enroll_company_name") || ""
  });
  const [otpCode, setOtpCode] = useState("");

  // Check if user is already authenticated (e.g., via Google or after OTP hard-reload)
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const authenticated = await base44.auth.isAuthenticated();
        if (authenticated) {
          const user = await base44.auth.me();
          if (user) {
            setIsGoogleUser(!stepFromUrl); // only treat as google user if not coming from OTP redirect
            setFormData(prev => ({
              ...prev,
              name: prev.name || user.full_name || "",
              email: user.email || ""
            }));
            setStep("company");
          }
        }
      } catch (error) {
        // Not authenticated, stay on register step
      }
    };
    checkAuth();
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      // Register the user (sends OTP)
      await base44.auth.register({
        email: formData.email,
        password: formData.password
      });
      
      // Move to OTP verification step
      setStep("otp");
      toast.success("Registration successful! Please check your email for the verification code");
    } catch (error) {
      toast.error(error.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await base44.auth.verifyOtp({
        email: formData.email,
        otpCode
      });
      
      if (response.access_token) {
        base44.auth.setToken(response.access_token);
      }

      // Store company name so it survives the hard reload
      if (formData.companyName) {
        sessionStorage.setItem("enroll_company_name", formData.companyName);
      }
      if (formData.name) {
        sessionStorage.setItem("enroll_full_name", formData.name);
      }

      // Hard reload so the SDK re-initializes with the new auth token
      window.location.href = "/enroll?step=company";
    } catch (error) {
      toast.error(error.message || "Verification failed");
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    try {
      await base44.auth.resendOtp(formData.email);
      toast.success("Verification code resent! Check your email");
    } catch (error) {
      toast.error(error.message || "Failed to resend code");
    }
  };

  const handleCreateCompany = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await base44.functions.invoke('selfEnroll', { 
        companyName: formData.companyName,
        fullName: formData.name 
      });

      if (res.data?.error) {
        toast.error(res.data.error);
        return;
      }

      sessionStorage.removeItem("enroll_company_name");
      sessionStorage.removeItem("enroll_full_name");
      toast.success(res.data.message || "Company created!");
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1500);
    } catch (error) {
      toast.error(error.message || "Enrollment failed");
    } finally {
      setLoading(false);
    }
  };

  // Registration step
  if (step === "register") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center justify-center gap-3 mb-4">
              <img
                src="/taskr-logo.svg"
                alt="TaskrApp"
                className="h-10 w-10"
              />
              <span className="text-xl font-bold text-foreground">TaskrApp</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <Building2 className="h-8 w-8 text-primary" />
              <CardTitle>Create Your Account</CardTitle>
            </div>
            <CardDescription>
              Start your 15-day free trial — no credit card required
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="John Doe"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  placeholder="john@company.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  placeholder="••••••••"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                  placeholder="••••••••"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={formData.companyName}
                  onChange={(e) => setFormData({...formData, companyName: e.target.value})}
                  placeholder="Acme Inc."
                  required
                />
              </div>

              <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create Account"
                )}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-muted"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-12"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await base44.auth.loginWithProvider("google", "/enroll");
                  } catch (error) {
                    toast.error(error.message || "Google sign-in failed");
                    setLoading(false);
                  }
                }}
              >
                <GoogleIcon className="mr-2 h-4 w-4" />
                Google
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // OTP verification step
  if (step === "otp") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center justify-center gap-3 mb-4">
              <img
                src="/taskr-logo.svg"
                alt="TaskrApp"
                className="h-10 w-10"
              />
              <span className="text-xl font-bold text-foreground">TaskrApp</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <CardTitle>Verify Your Email</CardTitle>
            </div>
            <CardDescription>
              Enter the verification code sent to {formData.email}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="12345678"
                  required
                  maxLength={8}
                />
              </div>

              <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Email"
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  className="text-sm text-primary hover:underline"
                >
                  Resend code
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Company creation step (pre-filled with company name from registration)
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center justify-center gap-3 mb-4">
            <img
              src="/taskr-logo.svg"
              alt="TaskrApp"
              className="h-10 w-10"
            />
            <span className="text-xl font-bold text-foreground">TaskrApp</span>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="h-8 w-8 text-primary" />
            <CardTitle>Create Your Company</CardTitle>
          </div>
          <CardDescription>
            Confirm your company name to start the trial
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateCompany} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                value={formData.companyName}
                onChange={(e) => setFormData({...formData, companyName: e.target.value})}
                placeholder="Acme Inc."
                required
              />
            </div>

            <div className="bg-muted p-4 rounded-lg space-y-2">
              <h4 className="font-medium text-sm">Your trial includes:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Full access for 15 days
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Unlimited locations & employees
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  No credit card required
                </li>
              </ul>
            </div>

            <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating your company...
                </>
              ) : (
                "Start Free Trial"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
