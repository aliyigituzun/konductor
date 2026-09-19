import React, { useState } from "react";
import type { FeatureCategory, FeatureItem, FeatureItemStatus } from "../lib/types.js";

export interface EditFeatureDialogProps {
  item: FeatureItem;
  categoryId: string;
  categories: FeatureCategory[];
  onClose: () => void;
  onSave: (payload: { title: string; description?: string; status: FeatureItemStatus; category_id: string }) => Promise<void>;
}

export function EditFeatureDialog({ item, categoryId, categories, onClose, onSave }: EditFeatureDialogProps) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [status, setStatus] = useState<FeatureItemStatus>(item.status);
  const [selectedCategoryId, setSelectedCategoryId] = useState(categoryId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Title required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        status,
        category_id: selectedCategoryId,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form
        className="k-dialog ft__name-dialog"
        style={{ width: "min(520px, 100%)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Edit feature"
        onSubmit={(event) => { void submit(event); }}
      >
        <div className="k-dialog__header">
          Edit feature
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" aria-label="Close" disabled={saving} onClick={onClose}>×</button>
        </div>
        <div className="k-dialog__body ft__dialog-body">
          <div className="k-field">
            <label className="k-label" htmlFor="ef-title">Title</label>
            <input id="ef-title" className="k-input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="ef-desc">Description</label>
            <textarea id="ef-desc" className="k-textarea" style={{ minHeight: 80 }} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional scope or acceptance criteria" />
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="ef-category">Feature category</label>
            <select id="ef-category" className="k-select" value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
            </select>
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="ef-status">Status</label>
            <select id="ef-status" className="k-select" value={status} onChange={(event) => setStatus(event.target.value as FeatureItemStatus)}>
              <option value="todo">To-do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
            </select>
          </div>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || !title.trim()}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="k-btn k-btn--ghost" disabled={saving} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}
