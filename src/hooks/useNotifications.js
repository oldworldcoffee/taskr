import { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";

/**
 * DB-backed in-app notifications for the current user. Unlike the chat/forum
 * unread counts (localStorage "last seen"), notifications are rows in the
 * `notifications` table with a `read_at` timestamp.
 */
export function useNotifications() {
  const { user } = useAuth();

  const { data: notifications = [], refetch } = useQuery({
    queryKey: ["notifications", user?.email],
    queryFn: () =>
      base44.entities.Notification.filter(
        { recipient_email: user.email },
        "-created_date",
        50
      ),
    enabled: !!user?.email,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!user?.email) return;
    const unsub = base44.entities.Notification.subscribe(() => refetch());
    return () => unsub();
  }, [user?.email]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const markRead = async (id) => {
    await base44.entities.Notification.update(id, {
      read_at: new Date().toISOString(),
    });
    refetch();
  };

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read_at);
    if (unread.length === 0) return;
    const now = new Date().toISOString();
    await Promise.all(
      unread.map((n) => base44.entities.Notification.update(n.id, { read_at: now }))
    );
    refetch();
  };

  return {
    notifications,
    unreadCount: Math.min(unreadCount, 99),
    markRead,
    markAllRead,
    refetch,
  };
}
