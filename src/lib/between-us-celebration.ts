import { formatCurrency } from "./formatters";
import { getInterCoupleSummary } from "./inter-couple";
import { useBetweenUsCelebrationStore } from "@/store/between-us-celebration-store";
import { PERSON_LABELS, type InterCoupleEntry } from "@/types";

export interface BetweenUsCelebrationPayload {
  title: string;
  subtitle: string;
  emoji: string;
  sparkles: string[];
  balanceLabel: string;
}

const SKIP_MESSAGES = new Set(["Starting balance", "Manual balance adjustment"]);

function pickVariant<T>(items: T[], seed: string): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % items.length;
  }
  return items[hash]!;
}

export function buildBetweenUsCelebration(
  newEntries: InterCoupleEntry[],
  balanceAfter: number
): BetweenUsCelebrationPayload | null {
  const entries = newEntries.filter(
    (entry) => !entry.autoMessage || !SKIP_MESSAGES.has(entry.autoMessage)
  );
  if (entries.length === 0) return null;

  const summary = getInterCoupleSummary(balanceAfter);
  const balanceLabel =
    summary.amount === 0
      ? summary.label
      : `${summary.label} · ${formatCurrency(summary.amount)}`;

  if (Math.abs(balanceAfter) < 0.01) {
    return pickVariant(
      [
        {
          title: "Perfectly even!",
          subtitle: "You two are totally synced — no one owes anyone!",
          emoji: "🎉",
          sparkles: ["✨", "💫", "🌟", "💖", "🎊"],
          balanceLabel,
        },
        {
          title: "All squared up!",
          subtitle: "Fair and balanced — that's couple goals right there!",
          emoji: "⚖️",
          sparkles: ["💕", "✨", "🥳", "💫", "🌈"],
          balanceLabel,
        },
      ],
      entries.map((e) => e.id).join("-")
    );
  }

  if (entries.length > 1) {
    return pickVariant(
      [
        {
          title: "Shared with love!",
          subtitle: "You split it fairly — teamwork at its cutest!",
          emoji: "💕",
          sparkles: ["✨", "💖", "🫶", "💫", "🌸"],
          balanceLabel,
        },
        {
          title: "Better together!",
          subtitle: "Between Us got a little update — you're taking care of each other!",
          emoji: "🫶",
          sparkles: ["💜", "💙", "✨", "🌟", "💗"],
          balanceLabel,
        },
      ],
      entries.map((e) => e.id).join("-")
    );
  }

  const entry = entries[0]!;
  const amountText = formatCurrency(entry.amount);

  if (entry.paidBy === "kushvanth" && entry.benefited === "grishma") {
    return pickVariant(
      [
        {
          title: "What a partner!",
          subtitle: `${PERSON_LABELS.kushvanth} covered ${amountText} for ${PERSON_LABELS.grishma} — so sweet!`,
          emoji: "💙",
          sparkles: ["✨", "💙", "🫶", "⭐", "💫"],
          balanceLabel,
        },
        {
          title: "You've got her back!",
          subtitle: `Nice one, ${PERSON_LABELS.kushvanth}! ${PERSON_LABELS.grishma} owes you ${amountText}`,
          emoji: "🌟",
          sparkles: ["💙", "✨", "💖", "🎉", "💫"],
          balanceLabel,
        },
      ],
      entry.id
    );
  }

  if (entry.paidBy === "grishma" && entry.benefited === "kushvanth") {
    return pickVariant(
      [
        {
          title: "So thoughtful!",
          subtitle: `${PERSON_LABELS.grishma} paid ${amountText} for ${PERSON_LABELS.kushvanth} — love that!`,
          emoji: "💜",
          sparkles: ["✨", "💜", "🫶", "⭐", "💫"],
          balanceLabel,
        },
        {
          title: "She's the best!",
          subtitle: `${PERSON_LABELS.grishma} got this one — ${PERSON_LABELS.kushvanth} owes ${amountText}`,
          emoji: "💖",
          sparkles: ["💜", "✨", "🌸", "🎊", "💫"],
          balanceLabel,
        },
      ],
      entry.id
    );
  }

  return {
    title: "Between Us updated!",
    subtitle: "You took care of each other — that's what partners do!",
    emoji: "💞",
    sparkles: ["✨", "💕", "🫶", "⭐", "💫"],
    balanceLabel,
  };
}

export function celebrateBetweenUsUpdate(
  newEntries: InterCoupleEntry[],
  balanceAfter: number
) {
  const payload = buildBetweenUsCelebration(newEntries, balanceAfter);
  if (!payload) return;
  useBetweenUsCelebrationStore.getState().show(payload);
}
