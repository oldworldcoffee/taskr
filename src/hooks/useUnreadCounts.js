import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";

const LS_KEY_CHAT = "last_seen_chat_v2"; // per-channel map: { channelId: isoString }
const LS_KEY_FORUM = "last_seen_forum";
const ALL_CHAT_CHANNELS = "__all__";
const SEEN_STATE_CHANGED_EVENT = "taskr-unread-seen-state-changed";

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLastSeenMap() {
  if (typeof localStorage === "undefined") return {};
  try {
    const v = localStorage.getItem(LS_KEY_CHAT);
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}

function persistLastSeenMap(map) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY_CHAT, JSON.stringify(map));
}

function notifySeenStateChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SEEN_STATE_CHANGED_EVENT));
}

function getLastSeenFromMap(map, channelId) {
  const channelSeen = safeDate(map[channelId]);
  const allSeen = safeDate(map[ALL_CHAT_CHANNELS]);
  if (!channelSeen) return allSeen || new Date(0);
  if (!allSeen) return channelSeen;
  return channelSeen > allSeen ? channelSeen : allSeen;
}

function toSeenISOString(seenAt = new Date()) {
  const seenDate = safeDate(seenAt) || new Date();
  return seenDate.toISOString();
}

export function getForumLastSeen() {
  if (typeof localStorage === "undefined") return new Date(0);
  return safeDate(localStorage.getItem(LS_KEY_FORUM)) || new Date(0);
}

export function markForumSeenAt(seenAt = new Date()) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LS_KEY_FORUM, toSeenISOString(seenAt));
  }
  notifySeenStateChanged();
}

export function useUnreadCounts() {
  const { user } = useAuth();
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadForum, setUnreadForum] = useState(0);
  const [seenStateVersion, setSeenStateVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSeenStateChanged = () => setSeenStateVersion((version) => version + 1);
    const handleStorage = (event) => {
      if (event.key === LS_KEY_CHAT || event.key === LS_KEY_FORUM) {
        handleSeenStateChanged();
      }
    };
    window.addEventListener(SEEN_STATE_CHANGED_EVENT, handleSeenStateChanged);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(SEEN_STATE_CHANGED_EVENT, handleSeenStateChanged);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const { data: recentMessages = [] } = useQuery({
    queryKey: ["unread-chat-messages", user?.company_id],
    queryFn: () => base44.entities.ChatMessage.filter({ company_id: user.company_id }, "-created_date", 100),
    enabled: !!user?.company_id,
    refetchInterval: 30000,
  });

  const { data: chatChannels = [] } = useQuery({
    queryKey: ["chat-channels"],
    queryFn: () => base44.entities.ChatChannel.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  const { data: recentPosts = [] } = useQuery({
    queryKey: ["unread-forum-posts", user?.company_id],
    queryFn: () => base44.entities.ForumPost.filter({ company_id: user.company_id }, "-created_date", 20),
    enabled: !!user?.company_id,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!user?.email) return;

    const assignedLocations = user.assigned_locations || [];
    const isAdmin = user.role === "admin" || user.role === "manager";

    // Build set of channel IDs this user can access
    const accessibleChannelIds = new Set(["global"]);

    // Location-based channels
    if (isAdmin || assignedLocations.length === 0) {
      // Access all location channels — we don't have full location list here,
      // so we allow any location_id message (location filtering happens in Chat page)
    } else {
      assignedLocations.forEach(id => accessibleChannelIds.add(id));
    }

    // Private chat channels user is authorized for
    chatChannels.forEach(ch => {
      if (!ch.authorized_emails?.length || ch.authorized_emails.includes(user.email)) {
        accessibleChannelIds.add(ch.id);
      }
    });

    // DMs involving this user
    // (dm_channel_id messages are included if dm_participants contains user email)

    const lastSeenMap = getLastSeenMap();

    const count = recentMessages.filter(m => {
      if (m.author_email === user.email) return false;

      // Determine channel for this message
      if (m.dm_channel_id) {
        // Only count DMs the user is part of
        if (!m.dm_participants?.includes(user.email)) return false;
        const lastSeen = getLastSeenFromMap(lastSeenMap, m.dm_channel_id);
        return new Date(m.created_date) > lastSeen;
      }

      const channelId = m.location_id || "global";

      // For non-admins, check if user has access to this location channel
      if (!isAdmin && assignedLocations.length > 0 && m.location_id && !assignedLocations.includes(m.location_id)) {
        return false;
      }

      // Check if it's a private channel the user has access to
      if (m.location_id) {
        const privateChannel = chatChannels.find(ch => ch.id === m.location_id);
        if (privateChannel?.authorized_emails?.length && !privateChannel.authorized_emails.includes(user.email)) {
          return false;
        }
      }

      const lastSeen = getLastSeenFromMap(lastSeenMap, channelId);
      return new Date(m.created_date) > lastSeen;
    }).length;

    setUnreadChat(Math.min(count, 99));
  }, [recentMessages, chatChannels, user?.email, user?.assigned_locations, user?.role, seenStateVersion]);

  useEffect(() => {
    if (!user?.email) return;
    const lastSeenDate = getForumLastSeen();
    const count = recentPosts.filter(p =>
      p.author_email !== user.email &&
      new Date(p.created_date) > lastSeenDate
    ).length;
    setUnreadForum(Math.min(count, 99));
  }, [recentPosts, user?.email, seenStateVersion]);

  const markChatSeen = (channelId, seenAt) => {
    const map = getLastSeenMap();
    if (channelId) {
      map[channelId] = toSeenISOString(seenAt);
    } else {
      map[ALL_CHAT_CHANNELS] = toSeenISOString(seenAt);
    }
    persistLastSeenMap(map);
    notifySeenStateChanged();
    if (!channelId) setUnreadChat(0);
  };

  const markForumSeen = () => {
    markForumSeenAt();
    setUnreadForum(0);
  };

  return { unreadChat, unreadForum, markChatSeen, markForumSeen };
}

// Helpers for Chat page to use per-channel tracking
export const LS_KEY_CHAT_MAP = LS_KEY_CHAT;

export function getChannelLastSeen(channelId) {
  const map = getLastSeenMap();
  return getLastSeenFromMap(map, channelId);
}

export function markChannelSeen(channelId, seenAt) {
  if (!channelId) return;
  const map = getLastSeenMap();
  map[channelId] = toSeenISOString(seenAt);
  persistLastSeenMap(map);
  notifySeenStateChanged();
}
