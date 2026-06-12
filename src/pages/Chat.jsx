import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // still used in NewDMDialog search
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Globe, Send, Plus, MessageSquare, ChevronDown, ChevronRight, X, ChevronLeft, Bell, Paperclip, Reply, FileText, Loader2, ImagePlus } from "lucide-react";
import { getChannelLastSeen, markChannelSeen } from "@/hooks/useUnreadCounts";
import { heartbeatPresence, clearPresence } from "@/lib/presence";
import { formatDistanceToNow } from "date-fns";
import UserAvatar from "@/components/shared/UserAvatar";
import MentionTextarea from "@/components/shared/MentionTextarea";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function isImageAttachment(att) {
  if (att?.type?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic|svg)$/i.test(att?.name || att?.url || "");
}

function AttachmentList({ attachments, isOwn }) {
  if (!attachments?.length) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${isOwn ? "items-end" : "items-start"}`}>
      {attachments.map((att, i) =>
        isImageAttachment(att) ? (
          <a key={i} href={att.url} target="_blank" rel="noopener noreferrer">
            <img
              src={att.url}
              alt={att.name || "image"}
              className="max-h-64 max-w-full rounded-xl border border-border object-cover"
            />
          </a>
        ) : (
          <a
            key={i}
            href={att.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-sm hover:bg-muted transition-colors max-w-full"
          >
            <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{att.name || "File"}</span>
          </a>
        )
      )}
    </div>
  );
}

function MessageBubble({ message, isOwn, avatarUrl, reactions = [], userEmail, onToggleReaction, onReply }) {
  const renderContent = (text) => {
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, i) =>
      part.startsWith("@") ? (
        <span key={i} className="font-semibold text-primary/90">{part}</span>
      ) : part
    );
  };

  // Group this message's reactions into chips: one per emoji with count +
  // whether the current user is among them (toggles delete vs add on click).
  const grouped = [];
  for (const r of reactions) {
    const g = grouped.find((x) => x.emoji === r.emoji);
    const name = r.user_name || r.user_email;
    if (g) {
      g.count += 1;
      g.mine = g.mine || r.user_email === userEmail;
      g.names.push(name);
    } else {
      grouped.push({ emoji: r.emoji, count: 1, mine: r.user_email === userEmail, names: [name] });
    }
  }

  return (
    <div className={`group flex items-end gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
      {!isOwn && (
        <div className="flex-shrink-0 mb-0.5">
          <UserAvatar name={message.author_name} email={message.author_email} avatarUrl={avatarUrl} size="sm" />
        </div>
      )}
      <div className={`max-w-[78%] ${isOwn ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {!isOwn && (
          <span className="text-xs text-muted-foreground px-1">{message.author_name || message.author_email}</span>
        )}
        {message.reply_to && (
          <div className="px-3 py-1.5 rounded-xl bg-muted/60 border-l-2 border-primary/40 text-xs text-muted-foreground max-w-full">
            <span className="font-semibold">{message.reply_to.author_name || "Someone"}: </span>
            <span>{message.reply_to.content}</span>
          </div>
        )}
        <AttachmentList attachments={message.attachments} isOwn={isOwn} />
        {message.content ? (
          <div className={`px-3 py-2 rounded-2xl text-sm ${isOwn ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
            {renderContent(message.content)}
          </div>
        ) : null}
        {grouped.length > 0 && (
          <div className={`flex flex-wrap gap-1 ${isOwn ? "justify-end" : ""}`}>
            {grouped.map((g) => (
              <button
                key={g.emoji}
                onClick={() => onToggleReaction(message, g.emoji)}
                title={g.names.join(", ")}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                  g.mine ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:bg-muted"
                }`}
              >
                <span>{g.emoji}</span>
                <span className="font-medium">{g.count}</span>
              </button>
            ))}
          </div>
        )}
        <span className="text-[10px] text-muted-foreground px-1">
          {formatDistanceToNow(new Date(message.created_date), { addSuffix: true })}
        </span>
      </div>
      {/* Hover actions: quick reactions + reply */}
      <div className="hidden group-hover:flex items-center gap-0.5 bg-card border border-border rounded-full px-1.5 py-0.5 shadow-sm self-center flex-shrink-0">
        {QUICK_EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => onToggleReaction(message, e)}
            className="p-0.5 text-sm leading-none hover:scale-125 transition-transform"
            title={`React ${e}`}
          >
            {e}
          </button>
        ))}
        <button onClick={() => onReply(message)} className="p-1 rounded-full hover:bg-muted" title="Reply">
          <Reply className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

function ChatRoom({ channelId, channelName, userId, userName, userEmail, companyId, isDM, dmParticipants, isPrivate, onBack, allUsers = [] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null); // message being replied to
  const [pendingFiles, setPendingFiles] = useState([]); // [{key, name, type, size, url, uploading, error}]
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const userAvatarMap = Object.fromEntries(allUsers.map(u => [u.email, u.avatar_url]));
  const bottomRef = useRef(null);

  const queryKey = ["chat-messages", channelId];
  const { data: messages = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      let msgs;
      if (isDM) {
        msgs = await base44.entities.ChatMessage.filter({ dm_channel_id: channelId });
      } else {
        msgs = await base44.entities.ChatMessage.filter(
          channelId === "global" ? { location_id: null } : { location_id: channelId }
        );
        msgs = msgs.filter(m => !m.dm_channel_id);
      }
      return msgs.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    },
  });

  // Reactions for every message in this conversation, keyed by channel so one
  // query + one realtime subscription covers the whole room.
  const reactionsKey = ["chat-reactions", channelId];
  const { data: reactions = [] } = useQuery({
    queryKey: reactionsKey,
    queryFn: () => base44.entities.ChatMessageReaction.filter({ channel_key: channelId }),
  });
  const reactionsByMessage = useMemo(() => {
    const map = {};
    for (const r of reactions) (map[r.message_id] ||= []).push(r);
    return map;
  }, [reactions]);

  useEffect(() => {
    const unsubMessages = base44.entities.ChatMessage.subscribe(() => {
      queryClient.invalidateQueries({ queryKey });
    });
    const unsubReactions = base44.entities.ChatMessageReaction.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: reactionsKey });
    });
    return () => {
      unsubMessages();
      unsubReactions();
    };
  }, [channelId, queryClient]);

  const toggleReaction = async (message, emoji) => {
    const mine = (reactionsByMessage[message.id] || []).find(
      r => r.user_email === userEmail && r.emoji === emoji
    );
    try {
      if (mine) {
        await base44.entities.ChatMessageReaction.delete(mine.id);
      } else {
        await base44.entities.ChatMessageReaction.create({
          company_id: companyId,
          message_id: message.id,
          channel_key: channelId,
          user_email: userEmail,
          user_name: userName,
          emoji,
        });
      }
    } catch (e) {
      console.error("Reaction failed", e);
    }
    queryClient.invalidateQueries({ queryKey: reactionsKey });
  };

  // Attachments: files are uploaded as soon as they're added (picker, paste, or
  // drag-drop) so Send only has to reference the finished URLs.
  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(f => f && f.size > 0);
    for (const file of files) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (file.size > 50 * 1024 * 1024) {
        setPendingFiles(prev => [...prev, { key, name: file.name, type: file.type, size: file.size, url: null, uploading: false, error: "Over 50 MB limit" }]);
        continue;
      }
      setPendingFiles(prev => [...prev, { key, name: file.name, type: file.type, size: file.size, url: null, uploading: true }]);
      base44.integrations.Core.UploadFile({ file })
        .then(({ file_url }) => {
          setPendingFiles(prev => prev.map(p => p.key === key ? { ...p, url: file_url, uploading: false } : p));
        })
        .catch((e) => {
          console.error("Upload failed", e);
          setPendingFiles(prev => prev.map(p => p.key === key ? { ...p, uploading: false, error: "Upload failed" } : p));
        });
    }
  };

  const handlePaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const handleDragOver = (e) => {
    if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const newestVisibleMessageAt = messages.reduce((newest, message) => {
      if (message.author_email === userEmail) return newest;
      const createdAt = new Date(message.created_date);
      if (Number.isNaN(createdAt.getTime())) return newest;
      return !newest || createdAt > newest ? createdAt : newest;
    }, null);

    if (newestVisibleMessageAt && newestVisibleMessageAt > getChannelLastSeen(channelId)) {
      markChannelSeen(channelId, newestVisibleMessageAt);
    }
  }, [channelId, messages, userEmail]);

  // Presence: while this conversation is open AND the tab is visible+focused,
  // heartbeat it so push-fanout mutes mobile push for this channel. Blur, hide,
  // switch channel, or leave the page clears it → mobile push resumes.
  useEffect(() => {
    if (!channelId || !userEmail) return;
    const isViewing = () =>
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      document.hasFocus();
    const beat = () => {
      if (isViewing()) heartbeatPresence(userEmail, channelId);
    };
    const stop = () => clearPresence(userEmail);
    const onVisibility = () => (isViewing() ? beat() : stop());
    beat(); // claim presence immediately on open
    const interval = setInterval(beat, 25000); // refresh inside the ~40s stale window
    window.addEventListener("focus", beat);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", beat);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [channelId, userEmail]);

  const stillUploading = pendingFiles.some(p => p.uploading);
  const readyAttachments = pendingFiles.filter(p => p.url);
  const canSend = (text.trim() || readyAttachments.length > 0) && !stillUploading;

  const sendMessage = async () => {
    if (!canSend) return;
    const msg = text.trim();
    setText("");
    const attachments = readyAttachments.map(({ url, name, type, size }) => ({ url, name, type, size }));
    setPendingFiles([]);
    const reply = replyTo;
    setReplyTo(null);
    const payload = {
      content: msg,
      author_name: userName,
      author_email: userEmail,
      company_id: companyId,
    };
    if (attachments.length > 0) payload.attachments = attachments;
    if (reply) {
      payload.reply_to = {
        id: reply.id,
        author_name: reply.author_name || reply.author_email,
        content: (reply.content || "📎 Attachment").slice(0, 140),
      };
    }
    if (isDM) {
      payload.dm_channel_id = channelId;
      payload.dm_participants = dmParticipants;
    } else {
      payload.location_id = channelId === "global" ? null : channelId;
    }
    await base44.entities.ChatMessage.create(payload);
    queryClient.invalidateQueries({ queryKey });
  };

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-20 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-card px-4 py-2 rounded-xl border border-border shadow-md text-sm font-medium">
            <ImagePlus className="h-4 w-4 text-primary" /> Drop to attach
          </div>
        </div>
      )}
      {/* Channel header with back button on mobile */}
      <div className="border-b border-border px-3 py-3 flex-shrink-0 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-muted md:hidden">
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{channelName}</h2>
          <p className="text-xs text-muted-foreground">{messages.length} messages</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No messages yet. Say hello! 👋
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.author_email === userEmail}
              avatarUrl={userAvatarMap[msg.author_email]}
              reactions={reactionsByMessage[msg.id]}
              userEmail={userEmail}
              onToggleReaction={toggleReaction}
              onReply={(m) => setReplyTo(m)}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3 flex-shrink-0 space-y-2">
        {replyTo && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-muted/60 border-l-2 border-primary/40 text-xs">
            <Reply className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">Replying to {replyTo.author_name || replyTo.author_email}</span>
              <p className="text-muted-foreground truncate">{replyTo.content || "📎 Attachment"}</p>
            </div>
            <button onClick={() => setReplyTo(null)} className="p-0.5 rounded hover:bg-muted">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map(p => (
              <div
                key={p.key}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs max-w-56 ${p.error ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border bg-muted/50"}`}
              >
                {p.uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                ) : p.type?.startsWith("image/") ? (
                  <ImagePlus className="h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                <span className="truncate">{p.name}</span>
                {p.error && <span className="flex-shrink-0">· {p.error}</span>}
                <button
                  onClick={() => setPendingFiles(prev => prev.filter(x => x.key !== p.key))}
                  className="p-0.5 rounded hover:bg-muted flex-shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }}
          />
          <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} title="Attach files">
            <Paperclip className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <MentionTextarea
              value={text}
              onChange={setText}
              placeholder="Type a message... Use @ to mention someone"
              rows={1}
              users={allUsers}
              onPaste={handlePaste}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
            />
          </div>
          <Button size="icon" onClick={sendMessage} disabled={!canSend}>
            {stillUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewDMDialog({ open, onOpenChange, onStart, users, currentUserEmail }) {
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");

  const filtered = users.filter(u =>
    u.email !== currentUserEmail &&
    (u.full_name || u.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (u) => {
    setSelected(prev => prev.find(x => x.email === u.email)
      ? prev.filter(x => x.email !== u.email)
      : [...prev, u]
    );
  };

  const handleStart = () => {
    if (selected.length === 0) return;
    onStart(selected);
    setSelected([]);
    setSearch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New Direct Message</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Search people..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map(u => (
                <span key={u.email} className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">
                  {u.full_name || u.email}
                  <button onClick={() => toggle(u)}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-52 overflow-y-auto space-y-0.5 border rounded-lg p-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
            ) : (
              filtered.map(u => {
                const isSelected = !!selected.find(x => x.email === u.email);
                return (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => toggle(u)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    <UserAvatar name={u.full_name} email={u.email} avatarUrl={u.avatar_url} size="xs" />
                    <span className="truncate">{u.full_name || u.email}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleStart} disabled={selected.length === 0}>Start Chat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnreadFeed({ messages, channels, dmChannels, userEmail, onSelectChannel, allUsers = [] }) {
  const userAvatarMap = Object.fromEntries(allUsers.map(u => [u.email, u.avatar_url]));

  const unread = messages
    .filter(m => {
      if (m.author_email === userEmail) return false;
      if (m.dm_channel_id) {
        const lastSeen = getChannelLastSeen(m.dm_channel_id);
        return m.dm_participants?.includes(userEmail) && new Date(m.created_date) > lastSeen;
      }
      const chId = m.location_id || "global";
      const lastSeen = getChannelLastSeen(chId);
      return new Date(m.created_date) > lastSeen;
    })
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const getChannelName = (msg) => {
    if (msg.dm_channel_id) {
      const ch = dmChannels.find(c => c.id === msg.dm_channel_id);
      return ch ? `DM: ${ch.name}` : "Direct Message";
    }
    if (!msg.location_id) return "🌐 Global Chat";
    const ch = channels.find(c => c.id === msg.location_id);
    return ch?.name || "Channel";
  };

  if (unread.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>You're all caught up!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 flex-shrink-0">
        <h2 className="font-semibold">Unread Messages</h2>
        <p className="text-xs text-muted-foreground">{unread.length} unread since your last visit</p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {unread.map(msg => (
          <button
            key={msg.id}
            onClick={() => onSelectChannel(msg.dm_channel_id || msg.location_id || "global")}
            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/50 text-left transition-colors"
          >
            <UserAvatar name={msg.author_name} email={msg.author_email} avatarUrl={userAvatarMap[msg.author_email]} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="font-semibold text-sm">{msg.author_name || msg.author_email}</span>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{getChannelName(msg)}</span>
                <span className="text-xs text-muted-foreground ml-auto">{formatDistanceToNow(new Date(msg.created_date), { addSuffix: true })}</span>
              </div>
              <p className="text-sm text-foreground/80 truncate">{msg.content || "📎 Attachment"}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function buildDMChannelId(emails) {
  return [...emails].sort().join("|");
}

function getDMChannelName(participants, currentUserEmail) {
  const others = participants.filter(e => e !== currentUserEmail);
  return others.join(", ") || "Yourself";
}

function ChannelList({ channels, dmChannels, activeChannel, onSelect, onNewDM, channelsExpanded, setChannelsExpanded, dmsExpanded, setDmsExpanded, unreadCount, onSelectUnread, recentMessages, userEmail }) {
  const getChUnread = (channelId) => {
    if (!recentMessages?.length) return 0;
    const lastSeen = getChannelLastSeen(channelId);
    return recentMessages.filter(m =>
      m.author_email !== userEmail &&
      !m.dm_channel_id &&
      (m.location_id || "global") === channelId &&
      new Date(m.created_date) > lastSeen
    ).length;
  };
  const getDMUnread = (dmChannelId) => {
    if (!recentMessages?.length) return 0;
    const lastSeen = getChannelLastSeen(dmChannelId);
    return recentMessages.filter(m =>
      m.author_email !== userEmail &&
      m.dm_channel_id === dmChannelId &&
      new Date(m.created_date) > lastSeen
    ).length;
  };
  return (
    <div className="flex flex-col h-full bg-muted/20">
      <div className="p-4 border-b border-border flex-shrink-0">
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Messaging</p>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {/* Unread feed */}
        {unreadCount > 0 && (
          <button
            onClick={onSelectUnread}
            className={`w-full flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl text-sm transition-colors mb-1 ${
              activeChannel === "__unread__" ? "bg-primary text-primary-foreground" : "bg-destructive/10 text-destructive hover:bg-destructive/20"
            }`}
          >
            <Bell className="h-4 w-4 flex-shrink-0" />
            <span className="font-semibold flex-1 text-left">Unread Messages</span>
            <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount}
            </span>
          </button>
        )}

        {/* Channels */}
        <button
          onClick={() => setChannelsExpanded(e => !e)}
          className="w-full flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase"
        >
          {channelsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Channels
        </button>
        {channelsExpanded && (
          <div className="px-2 pb-1 space-y-0.5">
            {channels.map(ch => {
              const chUnread = activeChannel !== ch.id ? getChUnread(ch.id) : 0;
              return (
                <button
                  key={ch.id}
                  onClick={() => onSelect(ch.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-colors text-left ${
                    activeChannel === ch.id ? "bg-primary text-primary-foreground" : "hover:bg-muted active:bg-muted"
                  }`}
                >
                  {ch.id === "global"
                    ? <Globe className="h-4 w-4 flex-shrink-0" />
                    : <div className="h-4 w-4 rounded-full bg-success/50 flex-shrink-0" />
                  }
                  <span className="truncate font-medium flex-1">{ch.name}</span>
                  {chUnread > 0 && (
                    <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {chUnread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* DMs */}
        <div className="border-t border-border/50 mt-2 pt-1">
          <div className="flex items-center gap-1 px-4 py-2">
            <button
              onClick={() => setDmsExpanded(e => !e)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase flex-1"
            >
              {dmsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Direct Messages
            </button>
            <button
              onClick={onNewDM}
              className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
              title="New DM"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {dmsExpanded && (
            <div className="px-2 pb-2 space-y-0.5">
              {dmChannels.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 pb-2">No DMs yet</p>
              ) : (
                dmChannels.map(ch => {
                  const dmUnread = activeChannel !== ch.id ? getDMUnread(ch.id) : 0;
                  return (
                    <button
                      key={ch.id}
                      onClick={() => onSelect(ch.id)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-colors text-left ${
                        activeChannel === ch.id ? "bg-primary text-primary-foreground" : "hover:bg-muted active:bg-muted"
                      }`}
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                        {(ch.name || "?")[0].toUpperCase()}
                      </div>
                      <span className="truncate font-medium flex-1">{ch.name}</span>
                      {dmUnread > 0 && (
                        <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {dmUnread}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
              <button
                onClick={onNewDM}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-4 w-4" /> New message
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeChannel, setActiveChannel] = useState(null); // null = show channel list on mobile
  const [newDMOpen, setNewDMOpen] = useState(false);
  const [dmChannels, setDmChannels] = useState([]);
  const [channelsExpanded, setChannelsExpanded] = useState(true);
  const [dmsExpanded, setDmsExpanded] = useState(true);

  // Deep-link straight to a thread via ?dm=<dmChannelId> or ?channel=<id|global>
  // (the dm id encodes participants as sorted emails joined by "|"), then strip
  // the param so it doesn't re-fire or linger in the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const dm = searchParams.get("dm");
    const channel = searchParams.get("channel");
    if (!dm && !channel) return;
    if (dm) {
      const participants = dm.split("|");
      setDmChannels((prev) =>
        prev.find((c) => c.id === dm)
          ? prev
          : [...prev, { id: dm, participants, name: getDMChannelName(participants, user?.email) }]
      );
      setActiveChannel(dm);
      markChannelSeen(dm);
    } else {
      setActiveChannel(channel);
      markChannelSeen(channel);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, user?.email]);

  // Fetch all recent messages for unread feed
  const { data: allRecentMessages = [] } = useQuery({
    queryKey: ["all-recent-messages", user?.company_id],
    queryFn: () => base44.entities.ChatMessage.filter({ company_id: user.company_id }, "-created_date", 100),
    enabled: !!user?.company_id,
    refetchInterval: 30000,
  });

  // Per-channel unread tracking
  const getChannelUnreadCount = (channelId, messages) => {
    const lastSeen = getChannelLastSeen(channelId);
    return messages.filter(m =>
      m.author_email !== user?.email &&
      new Date(m.created_date) > lastSeen &&
      (m.dm_channel_id ? m.dm_channel_id === channelId : (m.location_id || "global") === channelId) &&
      !m.dm_channel_id
    ).length;
  };

  const getDMUnreadCount = (dmChannelId) => {
    const lastSeen = getChannelLastSeen(dmChannelId);
    return allRecentMessages.filter(m =>
      m.author_email !== user?.email &&
      m.dm_channel_id === dmChannelId &&
      new Date(m.created_date) > lastSeen
    ).length;
  };

  // Total unread = sum across all accessible channels
  const unreadCount = allRecentMessages.filter(m => {
    if (m.author_email === user?.email) return false;
    if (m.dm_channel_id) {
      const lastSeen = getChannelLastSeen(m.dm_channel_id);
      return m.dm_participants?.includes(user?.email) && new Date(m.created_date) > lastSeen;
    }
    const chId = m.location_id || "global";
    const lastSeen = getChannelLastSeen(chId);
    return new Date(m.created_date) > lastSeen;
  }).length;

  // On first entry (no explicit thread deep-link), if there are unread chats land
  // on the Unread feed so the user can see WHICH threads are new and jump in —
  // instead of guessing from the channel list. Reading a thread clears its badge.
  const didDefaultRef = useRef(false);
  useEffect(() => {
    if (didDefaultRef.current) return;
    if (searchParams.get("dm") || searchParams.get("channel")) {
      didDefaultRef.current = true; // a deep-link wins; don't override it
      return;
    }
    if (allRecentMessages.length === 0) return; // wait for data to load
    didDefaultRef.current = true;
    if (unreadCount > 0 && !activeChannel) setActiveChannel("__unread__");
  }, [allRecentMessages, unreadCount, searchParams]);

  const handleSelectChannel = (id) => {
    if (id !== "__unread__") {
      markChannelSeen(id);
    }
    setActiveChannel(id);
  };

  const { data: allLocations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => base44.entities.Location.filter({ company_id: user.company_id }),
  });

  const assignedLocations = user?.assigned_locations || [];
  const locations = (user?.role === "admin" || assignedLocations.length === 0)
    ? allLocations
    : allLocations.filter(l => assignedLocations.includes(l.id));

  const { data: allUsers = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const res = await base44.functions.invoke("getCompanyUsers", {}); return res.data?.users || []; },
  });

  const { data: allChatChannels = [] } = useQuery({
    queryKey: ["chat-channels"],
    queryFn: () => base44.entities.ChatChannel.filter({ company_id: user.company_id }),
  });

  const privateChannels = allChatChannels.filter(ch =>
    ch.authorized_emails?.includes(user?.email)
  );

  const { data: myDMMessages = [] } = useQuery({
    queryKey: ["my-dm-messages", user?.email],
    queryFn: () => base44.entities.ChatMessage.filter({ author_email: user?.email }),
    enabled: !!user?.email,
  });

  const { data: receivedDMMessages = [] } = useQuery({
    queryKey: ["received-dm-messages", user?.email],
    queryFn: () => base44.entities.ChatMessage.filter({ dm_participants: user?.email }),
    enabled: !!user?.email,
  });

  useEffect(() => {
    const allMessages = [...myDMMessages, ...receivedDMMessages];
    const dmMap = new Map();
    allMessages.forEach(m => {
      if (m.dm_channel_id && m.dm_participants?.includes(user?.email)) {
        if (!dmMap.has(m.dm_channel_id)) {
          dmMap.set(m.dm_channel_id, m.dm_participants);
        }
      }
    });
    const channels = Array.from(dmMap.entries()).map(([id, participants]) => ({
      id,
      participants,
      name: getDMChannelName(participants, user?.email),
    }));
    setDmChannels(prev => {
      const existingIds = new Set(channels.map(c => c.id));
      const manual = prev.filter(c => !existingIds.has(c.id));
      return [...channels, ...manual];
    });
  }, [myDMMessages, receivedDMMessages, user?.email]);

  const channels = [
    { id: "global", name: "🌐 Global Chat" },
    ...locations.map(l => ({ id: l.id, name: l.name })),
    ...privateChannels.map(ch => ({ id: ch.id, name: `🔒 ${ch.name}`, isPrivate: true })),
  ];

  const activeChannelObj = channels.find(c => c.id === activeChannel);
  const activeDMObj = dmChannels.find(c => c.id === activeChannel);
  const activeChannelName = activeChannelObj?.name || activeDMObj?.name || "Chat";
  const isActiveDM = !!activeDMObj;

  const handleStartDM = (selectedUsers) => {
    const participants = [user.email, ...selectedUsers.map(u => u.email)];
    const id = buildDMChannelId(participants);
    const name = getDMChannelName(participants, user.email);
    setDmChannels(prev => prev.find(c => c.id === id) ? prev : [...prev, { id, participants, name }]);
    setActiveChannel(id);
  };

  const channelListProps = {
    channels,
    dmChannels,
    activeChannel,
    onSelect: handleSelectChannel,
    onNewDM: () => setNewDMOpen(true),
    channelsExpanded,
    setChannelsExpanded,
    dmsExpanded,
    setDmsExpanded,
    unreadCount,
    onSelectUnread: () => setActiveChannel("__unread__"),
    recentMessages: allRecentMessages,
    userEmail: user?.email,
  };

  return (
    <>
      {/* Mobile: show channel list OR chat room */}
      <div className="md:hidden flex flex-col h-[calc(100vh-8rem)]">
        {!activeChannel ? (
          <ChannelList {...channelListProps} />
        ) : (
          <div className="flex flex-col h-full border border-border rounded-xl overflow-hidden bg-card">
            {activeChannel === "__unread__" ? (
              <UnreadFeed
                messages={allRecentMessages}
                channels={channels}
                dmChannels={dmChannels}
                userEmail={user?.email}
                onSelectChannel={(id) => { handleSelectChannel(id); }}
                allUsers={allUsers}
              />
            ) : (
              <ChatRoom
                key={activeChannel}
                channelId={activeChannel}
                channelName={activeChannelName}
                userId={user?.id}
                userName={user?.full_name || user?.email}
                userEmail={user?.email}
                companyId={user?.company_id}
                isDM={isActiveDM}
                dmParticipants={activeDMObj?.participants}
                isPrivate={!!activeChannelObj?.isPrivate}
                onBack={() => setActiveChannel(null)}
                allUsers={allUsers}
              />
            )}
            {activeChannel === "__unread__" && (
              <button onClick={() => setActiveChannel(null)} className="absolute top-3 left-3 p-1.5 rounded-lg hover:bg-muted md:hidden">
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Desktop: side-by-side layout */}
      <div className="hidden md:flex h-[calc(100vh-12rem)] rounded-xl border border-border overflow-hidden bg-card">
        <aside className="w-60 flex-shrink-0 border-r border-border overflow-hidden">
          <ChannelList {...channelListProps} />
        </aside>
        <div className="flex-1 flex flex-col min-w-0">
          {activeChannel === "__unread__" ? (
            <UnreadFeed
              messages={allRecentMessages}
              channels={channels}
              dmChannels={dmChannels}
              userEmail={user?.email}
              onSelectChannel={handleSelectChannel}
              allUsers={allUsers}
            />
          ) : activeChannel ? (
            <ChatRoom
              key={activeChannel}
              channelId={activeChannel}
              channelName={activeChannelName}
              userId={user?.id}
              userName={user?.full_name || user?.email}
              userEmail={user?.email}
              companyId={user?.company_id}
              isDM={isActiveDM}
              dmParticipants={activeDMObj?.participants}
              isPrivate={!!activeChannelObj?.isPrivate}
              allUsers={allUsers}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center">
                <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>Select a channel to start chatting</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <NewDMDialog
        open={newDMOpen}
        onOpenChange={setNewDMOpen}
        onStart={handleStartDM}
        users={allUsers}
        currentUserEmail={user?.email}
      />
    </>
  );
}
