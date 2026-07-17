"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface GlassModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function GlassModal({ open, onClose, title, children, className }: GlassModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in-up"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full max-w-md glass-strong rounded-3xl p-6 animate-scale-in max-h-[85dvh] overflow-y-auto",
          className
        )}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
