import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { X, BookOpen, Image } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function KBArticleModal({ articleId, onClose }) {
  const { data: article, isLoading } = useQuery({
    queryKey: ["kb-article", articleId],
    queryFn: () => base44.entities.KBArticle.filter({ id: articleId }).then(r => r[0]),
    enabled: !!articleId,
  });

  if (!articleId) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">{isLoading ? "Loading..." : article?.title}</h2>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {!isLoading && article && (
          <div className="overflow-y-auto flex-1 p-5">
            {article.content && (
              <div
                className="prose prose-sm max-w-none mb-4"
                dangerouslySetInnerHTML={{ __html: article.content }}
              />
            )}
            {article.media_urls?.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-4 border-t border-border pt-4">
                {article.media_urls.map((url, i) =>
                  url.match(/\.(mp4|webm|mov)$/i)
                    ? <video key={i} src={url} controls className="rounded-lg max-h-64 max-w-full" />
                    : <img key={i} src={url} className="rounded-lg max-h-64 max-w-full object-cover" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}