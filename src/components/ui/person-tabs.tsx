"use client";

import { cn } from "@/lib/utils";
import { PERSON_LABELS, type Person } from "@/types";

interface PersonTabsProps {
  value: Person;
  onChange: (person: Person) => void;
  className?: string;
}

export function PersonTabs({ value, onChange, className }: PersonTabsProps) {
  const persons: Person[] = ["kushvanth", "grishma"];

  return (
    <div className={cn("glass rounded-2xl p-1 flex gap-1", className)}>
      {persons.map((person) => (
        <button
          key={person}
          onClick={() => onChange(person)}
          className={cn(
            "flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-300",
            value === person
              ? "bg-[#007aff] text-white shadow-md"
              : "text-muted hover:text-foreground"
          )}
        >
          {PERSON_LABELS[person]}
        </button>
      ))}
    </div>
  );
}
