import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { BetweenUsCelebrationPayload } from "@/lib/between-us-celebration";

export interface BetweenUsCelebrationEvent extends BetweenUsCelebrationPayload {
  id: string;
}

interface BetweenUsCelebrationStore {
  event: BetweenUsCelebrationEvent | null;
  show: (payload: BetweenUsCelebrationPayload) => void;
  dismiss: () => void;
}

export const useBetweenUsCelebrationStore = create<BetweenUsCelebrationStore>((set) => ({
  event: null,
  show: (payload) => set({ event: { ...payload, id: uuidv4() } }),
  dismiss: () => set({ event: null }),
}));
