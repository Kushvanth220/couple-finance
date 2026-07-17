import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  strong?: boolean;
  onClick?: () => void;
}

export function GlassCard({ children, className, strong, onClick }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--card-radius)] p-5 transition-all duration-300",
        strong ? "glass-strong" : "glass",
        onClick && "cursor-pointer hover:scale-[1.01] active:scale-[0.99]",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
