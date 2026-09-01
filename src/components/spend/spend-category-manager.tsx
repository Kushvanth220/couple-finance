"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassModal } from "@/components/ui/glass-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useFinanceStore } from "@/store/finance-store";
import type { SpendCategory } from "@/types";

interface SpendCategoryManagerProps {
  open: boolean;
  onClose: () => void;
  onCategoryDeleted?: (id: string) => void;
}

export function SpendCategoryManager({
  open,
  onClose,
  onCategoryDeleted,
}: SpendCategoryManagerProps) {
  const { spendCategories, addSpendCategory, updateSpendCategory, deleteSpendCategory } =
    useFinanceStore();

  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [catName, setCatName] = useState("");
  const [catKeywords, setCatKeywords] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SpendCategory | null>(null);

  const resetForm = () => {
    setEditCategoryId(null);
    setCatName("");
    setCatKeywords("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSave = () => {
    const name = catName.trim();
    if (!name) return;

    const keywords = catKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (editCategoryId) {
      updateSpendCategory(editCategoryId, { name, keywords });
    } else {
      addSpendCategory(name, keywords);
    }

    resetForm();
  };

  const handleEdit = (category: SpendCategory) => {
    setEditCategoryId(category.id);
    setCatName(category.name);
    setCatKeywords((category.keywords ?? []).join(", "));
  };

  const handleDelete = (id: string) => {
    deleteSpendCategory(id);
    onCategoryDeleted?.(id);
    if (editCategoryId === id) {
      resetForm();
    }
    setPendingDelete(null);
  };

  if (pendingDelete) {
    return (
      <ConfirmDialog
        open
        title="Delete category?"
        message={`"${pendingDelete.name}" will be removed from the category list. Past spending keeps its category name in History.`}
        confirmLabel="Delete category"
        onConfirm={() => handleDelete(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    );
  }

  return (
    <GlassModal open={open} onClose={handleClose} title="Edit categories">
      <div className="space-y-4">
        <div className="space-y-2 max-h-52 overflow-y-auto">
          {spendCategories.map((category) => (
            <div
              key={category.id}
              className="flex items-center justify-between gap-2 rounded-xl glass px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{category.name}</p>
                {(category.keywords?.length ?? 0) > 0 && (
                  <p className="text-[10px] text-muted truncate">
                    {(category.keywords ?? []).join(", ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleEdit(category)}
                  className="tap-icon focus-ring p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                  aria-label={`Edit ${category.name}`}
                >
                  <Pencil className="w-3.5 h-3.5 text-[#007aff]" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(category)}
                  className="tap-icon focus-ring p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                  aria-label={`Delete ${category.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-[#ff3b30]" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-2 border-t border-black/5 dark:border-white/10">
          <p className="text-sm font-medium">
            {editCategoryId ? "Edit category" : "Add category"}
          </p>
          <input
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="Category name"
            className="w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
          />
          <input
            value={catKeywords}
            onChange={(e) => setCatKeywords(e.target.value)}
            placeholder="Keywords (comma-separated, optional)"
            className="w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
          />
          <div className="flex gap-2">
            {editCategoryId && (
              <GlassButton variant="ghost" className="flex-1" onClick={resetForm}>
                Cancel edit
              </GlassButton>
            )}
            <GlassButton className="flex-1" onClick={handleSave} disabled={!catName.trim()}>
              {editCategoryId ? (
                "Save changes"
              ) : (
                <>
                  <Plus className="w-4 h-4" /> Add
                </>
              )}
            </GlassButton>
          </div>
        </div>
      </div>
    </GlassModal>
  );
}
