import { useState } from "react";
import { BookOpen } from "lucide-react";
import KBArticleModal from "@/components/kb/KBArticleModal";

/**
 * Renders a task description string, converting @[Title](id) mentions
 * into clickable KB article chips that open the KBArticleModal.
 */
export default function DescriptionWithLinks({ text, className = "" }) {
  const [openArticleId, setOpenArticleId] = useState(null);

  if (!text) return null;

  // Parse the description into parts: plain text and mention tokens
  const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "mention", title: match[1], id: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }

  return (
    <>
      <span className={className}>
        {parts.map((part, i) =>
          part.type === "text" ? (
            <span key={i}>{part.content}</span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpenArticleId(part.id); }}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors mx-0.5 align-middle"
            >
              <BookOpen className="h-3 w-3 flex-shrink-0" />
              {part.title}
            </button>
          )
        )}
      </span>
      <KBArticleModal articleId={openArticleId} onClose={() => setOpenArticleId(null)} />
    </>
  );
}