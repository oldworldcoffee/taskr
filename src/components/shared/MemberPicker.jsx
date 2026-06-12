import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";

/**
 * Multi-select picker over the company's users, keyed by email.
 * `selected` is an array of emails; `onChange` receives a functional updater
 * (prev => next), matching React's setState signature.
 * Pass `currentUserEmail` to exclude the current user from the list.
 */
export default function MemberPicker({
  allUsers = [],
  selected = [],
  onChange,
  currentUserEmail,
  placeholder = "Search employees...",
}) {
  const [search, setSearch] = useState("");
  const filtered = allUsers.filter(
    (u) =>
      u.email !== currentUserEmail &&
      (u.full_name || u.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (email) => {
    onChange((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  };

  return (
    <div className="space-y-2">
      <Input
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((email) => {
            const u = allUsers.find((x) => x.email === email);
            return (
              <span
                key={email}
                className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium"
              >
                {u?.full_name || email}
                <button onClick={() => toggle(email)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto border rounded-lg p-1 space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">
            No employees found
          </p>
        ) : (
          filtered.map((u) => (
            <label
              key={u.email}
              className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={selected.includes(u.email)}
                onCheckedChange={() => toggle(u.email)}
              />
              <div>
                <p className="text-sm font-medium">{u.full_name || u.email}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
