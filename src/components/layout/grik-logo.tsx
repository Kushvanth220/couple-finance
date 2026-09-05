"use client";

import { OWNER_LABEL, PARTNER_LABEL } from "@/lib/branding";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GrikMark } from "@/components/layout/grik-mark";
import { BRAND_INITIALS } from "@/lib/brand";
import { cn } from "@/lib/utils";

interface GrikLogoProps {
  size?: "header" | "hero";
  showSubtitle?: boolean;
  className?: string;
  asLink?: boolean;
}

export function GrikLogo({
  size = "header",
  showSubtitle = true,
  className,
  asLink = true,
}: GrikLogoProps) {
  const isHero = size === "hero";
  const [motionReady, setMotionReady] = useState(false);

  useEffect(() => {
    setMotionReady(true);
  }, []);

  const content = (
    <div className={cn("relative inline-flex items-center gap-2.5", className)}>
      <div className="relative shrink-0">
        <div
          className={cn(
            "grik-glow absolute -inset-1.5 rounded-full blur-lg pointer-events-none",
            isHero ? "opacity-60" : "opacity-45"
          )}
          aria-hidden
        />
        <GrikMark
          className={cn("relative", isHero ? "w-12 h-12 md:w-14 md:h-14" : "w-8 h-8")}
        />
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "inline-flex font-bold tracking-tight",
              isHero ? "text-4xl md:text-5xl" : "text-xl"
            )}
          >
            {BRAND_INITIALS.split("").map((letter, index) => (
              <span
                key={`${letter}-${index}`}
                className={cn(
                  "grik-gradient-text inline-block",
                  motionReady && "grik-letter"
                )}
                style={{ animationDelay: `${index * 0.07}s` }}
              >
                {letter}
              </span>
            ))}
          </span>

          <span
            className={cn(
              "grik-finance font-semibold tracking-tight grik-finance-text relative overflow-hidden inline-block",
              isHero ? "text-2xl md:text-3xl" : "text-base"
            )}
          >
            Finance
          </span>
        </div>

        {showSubtitle && (
          <p
            suppressHydrationWarning
            className={cn(
              "mt-0.5 flex items-center gap-1",
              motionReady && "grik-subtitle",
              isHero ? "text-sm" : "text-[11px]"
            )}
          >
            <span className="grik-name-kush">{OWNER_LABEL}</span>
            <span className="text-muted grik-amp">&</span>
            <span className="grik-name-grish">{PARTNER_LABEL}</span>
          </p>
        )}
      </div>
    </div>
  );

  if (!asLink) return content;

  return (
    <Link
      href="/"
      aria-label="KG Finance — home"
      className="group outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-[#007aff]/50"
    >
      {content}
    </Link>
  );
}
