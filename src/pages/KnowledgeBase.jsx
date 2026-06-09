import { useState, useRef, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useLocation as useRouterLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Folder, FileText, Pencil, Trash2, Globe, BookOpen, Image, X, ChevronLeft, ChevronDown, Paperclip, Download } from "lucide-react";
import { toast } from "sonner";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

function ArticleDialog({ open, onOpenChange, onSave, initial, folders, locations }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState("");
  const [locationId, setLocationId] = useState("global");
  const [mediaUrls, setMediaUrls] = useState([]);
  const [fileUrls, setFileUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef(null);
  const quillRef = useRef(null);

  // Re-initialize form whenever the dialog opens or the article changes
  useEffect(() => {
    if (open) {
      setTitle(initial?.title || "");
      setFolderId(initial?.folder_id || "");
      setLocationId(initial?.location_id || "global");
      setMediaUrls(initial?.media_urls || []);
      setFileUrls(initial?.file_urls || []);
      // If content is a URL (uploaded file), fetch it
      if (initial?.content?.startsWith("http")) {
        fetch(initial.content).then(r => r.text()).then(setContent);
      } else {
        setContent(initial?.content || "");
      }
    }
  }, [open, initial?.id]);

  const handleMediaUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setMediaUrls(prev => [...prev, file_url]);
    setUploading(false);
  };

  // Upload images inserted via the Quill toolbar instead of embedding as base64
  const imageHandler = useCallback(() => {
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*");
    input.click();
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const quill = quillRef.current?.getEditor();
      if (quill) {
        const range = quill.getSelection(true);
        quill.insertEmbed(range.index, "image", file_url);
        quill.setSelection(range.index + 1);
      }
    };
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingFile(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setFileUrls(prev => [...prev, JSON.stringify({ url: file_url, name: file.name })]);
    setUploadingFile(false);
    e.target.value = "";
  };

  const removeFile = (index) => {
    setFileUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = (isDraft = false) => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      content,
      folder_id: folderId || null,
      location_id: locationId === "global" ? null : locationId,
      media_urls: mediaUrls,
      file_urls: fileUrls,
      is_draft: isDraft,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Article" : "New Article"}{initial?.is_draft && <span className="ml-2 text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Draft</span>}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title..." autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Scope</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">🌐 Global</SelectItem>
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Folder</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger><SelectValue placeholder="No folder" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No folder</SelectItem>
                  {folders.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Content</Label>
            <div className="mt-1 rounded-md border border-input overflow-hidden [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-border [&_.ql-container]:border-0 [&_.ql-editor]:min-h-[200px] [&_.ql-editor]:text-sm">
              <ReactQuill
                ref={quillRef}
                theme="snow"
                value={content}
                onChange={setContent}
                placeholder="Write your article..."
                modules={{
                  toolbar: {
                    container: [
                      [{ header: [2, 3, false] }],
                      ["bold", "italic", "underline", "strike"],
                      [{ list: "ordered" }, { list: "bullet" }],
                      ["link", "image", "video"],
                      ["clean"],
                    ],
                    handlers: { image: imageHandler },
                  },
                }}
              />
            </div>
          </div>

          {/* File Attachments */}
          <div>
            <Label>Attachments (PDFs, docs, etc.)</Label>
            <div className="mt-1 space-y-2">
              {fileUrls.map((fileEntry, i) => {
                let parsed = { url: fileEntry, name: "File" };
                try { parsed = JSON.parse(fileEntry); } catch {}
                return (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30">
                    <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm flex-1 truncate">{parsed.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}>
                  <Paperclip className="h-4 w-4" />
                  {uploadingFile ? "Uploading..." : "Attach File"}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => handleSave(true)} disabled={!title.trim()}>Save Draft</Button>
          <Button onClick={() => handleSave(false)} disabled={!title.trim()}>{initial ? "Save Changes" : "Publish"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderDialog({ open, onOpenChange, onSave, initial, locations }) {
  const [name, setName] = useState(initial?.name || "");
  const [locationId, setLocationId] = useState(initial?.location_id || "global");

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), location_id: locationId === "global" ? null : locationId });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{initial ? "Rename Folder" : "New Folder"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Folder Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Opening Procedures" autoFocus onKeyDown={e => e.key === "Enter" && handleSave()} />
          </div>
          <div>
            <Label>Scope</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">🌐 Global</SelectItem>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>{initial ? "Save" : "Create Folder"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArticleViewer({ article, onClose, onEdit, onDelete, isAdmin }) {
  const [content, setContent] = useState(article?.content || "");

  useEffect(() => {
    if (!article?.content) return;
    // If content is a URL (uploaded file), fetch it
    if (article.content.startsWith("http")) {
      fetch(article.content).then(r => r.text()).then(setContent);
    } else {
      setContent(article.content);
    }
  }, [article?.id, article?.content]);

  return (
    <Dialog open={!!article} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="flex flex-row items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0 space-y-0">
          <DialogTitle className="flex-1 text-left leading-snug">{article.title}</DialogTitle>
          {article.is_draft && <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex-shrink-0">Draft</span>}
          {isAdmin && (
            <div className="flex gap-1 flex-shrink-0 mr-8">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(article)}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(article)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          )}
        </DialogHeader>
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground mb-4">By {article.author_name || article.author_email}</p>
          {content && (
            <div className="prose prose-sm max-w-none mb-4" dangerouslySetInnerHTML={{ __html: content }} />
          )}
          {article.media_urls?.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-4">
              {article.media_urls.map((url, i) => (
                url.match(/\.(mp4|webm|mov)$/i)
                  ? <video key={i} src={url} controls className="rounded-lg max-h-64 w-full" />
                  : <img key={i} src={url} className="rounded-lg max-h-64 max-w-full object-cover" />
              ))}
            </div>
          )}
          {article.file_urls?.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Attachments</p>
              {article.file_urls.map((fileEntry, i) => {
                let parsed = { url: fileEntry, name: "Download File" };
                try { parsed = JSON.parse(fileEntry); } catch {}
                return (
                  <a
                    key={i}
                    href={parsed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted transition-colors text-sm font-medium"
                  >
                    <Paperclip className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="flex-1 truncate">{parsed.name}</span>
                    <Download className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgeBase() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const routerLocation = useRouterLocation();
  const isAdmin = user?.role === "admin" || user?.role === "manager";

  const [scopeFilter, setScopeFilter] = useState("global");
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [viewingArticle, setViewingArticle] = useState(null);
  const [articleDialog, setArticleDialog] = useState(false);
  const [editingArticle, setEditingArticle] = useState(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'article'|'folder', item }

  const { data: allLocations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => base44.entities.Location.filter({ company_id: user.company_id }) });
  const { data: folders = [] } = useQuery({ queryKey: ["kb-folders"], queryFn: () => base44.entities.KBFolder.filter({ company_id: user.company_id }) });
  const { data: articles = [] } = useQuery({ queryKey: ["kb-articles"], queryFn: () => base44.entities.KBArticle.filter({ company_id: user.company_id }) });

  // Auto-open article from search navigation
  useEffect(() => {
    const openId = routerLocation.state?.openArticleId;
    if (openId && articles.length > 0) {
      const article = articles.find(a => a.id === openId);
      if (article) setViewingArticle(article);
    }
  }, [routerLocation.state?.openArticleId, articles]);

  const assignedLocations = user?.assigned_locations || [];
  const locations = (user?.role === "admin" || assignedLocations.length === 0)
    ? allLocations
    : allLocations.filter(l => assignedLocations.includes(l.id));

  const visibleFolders = folders.filter(f => {
    if (!f.authorized_emails?.length) return true;
    return f.authorized_emails.includes(user?.email);
  }).filter(f => {
    if (scopeFilter === "all") return true;
    if (scopeFilter === "global") return !f.location_id;
    return f.location_id === scopeFilter;
  });

  const visibleArticles = articles.filter(a => {
    if (a.is_draft && !isAdmin) return false;
    if (a.location_id && assignedLocations.length > 0 && user?.role !== "admin" && !assignedLocations.includes(a.location_id)) return false;
    const scopeMatch = scopeFilter === "global" ? !a.location_id : a.location_id === scopeFilter;
    if (a.folder_id) {
      const folder = folders.find(f => f.id === a.folder_id);
      if (folder?.authorized_emails?.length && !folder.authorized_emails.includes(user?.email)) return false;
    }
    if (selectedFolder) return a.folder_id === selectedFolder && scopeMatch;
    // At top level, only show articles NOT in any folder (Finder-style)
    return !a.folder_id && scopeMatch;
  });

  const handleSaveArticle = async (data) => {
    let saveData = { ...data };

    // If content is large OR contains base64 images, upload as file and store URL
    const hasBase64 = data.content && data.content.includes("data:image");
    if (data.content && (data.content.length > 20000 || hasBase64)) {
      const blob = new Blob([data.content], { type: "text/html" });
      const file = new File([blob], "content.html", { type: "text/html" });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      saveData.content = file_url;
    }

    if (editingArticle) {
      await base44.entities.KBArticle.update(editingArticle.id, saveData);
      toast.success("Article updated");
    } else {
      await base44.entities.KBArticle.create({ ...saveData, company_id: user.company_id, author_name: user?.full_name, author_email: user?.email });
      toast.success("Article created");
    }
    queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
    setEditingArticle(null);
  };

  const handleDeleteArticle = async (article) => {
    await base44.entities.KBArticle.delete(article.id);
    queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
    setViewingArticle(null);
    setDeleteConfirm(null);
    toast.success("Article deleted");
  };

  const handleSaveFolder = async (data) => {
    if (editingFolder) {
      await base44.entities.KBFolder.update(editingFolder.id, data);
      toast.success("Folder updated");
    } else {
      await base44.entities.KBFolder.create({ ...data, company_id: user.company_id });
      toast.success("Folder created");
    }
    queryClient.invalidateQueries({ queryKey: ["kb-folders"] });
    setEditingFolder(null);
  };

  const handleDeleteFolder = async (folder) => {
    await base44.entities.KBFolder.delete(folder.id);
    queryClient.invalidateQueries({ queryKey: ["kb-folders"] });
    if (selectedFolder === folder.id) setSelectedFolder(null);
    setDeleteConfirm(null);
    toast.success("Folder deleted");
  };

  return (
    <div className="flex gap-4">
      {/* Sidebar Filters */}
      <div className="w-64 flex-shrink-0 space-y-4">
        {/* Location filter */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Location</p>
          <div className="space-y-1">
            {[{ id: "global", label: "🏢 Company" },
              ...locations.map(l => ({ id: l.id, label: l.name }))
            ].map(item => (
              <button
                key={item.id}
                onClick={() => { setScopeFilter(item.id); setSelectedFolder(null); }}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scopeFilter === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Folder filter */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Folder</p>
            {isAdmin && (
              <button onClick={() => { setEditingFolder(null); setFolderDialog(true); }} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="space-y-1">
            {visibleFolders.map(folder => (
              <div key={folder.id} className="flex items-center gap-1 group">
                <button
                  onClick={() => setSelectedFolder(folder.id === selectedFolder ? null : folder.id)}
                  className={`flex-1 text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedFolder === folder.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  <Folder className="h-3.5 w-3.5 inline mr-1.5" />{folder.name}
                </button>
                {isAdmin && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                    <button onClick={() => { setEditingFolder(folder); setFolderDialog(true); }} className="p-1 rounded hover:bg-muted"><Pencil className="h-3 w-3 text-muted-foreground" /></button>
                    <button onClick={() => setDeleteConfirm({ type: 'folder', item: folder })} className="p-1 rounded hover:bg-muted"><Trash2 className="h-3 w-3 text-destructive" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Knowledge Base</h1>
          {isAdmin && (
            <Button size="sm" onClick={() => { setEditingArticle(null); setArticleDialog(true); }}>
              <Plus className="h-4 w-4" /> New Article
            </Button>
          )}
        </div>

        {/* Finder-style: folders first, then loose articles */}
        {visibleFolders.length === 0 && visibleArticles.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No articles found.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Folders */}
            {!selectedFolder && visibleFolders.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Folders</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleFolders.map(folder => {
                    const count = articles.filter(a => a.folder_id === folder.id && (!a.is_draft || isAdmin)).length;
                    return (
                      <div key={folder.id} className="relative group">
                        <button
                          onClick={() => setSelectedFolder(folder.id)}
                          className="w-full text-left p-3 rounded-xl border border-border bg-card hover:border-primary/50 transition-all flex items-center gap-3"
                        >
                          <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                            <Folder className="h-5 w-5 text-amber-500" />
                          </div>
                          <div className="flex-1 min-w-0 pr-12">
                            <p className="font-medium text-sm truncate">{folder.name}</p>
                            <p className="text-xs text-muted-foreground">{count} article{count !== 1 ? "s" : ""}</p>
                          </div>
                        </button>
                        {isAdmin && (
                          <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEditingFolder(folder); setFolderDialog(true); }} className="p-1 rounded hover:bg-muted bg-card"><Pencil className="h-3 w-3 text-muted-foreground" /></button>
                            <button onClick={() => setDeleteConfirm({ type: 'folder', item: folder })} className="p-1 rounded hover:bg-muted bg-card"><Trash2 className="h-3 w-3 text-destructive" /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected folder breadcrumb */}
            {selectedFolder && (
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedFolder(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="h-4 w-4" /> Folders
                </button>
                <span className="text-muted-foreground">/</span>
                <span className="text-sm font-medium">{visibleFolders.find(f => f.id === selectedFolder)?.name}</span>
              </div>
            )}

            {/* Articles */}
            {visibleArticles.length > 0 && (
              <div>
                {!selectedFolder && visibleFolders.length > 0 && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Articles</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleArticles.map(article => {
                    const folder = folders.find(f => f.id === article.folder_id);
                    const location = locations.find(l => l.id === article.location_id);
                    return (
                      <button
                        key={article.id}
                        onClick={() => setViewingArticle(article)}
                        className="text-left p-4 rounded-xl border border-border bg-card hover:border-primary/50 active:bg-muted transition-all group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start gap-1.5 flex-wrap">
                              <p className="font-semibold text-sm leading-snug group-hover:text-primary transition-colors">{article.title}</p>
                              {article.is_draft && <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 leading-none">Draft</span>}
                            </div>
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
                              {article.file_urls?.length > 0 && (
                                <Badge variant="outline" className="text-xs gap-1">
                                  <Paperclip className="h-3 w-3" />{article.file_urls.length}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ArticleDialog
        open={articleDialog}
        onOpenChange={(o) => { setArticleDialog(o); if (!o) setEditingArticle(null); }}
        onSave={handleSaveArticle}
        initial={editingArticle}
        folders={visibleFolders}
        locations={locations}
      />
      <FolderDialog
        open={folderDialog}
        onOpenChange={(o) => { setFolderDialog(o); if (!o) setEditingFolder(null); }}
        onSave={handleSaveFolder}
        initial={editingFolder}
        locations={locations}
      />

      {viewingArticle && (
        <ArticleViewer
          article={viewingArticle}
          onClose={() => setViewingArticle(null)}
          onEdit={(a) => { setEditingArticle(a); setArticleDialog(true); setViewingArticle(null); }}
          onDelete={(a) => { setViewingArticle(null); setTimeout(() => setDeleteConfirm({ type: 'article', item: a }), 150); }}
          isAdmin={isAdmin}
        />
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteConfirm?.type === 'folder' ? 'Folder' : 'Article'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.type === 'folder'
                ? `Are you sure you want to delete the folder "${deleteConfirm?.item?.name}"? Articles inside will not be deleted.`
                : `Are you sure you want to delete "${deleteConfirm?.item?.title}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirm?.type === 'folder') handleDeleteFolder(deleteConfirm.item);
                else handleDeleteArticle(deleteConfirm.item);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}