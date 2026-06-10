import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MentionTextarea from "@/components/shared/MentionTextarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Pin, Megaphone, Globe, MessageCircle, Trash2, ChevronDown, ChevronUp, Bell, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import UserAvatar from "@/components/shared/UserAvatar";
import { getForumLastSeen, markForumSeenAt } from "@/hooks/useUnreadCounts";


function renderWithMentions(text) {
  if (!text) return text;
  // Match @[Article Title] or @word
  const parts = text.split(/(@\[[^\]]+\]|@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@[") && part.endsWith("]")) {
      const title = part.slice(2, -1);
      return (
        <span key={i} className="inline-flex items-center gap-0.5 font-semibold text-blue-600 bg-blue-50 rounded px-1 text-xs">
          <span>📄</span>{title}
        </span>
      );
    }
    if (part.startsWith("@")) {
      return <span key={i} className="font-semibold text-primary">{part}</span>;
    }
    return part;
  });
}

function PostCard({ post, comments, articles = [], locations, currentUser, users = [], onDelete, onAddComment, onDeleteComment }) {
  const [expanded, setExpanded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const postComments = comments.filter(c => c.post_id === post.id);
  const location = locations.find(l => l.id === post.location_id);
  const canDelete = currentUser?.email === post.author_email || ["admin", "manager"].includes(currentUser?.role);
  const authorUser = users.find(u => u.email === post.author_email);

  const submitComment = async () => {
    if (!commentText.trim()) return;
    await onAddComment(post.id, commentText.trim());
    setCommentText("");
  };

  return (
    <div className={`rounded-xl border bg-card overflow-hidden ${post.is_pinned ? "border-primary/40 shadow-sm" : "border-border"}`}>
      {post.is_pinned && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-primary/5 border-b border-primary/20">
          <Pin className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary">Pinned</span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <UserAvatar name={post.author_name} email={post.author_email} avatarUrl={authorUser?.avatar_url} size="md" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-sm">{post.author_name || post.author_email}</span>
              {post.is_announcement && (
                <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200">
                  <Megaphone className="h-3 w-3 mr-1" />Announcement
                </Badge>
              )}
              {location ? (
                <Badge variant="outline" className="text-xs">{location.name}</Badge>
              ) : (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200"><Globe className="h-3 w-3 mr-1" />Global</Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {formatDistanceToNow(new Date(post.created_date), { addSuffix: true })}
              </span>
            </div>
            <h3 className="font-semibold text-base mb-1">{post.title}</h3>
            <div
              className="text-sm text-foreground/80 prose prose-sm max-w-none [&_img]:rounded-lg [&_img]:max-w-full [&_video]:rounded-lg [&_video]:max-w-full"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

          </div>
          {canDelete && (
            <button onClick={() => onDelete(post)} className="text-muted-foreground hover:text-destructive flex-shrink-0">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Comments toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {postComments.length} comment{postComments.length !== 1 ? "s" : ""}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {postComments.map(c => {
              const commentUser = users.find(u => u.email === c.author_email);
              return (
              <div key={c.id} className="flex items-start gap-2 group">
                <div className="flex-shrink-0">
                  <UserAvatar name={c.author_name} email={c.author_email} avatarUrl={commentUser?.avatar_url} size="xs" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-xs">{c.author_name || c.author_email}</span>
                  <span className="text-xs text-muted-foreground ml-2">{formatDistanceToNow(new Date(c.created_date), { addSuffix: true })}</span>
                  <p className="text-sm mt-0.5">{renderWithMentions(c.content)}</p>
                </div>
                {(currentUser?.email === c.author_email || ["admin", "manager"].includes(currentUser?.role)) && (
                   <button onClick={() => onDeleteComment(c)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                </div>
                );
                })}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <MentionTextarea
                  value={commentText}
                  onChange={setCommentText}
                  placeholder="Write a comment... (@ to mention someone or an article)"
                  rows={1}
                  users={users}
                  articles={articles}
                />
              </div>
              <Button size="sm" onClick={submitComment} disabled={!commentText.trim()} className="flex-shrink-0">Post</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewPostDialog({ open, onOpenChange, onSave, locations, articles, currentUser, users = [] }) {
  const isManager = ["admin", "manager"].includes(currentUser?.role);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [locationId, setLocationId] = useState("global");
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const isContentEmpty = !content || content === "<p><br></p>" || content.trim() === "";

  const handleSave = () => {
    if (!title.trim() || isContentEmpty) return;
    onSave({
      title: title.trim(),
      content: content.trim(),
      location_id: locationId === "global" ? null : locationId,
      is_announcement: isAnnouncement,
      is_pinned: isPinned,
    });
    setTitle(""); setContent(""); setIsAnnouncement(false); setIsPinned(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Post</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Post title..." autoFocus />
          </div>
          <div>
            <Label>Content *</Label>
            <div className="mt-1 rounded-md border border-input overflow-hidden [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-border [&_.ql-container]:border-0 [&_.ql-editor]:min-h-[120px] [&_.ql-editor]:text-sm">
              <ReactQuill
                theme="snow"
                value={content}
                onChange={setContent}
                placeholder="What's on your mind?"
                modules={{
                  toolbar: [
                    ["bold", "italic", "underline", "strike"],
                    [{ list: "ordered" }, { list: "bullet" }],
                    ["link", "image", "video"],
                    ["clean"],
                  ],
                }}
              />
            </div>
          </div>
          <div>
            <Label>Post to</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">🌐 Global (all locations)</SelectItem>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isManager && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Switch checked={isAnnouncement} onCheckedChange={setIsAnnouncement} />
                <Label>Post as Announcement</Label>
              </div>
              {isAnnouncement && (
                <div className="flex items-center gap-3">
                  <Switch checked={isPinned} onCheckedChange={setIsPinned} />
                  <Label>Pin to top</Label>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim() || isContentEmpty}>Post</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Forum() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [scopeFilter, setScopeFilter] = useState("all");
  const [newPostDialog, setNewPostDialog] = useState(false);
  const [lastSeenForum] = useState(() => getForumLastSeen());
  const [newPostsDismissed, setNewPostsDismissed] = useState(false);

  const { data: allLocations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => base44.entities.Location.filter({ company_id: user.company_id }) });

  const assignedLocations = user?.assigned_locations || [];
  const locations = (user?.role === "admin" || assignedLocations.length === 0)
    ? allLocations
    : allLocations.filter(l => assignedLocations.includes(l.id));
  const { data: allBoards = [] } = useQuery({ queryKey: ["forum-boards"], queryFn: () => base44.entities.ForumBoard.filter({ company_id: user.company_id }) });
  const { data: posts = [] } = useQuery({ queryKey: ["forum-posts"], queryFn: () => base44.entities.ForumPost.filter({ company_id: user.company_id }) });
  const { data: comments = [] } = useQuery({ queryKey: ["forum-comments"], queryFn: () => base44.entities.ForumComment.filter({ company_id: user.company_id }) });
  const { data: articles = [] } = useQuery({ queryKey: ["kb-articles"], queryFn: () => base44.entities.KBArticle.filter({ company_id: user.company_id }) });
  const { data: allUsers = [] } = useQuery({ queryKey: ["users"], queryFn: async () => { const res = await base44.functions.invoke("getCompanyUsers", {}); return res.data?.users || []; } });

  // Real-time subscriptions
  useEffect(() => {
    const unsub1 = base44.entities.ForumPost.subscribe(() => queryClient.invalidateQueries({ queryKey: ["forum-posts"] }));
    const unsub2 = base44.entities.ForumComment.subscribe(() => queryClient.invalidateQueries({ queryKey: ["forum-comments"] }));
    return () => { unsub1(); unsub2(); };
  }, [queryClient]);

  // Private boards this user can access
  const myBoards = allBoards.filter(b => b.authorized_emails?.includes(user?.email));

  const filteredPosts = posts.filter(p => {
    // Enforce location permissions
    if (p.location_id && assignedLocations.length > 0 && user?.role !== "admin" && !assignedLocations.includes(p.location_id)) return false;
    if (scopeFilter === "all") return !p.board_id; // default: only non-board posts
    if (scopeFilter === "global") return !p.location_id && !p.board_id;
    // Private board
    if (myBoards.find(b => b.id === scopeFilter)) return p.board_id === scopeFilter;
    return p.location_id === scopeFilter && !p.board_id;
  });

  // Unread posts: posted by others after last seen
  const unreadPosts = posts.filter(p => {
    if (p.author_email === user?.email) return false;
    if (p.location_id && assignedLocations.length > 0 && user?.role !== "admin" && !assignedLocations.includes(p.location_id)) return false;
    if (p.board_id) return false;
    return new Date(p.created_date) > lastSeenForum;
  }).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  const latestUnreadPostAt = unreadPosts[0]?.created_date;

  useEffect(() => {
    if (latestUnreadPostAt) {
      markForumSeenAt(latestUnreadPostAt);
    }
  }, [latestUnreadPostAt]);

  // Pinned first, then announcements, then normal
  const sorted = [...filteredPosts].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (a.is_announcement !== b.is_announcement) return a.is_announcement ? -1 : 1;
    return new Date(b.created_date) - new Date(a.created_date);
  });

  const handleSavePost = async (data) => {
    // If posting to a private board, set board_id instead of location_id
    const isBoard = myBoards.find(b => b.id === scopeFilter);
    const postData = isBoard
      ? { ...data, board_id: scopeFilter, location_id: null }
      : data;
    await base44.entities.ForumPost.create({ ...postData, company_id: user.company_id, author_name: user?.full_name, author_email: user?.email });
    queryClient.invalidateQueries({ queryKey: ["forum-posts"] });
    toast.success("Post created");
  };

  const handleDeletePost = async (post) => {
    await base44.entities.ForumPost.delete(post.id);
    queryClient.invalidateQueries({ queryKey: ["forum-posts"] });
    toast.success("Post deleted");
  };

  const handleAddComment = async (postId, content) => {
    await base44.entities.ForumComment.create({ post_id: postId, company_id: user.company_id, content, author_name: user?.full_name, author_email: user?.email });
    queryClient.invalidateQueries({ queryKey: ["forum-comments"] });
  };

  const handleDeleteComment = async (comment) => {
    await base44.entities.ForumComment.delete(comment.id);
    queryClient.invalidateQueries({ queryKey: ["forum-comments"] });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Message Board</h1>
        <Button onClick={() => setNewPostDialog(true)}><Plus className="h-4 w-4 mr-1" /> New Post</Button>
      </div>

      {/* Scope filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
        { id: "all", label: "All" },
        { id: "global", label: "🌐 Global" },
        ...locations.map(l => ({ id: l.id, label: l.name })),
        ...myBoards.map(b => ({ id: b.id, label: `🔒 ${b.name}` })),
      ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setScopeFilter(tab.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${scopeFilter === tab.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Unread / New Posts section */}
      {unreadPosts.length > 0 && !newPostsDismissed && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm text-primary">{unreadPosts.length} New Post{unreadPosts.length !== 1 ? "s" : ""}</span>
              <span className="text-xs text-muted-foreground">since your last visit</span>
            </div>
            <button onClick={() => setNewPostsDismissed(true)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="divide-y divide-border/50">
            {unreadPosts.map(post => {
              const loc = allLocations.find(l => l.id === post.location_id);
              const authorUser = allUsers.find(u => u.email === post.author_email);
              return (
                <div key={post.id} className="flex items-start gap-3 px-4 py-3">
                  <UserAvatar name={post.author_name} email={post.author_email} avatarUrl={authorUser?.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{post.author_name || post.author_email}</span>
                      {loc ? (
                        <Badge variant="outline" className="text-xs">{loc.name}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200"><Globe className="h-3 w-3 mr-1" />Global</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(post.created_date), { addSuffix: true })}</span>
                    </div>
                    <p className="font-medium text-sm mt-0.5">{post.title}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No posts yet. Start the conversation!</p>
          </div>
        ) : (
          sorted.map(post => (
            <PostCard
              key={post.id}
              post={post}
              comments={comments}
              articles={articles}
              locations={locations}
              currentUser={user}
              users={allUsers}
              onDelete={handleDeletePost}
              onAddComment={handleAddComment}
              onDeleteComment={handleDeleteComment}
            />
          ))
        )}
      </div>

      <NewPostDialog
        open={newPostDialog}
        onOpenChange={setNewPostDialog}
        onSave={handleSavePost}
        locations={locations}
        articles={articles}
        currentUser={user}
        users={allUsers}
      />
    </div>
  );
}
