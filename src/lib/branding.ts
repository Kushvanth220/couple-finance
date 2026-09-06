/**
 * Display names and decorative flourishes, in one place.
 *
 * Kushvanth asked to show "G" instead of Grishma's name for a while, and to
 * drop the hearts. It is a presentation choice, not a data one — the stored
 * person id stays `grishma`, and the assistant still UNDERSTANDS the spoken
 * name (see USER_ALIASES in lib/ai/person.ts). Only what appears on screen and
 * what the assistant says out loud changes.
 *
 * To put it all back: set PARTNER_LABEL to "Grishma" and SHOW_AFFECTION to
 * true. Nothing else needs touching.
 */

export const OWNER_LABEL: string = "Kushvanth";

/** What Grishma is called on screen and by the assistant. */
export const PARTNER_LABEL: string = "G";

/** Hearts, sparkles and the couple framing. */
export const SHOW_AFFECTION: boolean = false;

/**
 * Show the two names under the KG mark, in the header and the splash.
 *
 * Off: the brand stands on its own. The names still appear wherever they carry
 * meaning — whose account, whose expense, who is speaking — this only removes
 * them as decoration beneath the logo.
 */
export const SHOW_NAMES: boolean = false;

/** "Kushvanth & G" — used in headers, titles and the assistant's own blurb. */
export const HOUSEHOLD_LABEL = `${OWNER_LABEL} & ${PARTNER_LABEL}`;

/**
 * Swap the partner's name inside text that was STORED earlier.
 *
 * History records carry the sentence generated when they were written, e.g.
 * "Kushvanth gave $10 to Grishma (outside accounts)". Rewriting those rows
 * would edit the household's records to suit a display preference, so the swap
 * happens on the way to the screen instead — and putting PARTNER_LABEL back to
 * "Grishma" restores them untouched.
 */
export function displayText<T>(text: T): T {
  if (typeof text !== "string" || !text || PARTNER_LABEL === "Grishma") return text;
  return text.replace(/\bGrishma\b/g, PARTNER_LABEL) as T;
}
