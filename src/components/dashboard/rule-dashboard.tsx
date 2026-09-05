"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, ScrollText } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { FlexChart, type FlexChartType } from "@/components/charts/flex-chart";
import { CHART_TYPE_OPTIONS } from "@/components/charts/flex-chart";
import { useRulesStore } from "@/store/rules-store";
import { buildRuleTable, summariseTable } from "@/lib/rules/engine";
import { formatCurrency } from "@/lib/formatters";
import type { Person } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Rule dashboards on the home page.
 *
 * A rule that collects data is only useful if its numbers are where you
 * already look. Any rule marked "show on the dashboard" gets its charts and a
 * short summary here, with the chart type switchable in place — the same
 * renderer the Rules page uses, so a shape chosen in one is the shape seen in
 * the other.
 */
export function RuleDashboards({ person }: { person: Person | "overall" }) {
  const rules = useRulesStore((state) => state.rules);
  const entries = useRulesStore((state) => state.entries);
  const [overrides, setOverrides] = useState<Record<string, FlexChartType>>({});

  const shown = rules.filter((rule) => {
    if (!rule.showOnDashboard || !rule.enabled) return false;
    if (person === "overall") return true;
    return rule.scope === person || rule.scope === "household";
  });

  if (shown.length === 0) return null;

  return (
    <>
      {shown.map((rule) => {
        const ruleEntries = entries.filter((entry) => entry.ruleId === rule.id);
        const table = buildRuleTable(rule, ruleEntries);
        const totals = summariseTable(table, rule);
        const headline = rule.calculations[0];

        // Oldest first reads left-to-right as time moving forward.
        const rows = table.rows.slice().reverse();
        const chart = rule.charts[0];
        const activeType: FlexChartType =
          overrides[rule.id] ?? ((chart?.type as FlexChartType) ?? "bar");
        const measure = chart?.y ?? headline?.key ?? "";
        const money = table.columns.find((column) => column.key === measure)?.money ?? true;

        const points = rows.map((row) => ({
          label: String(row[chart?.x ?? "date"] ?? row.date ?? ""),
          value: Number(row[measure] ?? 0),
          ...(chart?.size ? { size: Number(row[chart.size] ?? 1) } : {}),
        }));

        return (
          <GlassCard key={rule.id} className="!p-0 overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-4 pt-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#007aff]">
                  <ScrollText className="h-3 w-3" /> {rule.name}
                </p>
                {headline && totals[headline.key] !== undefined ? (
                  <p className="mt-0.5 text-xl font-semibold tabular-nums">
                    {headline.money
                      ? formatCurrency(totals[headline.key]!)
                      : totals[headline.key]}
                    <span className="ml-1.5 text-[11px] font-normal text-muted">
                      {headline.label.toLowerCase()} · {ruleEntries.length}{" "}
                      {ruleEntries.length === 1 ? "entry" : "entries"}
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-muted">
                    {ruleEntries.length} {ruleEntries.length === 1 ? "entry" : "entries"}
                  </p>
                )}
              </div>
              <Link
                href="/rules"
                className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#007aff]"
              >
                Open <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            {/* Pick the shape here without leaving the page. */}
            <div className="flex gap-1 overflow-x-auto px-4 pt-2 pb-1">
              {CHART_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setOverrides((current) => ({ ...current, [rule.id]: option.value }))
                  }
                  className={cn(
                    "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors",
                    activeType === option.value
                      ? "bg-[#007aff] text-white"
                      : "glass text-muted hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="px-2 pb-3">
              <FlexChart
                type={activeType}
                data={points}
                money={money}
                height={190}
                emptyMessage={`Nothing logged under ${rule.name} yet.`}
              />
            </div>
          </GlassCard>
        );
      })}
    </>
  );
}
