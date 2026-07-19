"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const INCOME_COLOR = "#34c759";
const SPEND_COLOR = "#ff3b30";
const DEBT_COLOR = "#ff9500";
const OTHER_COLOR = "#5856d6";
const LEFT_COLOR = "#007aff";

export type TrendPoint = {
  key: string;
  label: string;
  income: number;
  spend: number;
  left: number;
};

type Segment = { name: string; value: number; color: string; id?: string };

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg px-2.5 py-2 text-xs shadow-lg border border-black/5 dark:border-white/10 bg-[var(--glass-bg)] backdrop-blur-md">
      {label && <p className="font-semibold mb-1">{label}</p>}
      {payload.map((item) => (
        <p key={item.name} className="flex justify-between gap-3 tabular-nums">
          <span style={{ color: item.color }}>{item.name}</span>
          <span className="font-semibold">{formatCurrency(item.value)}</span>
        </p>
      ))}
      <p className="text-[10px] text-muted mt-1.5 pt-1 border-t border-black/5 dark:border-white/10">
        Tap to see list
      </p>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-[140px] flex items-center justify-center text-xs text-muted text-center px-4">
      {message}
    </div>
  );
}

function LegendRow({
  items,
  activeName,
  onItemClick,
}: {
  items: { name: string; value: number; color: string; pct?: number; id?: string }[];
  activeName?: string | null;
  onItemClick?: (id: string, name: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {items.map((item) => {
        const id = item.id ?? item.name;
        const clickable = Boolean(onItemClick);
        return (
          <button
            key={item.name}
            type="button"
            disabled={!clickable}
            onClick={() => onItemClick?.(id, item.name)}
            className={cn(
              "flex items-center gap-1.5 text-[10px] rounded-md px-1 py-0.5 transition-colors",
              clickable && "hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer",
              activeName === id && "bg-black/5 dark:bg-white/10 ring-1 ring-black/10 dark:ring-white/10"
            )}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-muted">{item.name}</span>
            <span className="font-semibold tabular-nums">
              {item.pct != null ? `${item.pct}%` : formatCurrency(item.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function IncomeVsSpendChart({
  data,
  onBarClick,
  activeKey,
}: {
  data: TrendPoint[];
  onBarClick?: (monthKey: string, series: "income" | "spend") => void;
  activeKey?: string | null;
}) {
  const hasData = data.some((point) => point.income > 0 || point.spend > 0);
  if (!hasData) return <EmptyChart message="No income or spending in this period" />;

  return (
    <div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={2}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
          />
          <Tooltip
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label != null ? String(label) : undefined}
                payload={payload?.map((entry) => ({
                  name: entry.name === "income" ? "Income" : "Spending",
                  value: Number(entry.value),
                  color: entry.name === "income" ? INCOME_COLOR : SPEND_COLOR,
                }))}
              />
            )}
          />
          <Bar
            dataKey="income"
            name="income"
            fill={INCOME_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={14}
            className="cursor-pointer"
            onClick={(data) => {
              const payload = (data as { payload?: TrendPoint }).payload;
              if (payload?.key) onBarClick?.(payload.key, "income");
            }}
            opacity={activeKey ? 0.45 : 1}
          />
          <Bar
            dataKey="spend"
            name="spend"
            fill={SPEND_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={14}
            className="cursor-pointer"
            onClick={(data) => {
              const payload = (data as { payload?: TrendPoint }).payload;
              if (payload?.key) onBarClick?.(payload.key, "spend");
            }}
            opacity={activeKey ? 0.45 : 1}
          />
        </BarChart>
      </ResponsiveContainer>
      <LegendRow
        items={[
          { name: "Income", value: 0, color: INCOME_COLOR, id: "income" },
          { name: "Spending", value: 0, color: SPEND_COLOR, id: "spend" },
        ]}
      />
      <p className="text-[10px] text-muted mt-1">Tap a bar to see that month&apos;s list</p>
    </div>
  );
}

export function SpendDonutChart({
  debt,
  other,
  onSliceClick,
  onCenterClick,
  activeSlice,
}: {
  debt: number;
  other: number;
  onSliceClick?: (slice: "debt" | "other") => void;
  onCenterClick?: () => void;
  activeSlice?: "debt" | "other" | null;
}) {
  const total = debt + other;
  if (total <= 0) return <EmptyChart message="No spending this month" />;

  const segments: Segment[] = [
    { name: "Debt & Us", value: debt, color: DEBT_COLOR, id: "debt" },
    { name: "Other", value: other, color: OTHER_COLOR, id: "other" },
  ].filter((s) => s.value > 0);

  const legend = segments.map((s) => ({
    ...s,
    pct: Math.round((s.value / total) * 100),
  }));

  return (
    <div>
      <div className="relative h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={54}
              paddingAngle={3}
              stroke="none"
              className="cursor-pointer"
              onClick={(row) => {
                const id = (row as { payload?: Segment }).payload?.id;
                if (id === "debt" || id === "other") onSliceClick?.(id);
              }}
            >
              {segments.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.color}
                  opacity={activeSlice && activeSlice !== entry.id ? 0.35 : 1}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => (
                <ChartTooltip
                  active={active}
                  payload={payload?.map((entry) => ({
                    name: String(entry.name),
                    value: Number(entry.value),
                    color: (entry.payload as Segment).color,
                  }))}
                />
              )}
            />
          </PieChart>
        </ResponsiveContainer>
        <button
          type="button"
          onClick={onCenterClick}
          className="absolute inset-0 flex flex-col items-center justify-center"
          aria-label="Show all spending"
        >
          <p className="text-[10px] text-muted">Total out</p>
          <p className="text-sm font-bold tabular-nums">{formatCurrency(total)}</p>
        </button>
      </div>
      <LegendRow
        items={legend}
        activeName={activeSlice}
        onItemClick={(id) => onSliceClick?.(id as "debt" | "other")}
      />
    </div>
  );
}

export function IncomeDonutChart({
  segments,
  onSliceClick,
  activeSlice,
}: {
  segments: { name: string; amount: number }[];
  onSliceClick?: (sourceName: string) => void;
  activeSlice?: string | null;
}) {
  const total = segments.reduce((sum, s) => sum + s.amount, 0);
  if (total <= 0) return <EmptyChart message="No income this month" />;

  const palette = ["#34c759", "#30d158", "#007aff", "#5856d6", "#ff9500"];
  const top = segments.slice(0, 4);
  const rest = segments.slice(4).reduce((sum, s) => sum + s.amount, 0);
  const chartData: Segment[] = top.map((s, i) => ({
    name: s.name,
    value: s.amount,
    color: palette[i % palette.length]!,
    id: s.name,
  }));
  if (rest > 0) {
    chartData.push({ name: "Other", value: rest, color: "#8e8e93", id: "__other__" });
  }

  const legend = chartData.map((s) => ({
    ...s,
    pct: Math.round((s.value / total) * 100),
  }));

  return (
    <div>
      <div className="relative h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={54}
              paddingAngle={2}
              stroke="none"
              className="cursor-pointer"
              onClick={(row) => {
                const id = (row as { payload?: Segment }).payload?.id;
                if (id) onSliceClick?.(id);
              }}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.color}
                  opacity={activeSlice && activeSlice !== entry.id ? 0.35 : 1}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => (
                <ChartTooltip
                  active={active}
                  payload={payload?.map((entry) => ({
                    name: String(entry.name),
                    value: Number(entry.value),
                    color: (entry.payload as Segment).color,
                  }))}
                />
              )}
            />
          </PieChart>
        </ResponsiveContainer>
        <button
          type="button"
          onClick={() => onSliceClick?.("__all__")}
          className="absolute inset-0 flex flex-col items-center justify-center"
          aria-label="Show all income"
        >
          <p className="text-[10px] text-muted">Total in</p>
          <p className="text-sm font-bold tabular-nums">{formatCurrency(total)}</p>
        </button>
      </div>
      <LegendRow
        items={legend}
        activeName={activeSlice}
        onItemClick={(id) => onSliceClick?.(id)}
      />
    </div>
  );
}

export function LeftTrendChart({
  data,
  onPointClick,
  activeKey,
}: {
  data: TrendPoint[];
  onPointClick?: (monthKey: string) => void;
  activeKey?: string | null;
}) {
  const hasData = data.some((point) => point.left !== 0 || point.income > 0);
  if (!hasData) return <EmptyChart message="Not enough history yet" />;

  return (
    <div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="leftGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LEFT_COLOR} stopOpacity={0.35} />
              <stop offset="100%" stopColor={LEFT_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
          />
          <Tooltip
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label != null ? String(label) : undefined}
                payload={payload?.map((entry) => ({
                  name: "Left over",
                  value: Number(entry.value),
                  color: LEFT_COLOR,
                }))}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="left"
            stroke={LEFT_COLOR}
            strokeWidth={2}
            fill="url(#leftGradient)"
            activeDot={{ r: 5, cursor: "pointer" }}
            dot={({ cx, cy, payload }) => {
              const point = payload as TrendPoint;
              const dimmed = activeKey && activeKey !== point.key;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={dimmed ? 2.5 : 4}
                  fill={LEFT_COLOR}
                  strokeWidth={0}
                  opacity={dimmed ? 0.35 : 1}
                  className="cursor-pointer"
                  onClick={() => onPointClick?.(point.key)}
                />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted mt-1">Tap a dot to see that month&apos;s activity</p>
    </div>
  );
}
