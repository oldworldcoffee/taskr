import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { BookOpen } from "lucide-react";

/**
 * A textarea that supports @mention for KB articles.
 * Stores text like: "Check the machine @[Article Title](articleId) for details."
 */
export default function KBMentionTextarea({ value, onChange, placeholder, rows = 3 }) {
  const [query, setQuery] = useState("");
  const [mentioning, setMentioning] = useState(false);
  const [mentionStart, setMentionStart] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);

  const { data: kbArticles = [] } = useQuery({
    queryKey: ["kb-articles"],
    queryFn: () => base44.entities.KBArticle.list(),
  });

  const filtered = kbArticles
    .filter(a => a.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  const handleChange = (e) => {
    const text = e.target.value;
    const cursor = e.target.selectionStart;
    onChange(text);

    // Find if we're in the middle of an @mention
    const textBeforeCursor = text.slice(0, cursor);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex !== -1) {
      const afterAt = textBeforeCursor.slice(atIndex + 1);
      // Only trigger if no space in the search query and cursor is right after @
      if (!afterAt.includes(" ") && !afterAt.includes("\n") && cursor > atIndex) {
        setMentionStart(atIndex);
        setQuery(afterAt);
        setMentioning(true);
        return;
      }
    }
    setMentioning(false);
    setQuery("");
  };

  const handleKeyDown = (e) => {
    if (mentioning && e.key === "Escape") {
      setMentioning(false);
    }
  };

  const insertMention = (article) => {
    const textarea = textareaRef.current;
    const cursor = textarea.selectionStart;
    const before = value.slice(0, mentionStart);
    const after = value.slice(cursor);
    const mention = `@[${article.title}](${article.id})`;
    const newValue = before + mention + " " + after;
    onChange(newValue);
    setMentioning(false);
    setQuery("");
    // Restore focus
    setTimeout(() => {
      const newCursor = (before + mention + " ").length;
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    }, 0);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) && e.target !== textareaRef.current) {
        setMentioning(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
      />
      <p className="text-xs text-muted-foreground mt-1">Type @ to link a Knowledge Base article</p>

      {mentioning && (
        <div
          ref={dropdownRef}
          className="absolute z-50 left-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
        >
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">No articles found</p>
          ) : (
            <ul>
              {filtered.map(article => (
                <li key={article.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); insertMention(article); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className="truncate">{article.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}