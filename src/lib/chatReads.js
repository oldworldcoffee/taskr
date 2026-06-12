import { supabase } from "@/api/supabaseClient";

// Server-side mirror of the local "last seen" map that drives the chat /
// message-board unread badges. localStorage stays the synchronous source the
// badges read from, but it's device-local — without this mirror a fresh browser
// session or a second device starts from epoch and counts every recent message
// as unread. channel_id rows include the special '__all__' (everything seen)
// and '__forum__' (message board) keys alongside real channel ids.

export const FORUM_READS_KEY = "__forum__";

async function currentEmail() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.email || null;
  } catch {
    return null;
  }
}

// Returns { channelId: isoString } or null when unavailable (logged out,
// offline, table missing). Callers treat null as "skip the merge".
export async function fetchServerSeenMap() {
  const email = await currentEmail();
  if (!email) return null;
  const { data, error } = await supabase
    .from("chat_channel_reads")
    .select("channel_id,last_seen_at")
    .eq("user_email", email);
  if (error) return null;
  const map = {};
  for (const row of data || []) {
    if (row.channel_id && row.last_seen_at) map[row.channel_id] = row.last_seen_at;
  }
  return map;
}

// Fire-and-forget upsert of { channelId: isoString } entries. Read marks are
// an optimization — never block the UI on them.
export async function pushSeenToServer(entries) {
  try {
    const email = await currentEmail();
    if (!email) return;
    const rows = Object.entries(entries || {})
      .filter(([channelId, iso]) => channelId && iso)
      .map(([channelId, iso]) => ({
        user_email: email,
        channel_id: String(channelId),
        last_seen_at: iso,
      }));
    if (!rows.length) return;
    await supabase
      .from("chat_channel_reads")
      .upsert(rows, { onConflict: "user_email,channel_id" });
  } catch {
    /* best-effort */
  }
}
