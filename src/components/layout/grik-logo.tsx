"use client";

import Link from "next/link";
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

  const content = (
    <div className={cn("relative inline-block", className)}>
      <div
        className={cn(
          "grik-glow absolute -inset-2 rounded-2xl blur-xl pointer-events-none",
          isHero ? "opacity-70" : "opacity-50"
        )}
        aria-hidden
      />

      <div className="relative flex items-baseline gap-1.5">
        <span
          className={cn(
            "grik-word inline-flex font-bold tracking-tight",
            isHero ? "text-4xl md:text-5xl" : "text-xl"
          )}
        >
          {BRAND_INITIALS.split("").map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              className="grik-letter grik-gradient-text inline-block"
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
          className={cn(
            "grik-subtitle mt-0.5 flex items-center gap-1",
            isHero ? "text-sm" : "text-[11px]"
          )}
        >
          <span className="grik-name-kush">Kushvanth</span>
          <span className="text-muted grik-amp">&</span>
          <span className="grik-name-grish">Grishma</span>
        </p>
      )}
    </div>
  );

  if (!asLink) return content;

  return (
    <Link href="/" className="group outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-[#007aff]/50">
      {content}
    </Link>
  );
}
