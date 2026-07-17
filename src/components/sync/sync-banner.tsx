"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function SyncBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setShow(true);
      return;
    }

    const supabase = createClient();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      setShow(!session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setShow(!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!show) return null;

  const configured = isSupabaseConfigured();

  return (
    <div className="mb-4 rounded-2xl border border-[#ff9500]/30 bg-[#ff9500]/10 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-[#ff9500] shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium text-foreground">
          {configured
            ? "Sign in on this phone to sync with your other device"
            : "Cloud sync is not set up yet"}
        </p>
        <p className="text-muted mt-0.5">
          {configured
            ? "Both phones must use the same Sync account, or changes stay on this device only."
            : "Add Supabase keys and run the SQL migration, then sign in on every device."}
        </p>
        <Link href="/sync" className="inline-block mt-2 text-[#007aff] font-medium">
          Open Sync settings →
        </Link>
      </div>
    </div>
  );
}
