import { cn } from "@/lib/utils";

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export function GlassButton({
  children,
  className,
  variant = "primary",
  size = "md",
  disabled,
  ...props
}: GlassButtonProps) {
  const variants = {
    primary: "bg-[#007aff] text-white hover:bg-[#0066d6] shadow-lg shadow-blue-500/25",
    secondary: "glass text-foreground hover:bg-white/80 dark:hover:bg-white/10",
    danger: "bg-[#ff3b30] text-white hover:bg-[#e0352b] shadow-lg shadow-red-500/25",
    ghost: "bg-transparent hover:bg-black/5 dark:hover:bg-white/5",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm rounded-xl",
    md: "px-5 py-2.5 text-sm font-medium rounded-2xl",
    lg: "px-8 py-4 text-base font-semibold rounded-2xl",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-all duration-200",
        "active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
