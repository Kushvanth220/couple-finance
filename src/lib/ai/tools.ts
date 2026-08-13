/** Shared Gemini function declarations for text + live voice. */
export const ASSISTANT_FUNCTION_DECLARATIONS = [
  {
    name: "list_accounts",
    description:
      "List bank accounts (debit, credit, cash) with ids, names, types, and balances. Use for_person when asking which account Kushvanth or Grishma paid from.",
    parameters: {
      type: "object",
      properties: {
        for_person: {
          type: "string",
          description: "kushvanth or grishma — whose accounts to list. Defaults to the current user.",
        },
      },
    },
  },
  {
    name: "list_spend_categories",
    description: "List spend categories (Groceries, Gas, etc.) available in the app.",
  },
  {
    name: "list_income_sources",
    description:
      "List the user's income sources (Doordash, Salary, etc.) with ids and names. Call before recording income if the source is unclear.",
  },
  {
    name: "record_income",
    description:
      "Record a new income deposit. Creates a history entry and credits the chosen account. Only call after you know amount, source, and deposit account.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Income amount in USD" },
        source_name: {
          type: "string",
          description: "Income source label, e.g. Doordash, Salary, On campus",
        },
        deposit_account_id: {
          type: "string",
          description: "Account id from list_accounts where money was deposited",
        },
        deposit_account_name: {
          type: "string",
          description: "Alternative to deposit_account_id — partial account name match",
        },
        date: {
          type: "string",
          description: "Date yyyy-MM-dd. Defaults to today.",
        },
        notes: { type: "string", description: "Optional note" },
        for_person: {
          type: "string",
          description: "Whose income: kushvanth or grishma",
        },
        user_confirmed: {
          type: "boolean",
          description: "Must be true only after the user verbally confirms the preview.",
        },
      },
      required: ["amount", "source_name"],
    },
  },
  {
    name: "record_expense",
    description:
      "Record spending exactly like the Spend page. Ask who the expense is for, who paid, and which account(s) — including splits between Kushvanth and Grishma. Do not call until those details are clear.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Total expense amount in USD" },
        category: {
          type: "string",
          description: "Spend category, e.g. Groceries, Gas, Food",
        },
        notes: { type: "string", description: "Optional note — also used to guess category" },
        expense_for: {
          type: "string",
          description:
            "Whose cost: kushvanth, grishma, or both. 'me' is whoever is speaking. 'me and Grishma', 'we spent', or 'split' = both. This is NOT who paid.",
        },
        paid_by: {
          type: "string",
          description:
            "Who paid the money: kushvanth, grishma, or split when both paid part. Default to whoever is speaking unless they name someone else. A shared expense can be paid entirely by Grishma (paid_by grishma, expense_for both).",
        },
        split_expense_evenly: {
          type: "boolean",
          description:
            "When expense_for is both, split the expense 50/50. Default true if shares not given.",
        },
        kushvanth_expense_share: {
          type: "number",
          description: "Kushvanth's share of the expense when expense_for is both",
        },
        grishma_expense_share: {
          type: "number",
          description: "Grishma's share of the expense when expense_for is both",
        },
        account_id: {
          type: "string",
          description: "Paying account id (single payer — use payer's account)",
        },
        account_name: {
          type: "string",
          description: "Alternative to account_id — partial account name for the payer",
        },
        cash_source_account_id: {
          type: "string",
          description: "If paying from cash wallet, optional debit account the cash came from",
        },
        cash_source_account_name: {
          type: "string",
          description: "Alternative to cash_source_account_id",
        },
        kushvanth_paid_amount: {
          type: "number",
          description: "When paid_by is split — how much Kushvanth paid",
        },
        grishma_paid_amount: {
          type: "number",
          description: "When paid_by is split — how much Grishma paid",
        },
        kushvanth_account_id: { type: "string", description: "Kushvanth's account when paid_by is split" },
        kushvanth_account_name: { type: "string" },
        grishma_account_id: { type: "string", description: "Grishma's account when paid_by is split" },
        grishma_account_name: { type: "string" },
        kushvanth_cash_source_account_id: { type: "string" },
        grishma_cash_source_account_id: { type: "string" },
        user_confirmed: {
          type: "boolean",
          description: "Must be true only after the user verbally confirms the preview.",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "add_debt",
    description: "Add a new debt note for the user.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Who or what is owed, e.g. Credit card, John" },
        amount: { type: "number", description: "Debt amount in USD" },
        notes: { type: "string", description: "Optional note" },
        user_confirmed: {
          type: "boolean",
          description: "Must be true only after the user verbally confirms the preview.",
        },
      },
      required: ["name", "amount"],
    },
  },
  {
    name: "record_debt_payment",
    description: "Record a payment toward an existing debt (without choosing a bank account).",
    parameters: {
      type: "object",
      properties: {
        debt_id: { type: "string", description: "Debt id from the snapshot" },
        debt_name: { type: "string", description: "Partial debt name match" },
        amount: { type: "number", description: "Payment amount in USD" },
        notes: { type: "string", description: "Optional note" },
        user_confirmed: {
          type: "boolean",
          description: "Must be true only after the user verbally confirms the preview.",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "pay_debt_from_account",
    description: "Pay a debt from a specific bank account.",
    parameters: {
      type: "object",
      properties: {
        debt_id: { type: "string" },
        debt_name: { type: "string" },
        amount: { type: "number" },
        from_account_id: { type: "string" },
        from_account_name: { type: "string" },
        notes: { type: "string" },
        user_confirmed: {
          type: "boolean",
          description: "Must be true only after the user verbally confirms the preview.",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "adjust_account_balance",
    description:
      "Set an account to an exact current balance (Green Dot, Chime, etc.). Use when the user says update/set/change/adjust the balance. This writes to Accounts and History. Ask for the new balance if missing, read it back, wait for yes, then call again with user_confirmed true.",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Account id from list_accounts" },
        account_name: {
          type: "string",
          description: "Account name, e.g. GreenDot, Green Dot, Chime",
        },
        new_balance: {
          type: "number",
          description: "The exact new balance in USD, e.g. 600",
        },
        notes: { type: "string", description: "Optional note for History" },
        user_confirmed: {
          type: "boolean",
          description: "Must be true only after the user confirms the preview.",
        },
      },
      required: ["new_balance"],
    },
  },
  {
    name: "calculate_monthly_summary",
    description:
      "Calculate monthly income and spend totals for a person using the app's algorithms. Use before stating totals.",
    parameters: {
      type: "object",
      properties: {
        for_person: { type: "string", description: "kushvanth or grishma" },
        month: { type: "string", description: "Optional yyyy-MM, defaults to current month" },
      },
      required: ["for_person"],
    },
  },
  {
    name: "calculate_net_worth",
    description: "Calculate net worth (accounts minus debts) for a person or household.",
    parameters: {
      type: "object",
      properties: {
        for_person: {
          type: "string",
          description: "kushvanth, grishma, or omit for combined household",
        },
      },
    },
  },
  {
    name: "calculate_category_breakdown",
    description: "Group current month expenses by category for a person.",
    parameters: {
      type: "object",
      properties: {
        for_person: { type: "string", description: "kushvanth or grishma" },
        month: { type: "string", description: "Optional yyyy-MM" },
      },
      required: ["for_person"],
    },
  },
  {
    name: "calculate_between_us_balance",
    description: "Get inter-couple balance and who owes whom (Between Us).",
  },
  {
    name: "preview_expense_split",
    description:
      "Preview split math before recording — equal or custom shares, returns per-person amounts.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Total expense amount" },
        split_evenly: { type: "boolean", description: "Default true — 50/50 split" },
        kushvanth_share: { type: "number" },
        grishma_share: { type: "number" },
      },
      required: ["amount"],
    },
  },
  {
    name: "save_behavior_preference",
    description:
      "Save a user instruction to remember for future sessions (e.g. be more concise, format USD). Saves immediately — no confirmation needed.",
    parameters: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "The preference to remember" },
      },
      required: ["instruction"],
    },
  },
  {
    name: "save_reminder",
    description:
      "Save a reminder, bill, schedule, or to-do. Use when they say remind me, remember, don't forget, or describe a recurring bill. Saves immediately — no confirmation.",
    parameters: {
      type: "object",
      properties: {
        reminder: { type: "string", description: "What to remember, in the user's words" },
        when: {
          type: "string",
          description: "Timing, e.g. 3rd of every month, every Friday, tomorrow, from the 24th",
        },
        timezone: {
          type: "string",
          description: "us or india — India bills should mention both time zones",
        },
      },
      required: ["reminder"],
    },
  },
  {
    name: "list_reminders",
    description: "List all saved reminders, bills, and notes with pending/done status.",
  },
  {
    name: "mark_reminder_done",
    description:
      "Mark a reminder or bill as done for this cycle after the user confirms they paid, submitted, or canceled it.",
    parameters: {
      type: "object",
      properties: {
        reminder: {
          type: "string",
          description: "Partial match of the reminder text, e.g. rent, Workday, T-Mobile",
        },
      },
      required: ["reminder"],
    },
  },
  {
    name: "get_daily_briefing",
    description:
      "Get today's date plus due/pending reminders. Call this when the user asks what's up, any updates, or after greeting before mentioning reminders.",
  },
];

export const ASSISTANT_TOOLS = [{ functionDeclarations: ASSISTANT_FUNCTION_DECLARATIONS }];

export interface AssistantToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AssistantToolResult {
  id: string;
  name: string;
  result: Record<string, unknown>;
}
