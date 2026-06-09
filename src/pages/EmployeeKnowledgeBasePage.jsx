import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useLocation } from "react-router-dom";
import { BookOpen, FileText, Folder, Image } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function ArticleViewer({ article, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
          <BookOpen className="h-5 w-5" />
        </button>
        <h2 className="font-semibold flex-1 truncate">{article.title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-xs text-muted-foreground mb-4">By {article.author_name || article.author_email}</p>
        {article.content && (
          <div className="prose prose-sm max-w-none mb-4" dangerouslySetInnerHTML={{ __html: article.content }} />
        )}
        {article.media_urls?.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-4">
            {article.media_urls.map((url, i) =>
              url.match(/\.(mp4|webm|mov)$/i)
                ? <video key={i} src={url} controls className="rounded-lg max-h-64 w-full" />
                : <img key={i} src={url} className="rounded-lg max-h-64 max-w-full object-cover" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmployeeKnowledgeBase() {
  const { user } = useAuth();
  const location = useLocation();
  const [scopeFilter, setScopeFilter] = useState("global");
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [viewingArticle, setViewingArticle] = useState(null);

  const assignedLocations = user?.assigned_locations || [];
  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const companyId = user?.company_id;

  const { data: allLocations = [] } = useQuery({
    queryKey: ["locations", companyId],
    queryFn: () => base44.entities.Location.filter({ company_id: companyId }),
    enabled: !!companyId,
  });
  const { data: folders = [] } = useQuery({
    queryKey: ["kb-folders", companyId],
    queryFn: () => base44.entities.KBFolder.filter({ company_id: companyId }),
    enabled: !!companyId,
  });
  const { data: articles = [] } = useQuery({
    queryKey: ["kb-articles", companyId],
    queryFn: () => base44.entities.KBArticle.filter({ company_id: companyId }),
    enabled: !!companyId,
  });

  // Auto-open article from search navigation
  useEffect(() => {
    const openId = location.state?.openArticleId;
    if (openId && articles.length > 0) {
      const article = articles.find(a => a.id === openId);
      if (article) setViewingArticle(article);
    }
  }, [location.state?.openArticleId, articles]);

  // Only show locations the user is assigned to (admins see all)
  const locations = isAdmin ? allLocations : allLocations.filter(l => assignedLocations.includes(l.id));

  // Private folders this user can access (restricted folders treated like private boards)
  const privateFolders = folders.filter(f => f.authorized_emails?.length && f.authorized_emails.includes(user?.email));
  const isPrivateFolderScope = !!privateFolders.find(f => f.id === scopeFilter);

  const publicFolders = folders.filter(f => !f.authorized_emails?.length).filter(f => {
    if (isPrivateFolderScope) return false;
    if (scopeFilter === "global") return !f.location_id;
    return f.location_id === scopeFilter;
  });

  const visibleArticles = articles.filter(a => {
    if (a.is_draft) return false;
    // Block articles from locations the user isn't assigned to
    if (!isAdmin && a.location_id && !assignedLocations.includes(a.location_id)) return false;
    if (a.folder_id) {
      const folder = folders.find(f => f.id === a.folder_id);
      if (folder?.authorized_emails?.length && !folder.authorized_emails.includes(user?.email)) return false;
    }
    if (isPrivateFolderScope) return a.folder_id === scopeFilter;
    const scopeMatch = scopeFilter === "global" ? !a.location_id : a.location_id === scopeFilter;
    if (selectedFolder) return a.folder_id === selectedFolder && scopeMatch;
    // Finder-style: only loose articles at top level
    return !a.folder_id && scopeMatch;
  });

  return (
    <div className="space-y-4 pb-8">
      <h1 className="text-xl font-bold">Knowledge Base</h1>

      {/* Main filter tabs — locations + private folders (no "All") */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: "global", label: "🏢 Company" },
          ...locations.map(l => ({ id: l.id, label: l.name })),
          ...privateFolders.map(f => ({ id: f.id, label: `🔒 ${f.name}` })),
        ].map(item => (
          <button
            key={item.id}
            onClick={() => { setScopeFilter(item.id); setSelectedFolder(null); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${scopeFilter === item.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Finder-style content: folders first, then loose articles */}
      {publicFolders.length === 0 && visibleArticles.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No articles found.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Folders row */}
          {!selectedFolder && !isPrivateFolderScope && publicFolders.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {publicFolders.map(folder => {
                const count = articles.filter(a => a.folder_id === folder.id && !a.is_draft).length;
                return (
                  <button
                    key={folder.id}
                    onClick={() => setSelectedFolder(folder.id)}
                    className="text-left p-3 rounded-xl border border-border bg-card hover:border-primary/50 transition-all flex items-center gap-3"
                  >
                    <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                      <Folder className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{folder.name}</p>
                      <p className="text-xs text-muted-foreground">{count} article{count !== 1 ? "s" : ""}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Folder breadcrumb when drilling in */}
          {selectedFolder && (
            <button
              onClick={() => setSelectedFolder(null)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <BookOpen className="h-4 w-4" />
              <span>← {publicFolders.find(f => f.id === selectedFolder)?.name || "Back"}</span>
            </button>
          )}

          {/* Articles */}
          {visibleArticles.length > 0 && (
            <div className="grid gap-3">
              {visibleArticles.map(article => {
                const folder = folders.find(f => f.id === article.folder_id);
                const location = locations.find(l => l.id === article.location_id);
                return (
                  <button
                    key={article.id}
                    onClick={() => setViewingArticle(article)}
                    className="text-left p-4 rounded-xl border border-border bg-card hover:border-primary/50 active:bg-muted transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm leading-snug">{article.title}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {location ? (
                            <Badge variant="outline" className="text-xs">{location.name}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">Company</Badge>
                          )}
                          {folder && <Badge variant="outline" className="text-xs"><Folder className="h-2.5 w-2.5 mr-1" />{folder.name}</Badge>}
                          {article.media_urls?.length > 0 && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Image className="h-3 w-3" />{article.media_urls.length}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {viewingArticle && (
        <ArticleViewer
          article={viewingArticle}
          onClose={() => setViewingArticle(null)}
        />
      )}
    </div>
  );
}
