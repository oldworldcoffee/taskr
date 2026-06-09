import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Phone, Mail, MessageCircle, Users } from "lucide-react";
import UserAvatar from "@/components/shared/UserAvatar";

export default function EmployeeDirectory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ["directory-users"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getCompanyUsers", {});
      return res.data?.users || [];
    },
    enabled: !!user,
  });

  // Exclude self
  const colleagues = allUsers.filter((u) => u.id !== user?.id);

  const filtered = colleagues.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.full_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.phone_number?.toLowerCase().includes(q)
    );
  });

  const handleDM = (colleague) => {
    navigate("/chat", { state: { dmEmail: colleague.email } });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Team Directory</h2>
        <p className="text-sm text-muted-foreground mt-1">{colleagues.length} team member{colleagues.length !== 1 ? "s" : ""}</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16">
          <Users className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">
            {search ? "No team members found." : "No other team members yet."}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((colleague) => (
          <div
            key={colleague.id}
            className="bg-card border border-border rounded-xl p-4 flex items-center gap-4"
          >
            <UserAvatar
              name={colleague.full_name}
              email={colleague.email}
              avatarUrl={colleague.avatar_url}
              size="lg"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{colleague.full_name || colleague.email}</p>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{colleague.email}</span>
              </div>
              {colleague.phone_number && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                  <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                  <a href={`tel:${colleague.phone_number}`} className="hover:text-primary transition-colors">
                    {colleague.phone_number}
                  </a>
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 gap-1.5"
              onClick={() => handleDM(colleague)}
            >
              <MessageCircle className="h-4 w-4" />
              DM
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}