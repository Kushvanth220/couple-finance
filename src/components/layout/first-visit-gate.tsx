"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A first visit lands on the front door; every visit after that lands on the
 * app.
 *
 * "First" means this browser has never held any finance data — the persisted
 * store key does not exist yet. Once the app has synced even once the key is
 * there, and the intro stays out of the way. A session flag covers the walk
 * from the intro's "Open the app" button, before any data has arrived.
 */

const STORE_KEY = "couple-finance-storage-v4";
export const INTRO_SEEN_KEY = "kg-intro-seen";

export function FirstVisitGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== "/") return;
    try {
      const hasData = localStorage.getItem(STORE_KEY) !== null;
      const seen = sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
      if (!hasData && !seen) router.replace("/intro");
    } catch {
      // Storage blocked (private mode, etc.): show the app, never a loop.
    }
  }, [pathname, router]);

  return null;
}
