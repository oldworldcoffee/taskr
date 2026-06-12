import { useState, useRef, useEffect } from "react";
import { FileText } from "lucide-react";

/**
 * A textarea that supports @mentions for both people and KB articles.
 * Props:
 *   value, onChange, placeholder, rows
 *   users: array of {email, full_name}
 *   articles: array of {id, title}
 */
export default function MentionTextarea({ value, onChange, placeholder, rows = 4, users = [], articles = [], onKeyDown: externalKeyDown, onPaste }) {
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionStart, setMentionStart] = useState(null);
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const textareaRef = useRef(null);

  // Sync external value changes (e.g. form reset) without touching cursor
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (el.value !== value) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = value;
      el.setSelectionRange(start, end);
    }
  }, [value]);

  // Build combined suggestion list from users + KB articles
  const filtered = mentionQuery !== null
    ? [
        ...users
          .filter(u => (u.full_name || u.email || "").toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 5)
          .map(u => ({ type: "person", label: u.full_name || u.email, sub: u.email })),
        ...articles
          .filter(a => (a.title || "").toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 5)
          .map(a => ({ type: "article", label: a.title, id: a.id })),
      ]
    : [];

  const handleChange = (e) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    onChange(val);

    const textUpToCursor = val.slice(0, cursor);
    const match = textUpToCursor.match(/@([^@\s]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStart(cursor - match[0].length);
      setDropdownIndex(0);
    } else {
      setMentionQuery(null);
      setMentionStart(null);
    }
  };

  const insertMention = (item) => {
    const el = textareaRef.current;
    const currentVal = el.value;
    const cursorPos = el.selectionStart;
    const before = currentVal.slice(0, mentionStart);
    const after = currentVal.slice(cursorPos);
    const tag = item.type === "article" ? `@[${item.label}]` : `@${item.label}`;
    const newVal = before + tag + " " + after;
    onChange(newVal);
    el.value = newVal;
    setMentionQuery(null);
    setMentionStart(null);
    const pos = before.length + tag.length + 1;
    el.setSelectionRange(pos, pos);
    el.focus();
  };

  const handleKeyDown = (e) => {
    if (mentionQuery !== null && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setDropdownIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setDropdownIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filtered[dropdownIndex]); return; }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }
    externalKeyDown?.(e);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        defaultValue={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        rows={rows}
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
      />
      {mentionQuery !== null && filtered.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-72 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          {/* People section */}
          {filtered.some(f => f.type === "person") && (
            <div className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">People</div>
          )}
          {filtered.filter(f => f.type === "person").map((item, i) => {
            const globalIdx = filtered.indexOf(item);
            return (
              <button
                key={`person-${item.label}`}
                type="button"
                onMouseDown={e => { e.preventDefault(); insertMention(item); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${globalIdx === dropdownIndex ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                  {item.label[0].toUpperCase()}
                </div>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          {/* Articles section */}
          {filtered.some(f => f.type === "article") && (
            <div className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-t border-border mt-1">KB Articles</div>
          )}
          {filtered.filter(f => f.type === "article").map((item) => {
            const globalIdx = filtered.indexOf(item);
            return (
              <button
                key={`article-${item.id}`}
                type="button"
                onMouseDown={e => { e.preventDefault(); insertMention(item); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${globalIdx === dropdownIndex ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                <div className="h-6 w-6 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}