import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Search, BookOpen, MessageSquare, MessageCircle, Users, X, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/AuthContext";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "kb", label: "Knowledge Base", icon: BookOpen },
  { key: "forum", label: "Message Board", icon: MessageSquare },
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "employees", label: "Employees", icon: Users },
];

export default function GlobalSearch({ isDashboard = false, onClose }) {
  const textClass = isDashboard ? "text-white" : "text-foreground";
  const mutedClass = isDashboard ? "text-white/60" : "text-muted-foreground";
  const placeholderClass = isDashboard ? "placeholder:text-white/50" : "placeholder:text-muted-foreground";
  const hoverClass = isDashboard ? "hover:bg-white/10" : "hover:bg-muted";
  const triggerClass = isDashboard ? "text-white border-white/30 bg-white/10" : "";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: articles = [] } = useQuery({ queryKey: ["kb-articles"], queryFn: () => base44.entities.KBArticle.filter({ company_id: user.company_id }), enabled: !!user?.company_id });
  const { data: posts = [] } = useQuery({ queryKey: ["forum-posts"], queryFn: () => base44.entities.ForumPost.filter({ company_id: user.company_id }), enabled: !!user?.company_id });
  const { data: messages = [] } = useQuery({ queryKey: ["chat-messages"], queryFn: () => base44.entities.ChatMessage.filter({ company_id: user.company_id }), enabled: !!user?.company_id });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: async () => { const res = await base44.functions.invoke("getCompanyUsers", {}); return res.data?.users || []; }, enabled: !!user?.company_id });

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const q = query.trim().toLowerCase();

  const results = q.length < 2 ? [] : [
    ...(filter === "all" || filter === "kb" ? articles.filter(a =>
      a.title?.toLowerCase().includes(q) || a.content?.toLowerCase().includes(q)
    ).map(a => ({ type: "kb", id: a.id, title: a.title, subtitle: "Knowledge Base", icon: FileText, action: () => { navigate(isDashboard ? "/dashboard/knowledge-base" : "/knowledge-base", { state: { openArticleId: a.id } }); onClose(); } })) : []),

    ...(filter === "all" || filter === "forum" ? posts.filter(p =>
      p.title?.toLowerCase().includes(q) || p.content?.toLowerCase().includes(q)
    ).map(p => ({ type: "forum", id: p.id, title: p.title, subtitle: `Message Board · ${p.author_name || p.author_email}`, icon: MessageSquare, action: () => { navigate(isDashboard ? "/dashboard/forum" : "/forum"); onClose(); } })) : []),

    ...(filter === "all" || filter === "chat" ? messages.filter(m =>
      m.content?.toLowerCase().includes(q)
    ).map(m => ({ type: "chat", id: m.id, title: m.content.slice(0, 80), subtitle: `Chat · ${m.author_name || m.author_email}`, icon: MessageCircle, action: () => { navigate(isDashboard ? "/dashboard/chat" : "/chat"); onClose(); } })) : []),

    ...(filter === "all" || filter === "employees" ? users.filter(u =>
      u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
    ).map(u => ({ type: "employees", id: u.id, title: u.full_name || u.email, subtitle: `Employee · ${u.role || ""}`, icon: Users, action: () => { if (isDashboard) navigate("/dashboard/employees"); onClose(); } })) : []),
  ].slice(0, 20);

  return (
    <div className="flex flex-col h-full">
      {/* Search Input */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search everything..."
          className={`flex-1 bg-transparent outline-none text-sm ${textClass} ${placeholderClass}`}
        />
        {query && (
          <button onClick={() => setQuery("")} className={mutedClass}>
            <X className="h-4 w-4" />
          </button>
        )}
        <button onClick={onClose} className={`${mutedClass} ml-1`}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Filter Dropdown */}
      <div className="p-2 border-b border-border flex-shrink-0">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className={`w-full h-8 text-xs ${triggerClass}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map(f => (
              <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {q.length < 2 ? (
          <p className={`text-center text-sm py-8 ${mutedClass}`}>Type at least 2 characters to search</p>
        ) : results.length === 0 ? (
          <p className={`text-center text-sm py-8 ${mutedClass}`}>No results found</p>
        ) : (
          <ul className="p-2 space-y-0.5">
            {results.map((r, i) => (
              <li key={`${r.type}-${r.id}-${i}`}>
                <button
                  onClick={r.action}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg ${hoverClass} text-left transition-colors`}
                >
                  <r.icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${mutedClass}`} />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${textClass}`}>{r.title}</p>
                    <p className={`text-xs truncate ${mutedClass}`}>{r.subtitle}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}