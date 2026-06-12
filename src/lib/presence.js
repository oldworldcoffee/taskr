import { supabase } from "@/api/supabaseClient";

// Chat presence: while a user is actively viewing a conversation on the web app
// (tab visible + focused), we heartbeat the channel they're looking at. The
// push-fanout edge function reads this and skips MOBILE push for users actively
// viewing the same conversation (they already see it live). Going stale (~40s
// after the tab closes) or an explicit clear restores mobile push.

export async function heartbeatPresence(email, channelId) {
  if (!email || !channelId) return;
  try {
    await supabase.from("chat_presence").upsert(
      {
        user_email: email,
        active_channel: String(channelId),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_email" }
    );
  } catch {
    // best-effort — presence is an optimization, never block chatting on it
  }
}

export async function clearPresence(email) {
  if (!email) return;
  try {
    await supabase.from("chat_presence").delete().eq("user_email", email);
  } catch {
    /* best-effort */
  }
}
