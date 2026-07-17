"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { onSyncStatusChange, type SyncStatus } from "@/lib/supabase/sync";
import { cn } from "@/lib/utils";

export function SyncStatusBadge() {
  const [status, setStatus] = useState<SyncStatus>("offline");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(Boolean(session));
      setStatus(session ? "idle" : "offline");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      if (!session) setStatus("offline");
    });

    const unsubscribe = onSyncStatusChange((next) => {
      setStatus(next);
    });

    return () => {
      subscription.unsubscribe();
      unsubscribe();
    };
  }, []);

  if (!isSupabaseConfigured()) return null;

  const label = !signedIn
    ? "Sync off"
    : status === "syncing"
      ? "Syncing"
      : status === "error"
        ? "Sync error"
        : "Synced";

  const Icon =
    !signedIn || status === "offline"
      ? CloudOff
      : status === "syncing"
        ? Loader2
        : Cloud;

  return (
    <Link
      href="/sync"
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all",
        "text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5",
        status === "error" && signedIn && "text-[#ff3b30]"
      )}
      title={label}
    >
      <Icon className={cn("w-3.5 h-3.5", status === "syncing" && "animate-spin")} />
      {label}
    </Link>
  );
}
