import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // still used in NewDMDialog search
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Globe, Send, Plus, MessageSquare, ChevronDown, ChevronRight, X, ChevronLeft, Bell } from "lucide-react";
import { getChannelLastSeen, markChannelSeen } from "@/hooks/useUnreadCounts";
import { heartbeatPresence, clearPresence } from "@/lib/presence";
import { formatDistanceToNow } from "date-fns";
import UserAvatar from "@/components/shared/UserAvatar";
import MentionTextarea from "@/components/shared/MentionTextarea";

function MessageBubble({ message, isOwn, avatarUrl }) {
  const renderContent = (text) => {
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, i) =>
      part.startsWith("@") ? (
        <span key={i} className="font-semibold text-primary/90">{part}</span>
      ) : part
    );
  };

  return (
    <div className={`flex items-end gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
      {!isOwn && (
        <div className="flex-shrink-0 mb-0.5">
          <UserAvatar name={message.author_name} email={message.author_email} avatarUrl={avatarUrl} size="sm" />
        </div>
      )}
      <div className={`max-w-[78%] ${isOwn ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
        {!isOwn && (
          <span className="text-xs text-muted-foreground px-1">{message.author_name || message.author_email}</span>
        )}
        <div className={`px-3 py-2 rounded-2xl text-sm ${isOwn ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
          {renderContent(message.content)}
        </div>
        <span className="text-[10px] text-muted-foreground px-1">
          {formatDistanceToNow(new Date(message.created_date), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}

function ChatRoom({ channelId, channelName, userId, userName, userEmail, companyId, isDM, dmParticipants, isPrivate, onBack, allUsers = [] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
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

  useEffect(() => {
    const unsub = base44.entities.ChatMessage.subscribe(() => {
      queryClient.invalidateQueries({ queryKey });
    });
    return unsub;
  }, [channelId, queryClient]);

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

  const sendMessage = async () => {
    if (!text.trim()) return;
    const msg = text.trim();
    setText("");
    const payload = {
      content: msg,
      author_name: userName,
      author_email: userEmail,
      company_id: companyId,
    };
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
    <div className="flex flex-col h-full">
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
            <MessageBubble key={msg.id} message={msg} isOwn={msg.author_email === userEmail} avatarUrl={userAvatarMap[msg.author_email]} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <MentionTextarea
              value={text}
              onChange={setText}
              placeholder="Type a message... Use @ to mention someone"
              rows={1}
              users={allUsers}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
            />
          </div>
          <Button size="icon" onClick={sendMessage} disabled={!text.trim()}>
            <Send className="h-4 w-4" />
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
              <p className="text-sm text-foreground/80 truncate">{msg.content}</p>
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
