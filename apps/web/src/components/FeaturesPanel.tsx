import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { filterFeatureCategories } from "../lib/featureFilters.js";
import { fetchHostHealth, formatApiError, type HostHealth } from "../lib/registry.js";
import { AgentStatusIndicator } from "./agents/AgentStatusIndicator.js";
import { PromptPackField } from "./agents/PromptPackField.js";
import { itemStatusColor, itemStatusGlyph } from "../styles/ui.js";
import type { Decision, FeaturePhase, KonductorConfig, RunSummary, StatusSnapshot } from "../lib/types.js";
import { FeatureDecisions, decisionsForFeature } from "./decisions/FeatureDecisions.js";
import "./Features.css";

interface LaunchPayload {
  feature_item_ids: string[];
  profile_id: string;
  prompt_packs: string[];
  prompt: string;
}

interface FeaturesPanelProps {
  projectId: string;
  snap: StatusSnapshot | null;
  config: KonductorConfig | null;
  runs: RunSummary[];
  decisions: Decision[];
  onDecisionsChanged: () => Promise<void>;
  onStartRun: (payload: LaunchPayload) => Promise<RunSummary>;
  onCreateFeature: (payload: {
    title: string;
    description?: string;
    category_id: string;
    phase_ids?: string[];
    status?: "todo" | "in_progress" | "blocked" | "done";
    create_todo?: boolean;
  }) => Promise<{ category_id: string; feature_item_id: string }>;
  onCreateCategory: (title: string) => Promise<{ category_id: string }>;
  onSavePhases: (phases: Array<{ id?: string; title: string }>) => Promise<void>;
  onReorderPhases: (phaseIds: string[]) => Promise<void>;
}

function AgentContextDialog({
  features,
  todos,
  runs,
  onClose,
}: {
  features: Array<{ id: string; title: string; category_title: string; status: string }>;
  todos: NonNullable<StatusSnapshot["todos"]>;
  runs: RunSummary[];
  onClose: () => void;
}) {
  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="k-dialog ft__agent-context-dialog" role="dialog" aria-modal="true" aria-label="Agent context">
        <div className="k-dialog__header">
          Agent context
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="k-dialog__body ft__agent-context-body">
          {features.length === 0 ? <p className="k-empty">Select a feature to inspect its agent context.</p> : <>
            <section>
              <h2 className="ft__context-heading">Selected features</h2>
              <ul className="ft__context-list">{features.map((feature) => <li key={feature.id}><strong>{feature.title}</strong><span>{feature.category_title} · {feature.status.replace("_", " ")}</span></li>)}</ul>
            </section>
            <section>
              <h2 className="ft__context-heading">Related to-dos</h2>
              {todos.length ? <ul className="ft__context-list">{todos.map((todo) => <li key={todo.id}><strong>{todo.title}</strong><span>{todo.status.replace("_", " ")}{todo.description ? ` · ${todo.description}` : ""}</span></li>)}</ul> : <p className="k-empty">No linked to-dos.</p>}
            </section>
            <section>
              <h2 className="ft__context-heading">Previous agents</h2>
              {runs.length ? <ul className="ft__context-list">{runs.map((run) => <li key={run.id}><strong>{run.profile_title} · {run.slug}</strong><span>{run.status} · {new Date(run.started_at).toLocaleString()}</span></li>)}</ul> : <p className="k-empty">No previous agents worked on these features.</p>}
            </section>
          </>}
        </div>
      </section>
    </div>
  );
}

function EditPhasesDialog({
  phases,
  saving,
  error,
  onClose,
  onSave,
}: {
  phases: FeaturePhase[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (phases: Array<{ id?: string; title: string }>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Array<{ id?: string; title: string }>>(() => phases.map((phase) => ({ ...phase })));
  const [validationError, setValidationError] = useState<string | null>(null);
  const updateTitle = (index: number, title: string) => setDraft((current) => current.map((phase, currentIndex) => currentIndex === index ? { ...phase, title } : phase));
  const remove = (index: number) => setDraft((current) => current.filter((_, currentIndex) => currentIndex !== index));
  const add = () => setDraft((current) => [...current, { title: "" }]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = draft.map((phase) => phase.title.trim());
    if (normalized.some((title) => !title)) {
      setValidationError("Every phase needs a name.");
      return;
    }
    if (new Set(normalized.map((title) => title.replace(/\s+/g, " ").toLocaleLowerCase())).size !== normalized.length) {
      setValidationError("Phase names must be unique.");
      return;
    }
    setValidationError(null);
    await onSave(draft.map((phase, index) => ({ ...(phase.id ? { id: phase.id } : {}), title: normalized[index]! })));
  };
  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className="k-dialog ft__phases-dialog" role="dialog" aria-modal="true" aria-label="Edit phases" onSubmit={(event) => { void submit(event); }}>
        <div className="k-dialog__header">
          Edit phases
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" aria-label="Close" disabled={saving} onClick={onClose}>×</button>
        </div>
        <div className="k-dialog__body ft__phases-dialog-body">
          <p className="k-note">Changes apply to every feature. Removing a phase also removes it from assigned features.</p>
          <div className="ft__phase-editor-list">
            {draft.map((phase, index) => (
              <div className="ft__phase-editor-row" key={phase.id ?? `new-${index}`}>
                <input
                  className="k-input"
                  aria-label={`Phase ${index + 1} name`}
                  value={phase.title}
                  onChange={(event) => updateTitle(index, event.target.value)}
                  autoFocus={draft.length === 1 && index === 0}
                />
                <button type="button" className="k-btn k-btn--danger k-btn--sm" disabled={saving} onClick={() => remove(index)}>Remove</button>
              </div>
            ))}
            {draft.length === 0 ? <p className="k-empty">No phases yet. Add one to organize feature work.</p> : null}
          </div>
          <button type="button" className="k-btn k-btn--sm" disabled={saving} onClick={add}>Add phase</button>
          {validationError || error ? <p className="k-error">{validationError ?? error}</p> : null}
          <div className="k-actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? "Saving…" : "Save phases"}</button>
            <button type="button" className="k-btn k-btn--ghost" disabled={saving} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function NameDialog({
  title,
  label,
  placeholder,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        className="k-dialog ft__name-dialog"
        style={{ width: "min(460px, 100%)" }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => { event.preventDefault(); void onSubmit(value); }}
      >
        <div className="k-dialog__header">
          {title}
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="k-dialog__body ft__dialog-body">
          <div className="k-field">
            <label className="k-label" htmlFor="ft-dialog-title">{label}</label>
            <input
              id="ft-dialog-title"
              className="k-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              autoFocus
            />
          </div>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={submitting || !value.trim()}>
              {submitting ? "Adding…" : "Add"}
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function FeaturesPanel({
  projectId,
  snap,
  config,
  runs,
  onStartRun,
  onCreateFeature,
  onCreateCategory,
  onSavePhases,
  onReorderPhases,
  decisions,
  onDecisionsChanged,
}: FeaturesPanelProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [featureSelectionEnabled, setFeatureSelectionEnabled] = useState(false);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [agentContextOpen, setAgentContextOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState(config?.agents?.default_profile ?? "default-profile");
  const [selectedPacks, setSelectedPacks] = useState<string[]>(
    (config?.agents?.prompt_packs ?? []).slice(0, 1).map((pack) => pack.id),
  );
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [featureTitle, setFeatureTitle] = useState("");
  const [featureDescription, setFeatureDescription] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [featurePhaseId, setFeaturePhaseId] = useState("");
  const [featureStatus, setFeatureStatus] = useState<"todo" | "in_progress" | "blocked" | "done">("todo");
  const [createTodo, setCreateTodo] = useState(true);
  const [selectedPhaseIds, setSelectedPhaseIds] = useState<string[]>([]);
  const [creatingFeature, setCreatingFeature] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  const [dialog, setDialog] = useState<"category" | null>(null);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [hostHealth, setHostHealth] = useState<HostHealth | null>(null);
  const [phaseEditorOpen, setPhaseEditorOpen] = useState(false);
  const [savingPhases, setSavingPhases] = useState(false);
  const [phaseEditorError, setPhaseEditorError] = useState<string | null>(null);
  const [draggedPhaseId, setDraggedPhaseId] = useState<string | null>(null);
  const [phaseDropIndex, setPhaseDropIndex] = useState<number | null>(null);
  const [phaseDragGhost, setPhaseDragGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const phasePointerDrag = useRef<{ id: string; pointerId: number; startX: number; startY: number; active: boolean } | null>(null);
  const phaseDropIndexRef = useRef<number | null>(null);
  const phaseDragCompletedAt = useRef(0);

  const categories = useMemo(() => snap?.features ?? [], [snap?.features]);
  const phases = useMemo(() => snap?.feature_phases ?? [], [snap?.feature_phases]);
  const visibleCategories = useMemo(
    () => filterFeatureCategories(categories, selectedPhaseIds),
    [categories, selectedPhaseIds],
  );
  const phaseTitles = useMemo(() => new Map(phases.map((phase) => [phase.id, phase.title])), [phases]);
  const selectedFeatures = useMemo(() => {
    const selection = new Set(featureSelectionEnabled ? selectedFeatureIds : (selectedItemId ? [selectedItemId] : []));
    return categories.flatMap((category) => category.items
      .filter((item) => selection.has(item.id))
      .map((item) => ({ ...item, category_title: category.title })));
  }, [categories, featureSelectionEnabled, selectedFeatureIds, selectedItemId]);
  const launchFeatureIds = selectedFeatures.map((feature) => feature.id);
  const relatedTodos = useMemo(() => {
    const selected = new Set(launchFeatureIds);
    return (snap?.todos ?? []).filter((todo) => [
      ...todo.related_feature_item_ids,
      ...(todo.feature_item_id ? [todo.feature_item_id] : []),
    ].some((id) => selected.has(id)));
  }, [launchFeatureIds.join(","), snap?.todos]);
  const previousRuns = useMemo(() => {
    const selected = new Set(launchFeatureIds);
    return runs.filter((run) => {
      const runFeatureIds = run.feature_item_ids.length > 0
        ? run.feature_item_ids
        : run.feature_item_id ? [run.feature_item_id] : [];
      return runFeatureIds.some((id) => selected.has(id));
    });
  }, [launchFeatureIds.join(","), runs]);

  useEffect(() => {
    if (categories.length === 0) setSelectedCategoryId("");
    else if (!categories.some((category) => category.id === selectedCategoryId)) setSelectedCategoryId(categories[0]!.id);
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    setSelectedPhaseIds((current) => current.filter((id) => phases.some((phase) => phase.id === id)));
    setFeaturePhaseId((current) => phases.some((phase) => phase.id === current) ? current : "");
  }, [phases]);

  useEffect(() => {
    if (selectedItemId && !visibleCategories.some((category) => category.items.some((item) => item.id === selectedItemId))) {
      setSelectedItemId(null);
    }
  }, [selectedItemId, visibleCategories]);

  useEffect(() => {
    setSelectedProfileId(config?.agents?.default_profile ?? "default-profile");
    setSelectedPacks((config?.agents?.prompt_packs ?? []).slice(0, 1).map((pack) => pack.id));
  }, [config]);

  useEffect(() => {
    fetchHostHealth().then(setHostHealth).catch((event) => setError(formatApiError(event)));
  }, []);

  async function handleSubmit() {
    if (launchFeatureIds.length === 0 || !prompt.trim()) {
      setError("Select one or more features and enter a prompt.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setLaunchMessage(null);
    try {
      const run = await onStartRun({
        feature_item_ids: launchFeatureIds,
        profile_id: selectedProfileId,
        prompt_packs: selectedPacks,
        prompt,
      });
      setPrompt("");
      setLaunchMessage(`Started ${run.slug}`);
    } catch (event) {
      setError(formatApiError(event));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateFeature() {
    if (!featureTitle.trim()) { setCreateError("Title required."); return; }
    if (!selectedCategoryId) { setCreateError("Create or choose a feature category."); return; }
    setCreatingFeature(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const payload: { title: string; description?: string; category_id: string; phase_ids?: string[]; status?: "todo" | "in_progress" | "blocked" | "done"; create_todo: boolean } = {
        title: featureTitle.trim(),
        category_id: selectedCategoryId,
        phase_ids: featurePhaseId ? [featurePhaseId] : [],
        status: featureStatus,
        create_todo: createTodo,
      };
      const description = featureDescription.trim();
      if (description) payload.description = description;
      const created = await onCreateFeature(payload);
      setSelectedItemId(created.feature_item_id);
      setCreateMessage(`Added "${featureTitle.trim()}"`);
      setFeatureTitle("");
      setFeatureDescription("");
      setFeaturePhaseId("");
      setFeatureStatus("todo");
      setCreateTodo(true);
      setFeatureDialogOpen(false);
      setPrompt((current) => current || `Implement feature: ${featureTitle.trim()}`);
    } catch (event) {
      setCreateError(formatApiError(event));
    } finally {
      setCreatingFeature(false);
    }
  }

  async function handleDialogSubmit(value: string) {
    const title = value.trim();
    if (!title || !dialog) return;
    setDialogSubmitting(true);
    setDialogError(null);
    try {
      if (dialog === "category") {
        const created = await onCreateCategory(title);
        setSelectedCategoryId(created.category_id);
      }
      setDialog(null);
    } catch (event) {
      setDialogError(formatApiError(event));
    } finally {
      setDialogSubmitting(false);
    }
  }

  function togglePhase(id: string) {
    setSelectedPhaseIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleFeatureSelection(id: string) {
    setSelectedFeatureIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleFeatureSelectionMode() {
    setFeatureSelectionEnabled((current) => {
      if (current) {
        setSelectedFeatureIds([]);
        setSelectedItemId(null);
      }
      return !current;
    });
  }

  async function handleSavePhases(nextPhases: Array<{ id?: string; title: string }>) {
    setSavingPhases(true);
    setPhaseEditorError(null);
    try {
      await onSavePhases(nextPhases);
      setPhaseEditorOpen(false);
    } catch (event) {
      setPhaseEditorError(formatApiError(event));
    } finally {
      setSavingPhases(false);
    }
  }

  async function handlePhaseDrop(draggedPhaseId: string, insertIndex: number) {
    const nextPhases = [...phases];
    const fromIndex = nextPhases.findIndex((phase) => phase.id === draggedPhaseId);
    if (fromIndex < 0) return;
    const [draggedPhase] = nextPhases.splice(fromIndex, 1);
    const targetIndex = fromIndex < insertIndex ? insertIndex - 1 : insertIndex;
    if (targetIndex === fromIndex) return;
    nextPhases.splice(targetIndex, 0, draggedPhase!);
    setError(null);
    try {
      await onReorderPhases(nextPhases.map((phase) => phase.id));
    } catch (event) {
      setError(formatApiError(event));
    }
  }

  useEffect(() => {
    function updatePhaseDropTarget(event: PointerEvent) {
      const drag = phasePointerDrag.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
        drag.active = true;
        setDraggedPhaseId(drag.id);
        setPhaseDragGhost({ title: phases.find((phase) => phase.id === drag.id)?.title ?? "Phase", x: event.clientX, y: event.clientY });
      }
      event.preventDefault();
      setPhaseDragGhost((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-phase-drop-index]");
      const index = target?.dataset.phaseDropIndex;
      const nextIndex = index === undefined ? null : Number(index);
      phaseDropIndexRef.current = Number.isInteger(nextIndex) ? nextIndex : null;
      setPhaseDropIndex(phaseDropIndexRef.current);
    }
    function finishPhaseDrag(event: PointerEvent) {
      const drag = phasePointerDrag.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      phasePointerDrag.current = null;
      if (drag.active && phaseDropIndexRef.current !== null) {
        event.preventDefault();
        phaseDragCompletedAt.current = Date.now();
        void handlePhaseDrop(drag.id, phaseDropIndexRef.current);
      }
      phaseDropIndexRef.current = null;
      setDraggedPhaseId(null);
      setPhaseDropIndex(null);
      setPhaseDragGhost(null);
    }
    window.addEventListener("pointermove", updatePhaseDropTarget, { passive: false });
    window.addEventListener("pointerup", finishPhaseDrag);
    window.addEventListener("pointercancel", finishPhaseDrag);
    return () => {
      window.removeEventListener("pointermove", updatePhaseDropTarget);
      window.removeEventListener("pointerup", finishPhaseDrag);
      window.removeEventListener("pointercancel", finishPhaseDrag);
    };
  });

  const profiles = config?.agents?.profiles ?? [];
  const packs = config?.agents?.prompt_packs ?? [];
  const phaseDropZone = (index: number) => (
    <span key={`drop-${index}`} className={`ft__phase-dropzone${phaseDropIndex === index ? " ft__phase-dropzone--active" : ""}`} data-phase-drop-index={index} aria-hidden="true" />
  );
  return (
    <div className="k-page">
      <div className={`ft__phasebar${draggedPhaseId ? " ft__phasebar--reordering" : ""}`} aria-label="Choose feature phases to show">
        <button
          type="button"
          className={`ft__phase-tab${selectedPhaseIds.length === 0 ? " ft__phase-tab--active" : ""}`}
          aria-pressed={selectedPhaseIds.length === 0}
          onClick={() => setSelectedPhaseIds([])}
        >
          All
        </button>
        {phaseDropZone(0)}
        {phases.map((phase, index) => (
          <React.Fragment key={phase.id}>
            <button
              type="button"
              className={`ft__phase-tab ft__phase-tab--draggable${selectedPhaseIds.includes(phase.id) ? " ft__phase-tab--active" : ""}${draggedPhaseId === phase.id ? " ft__phase-tab--dragging" : ""}`}
              aria-pressed={selectedPhaseIds.includes(phase.id)}
              aria-label={`${phase.title}. Drag to reorder.`}
              onClick={() => { if (Date.now() - phaseDragCompletedAt.current >= 250) togglePhase(phase.id); }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                phasePointerDrag.current = { id: phase.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            >
              {phase.title}
            </button>
            {phaseDropZone(index + 1)}
          </React.Fragment>
        ))}
        <button type="button" className="ft__phase-add" onClick={() => { setPhaseEditorError(null); setPhaseEditorOpen(true); }}>Edit phases</button>
        <button type="button" className={`ft__phase-add${featureSelectionEnabled ? " ft__phase-add--active" : ""}`} aria-pressed={featureSelectionEnabled} onClick={toggleFeatureSelectionMode}>Select features</button>
        <span className="k-spacer" />
        <AgentStatusIndicator activeAgents={hostHealth?.running_runs.length ?? 0} hostHealth={hostHealth} hasError={Boolean(error || createError)} />
      </div>
      {phaseEditorOpen ? (
        <EditPhasesDialog
          phases={phases}
          saving={savingPhases}
          error={phaseEditorError}
          onClose={() => setPhaseEditorOpen(false)}
          onSave={handleSavePhases}
        />
      ) : null}
      {agentContextOpen ? <AgentContextDialog features={selectedFeatures} todos={relatedTodos} runs={previousRuns} onClose={() => setAgentContextOpen(false)} /> : null}
      {phaseDragGhost ? <div className="ft__phase-drag-ghost" style={{ left: phaseDragGhost.x, top: phaseDragGhost.y }} aria-hidden="true">{phaseDragGhost.title}</div> : null}

      <div className="ft__layout">
        <div className="ft__grid">
          {categories.length === 0 ? (
            <p className="k-empty ft__empty">No feature categories yet. Add one to create your first feature.</p>
          ) : visibleCategories.length === 0 ? (
            <p className="k-empty ft__empty">No features in the selected phases.</p>
          ) : visibleCategories.map((category) => {
            const sourceCategory = categories.find((candidate) => candidate.id === category.id) ?? category;
            const done = sourceCategory.items.filter((item) => item.status === "done").length;
            const total = sourceCategory.items.length;
            const pct = total > 0 ? done / total : 0;
            return (
              <section key={category.id} className="k-section ft__card">
                <div className="ft__card-head">
                  <div className="ft__card-meta">
                    <Link className="ft__card-title" to={`/project/${projectId}/features/${category.id}`} title="Open feature category">{category.title}</Link>
                    <span className="k-faint">Feature category · {done}/{total} done</span>
                  </div>
                  <Link to={`/project/${projectId}/features/${category.id}`} className="k-btn k-btn--ghost k-btn--sm">Open ›</Link>
                </div>
                <div className="k-progress" style={{ borderRadius: 0, height: 4 }}>
                  <div className="k-progress__fill" style={{ width: `${pct * 100}%` }} />
                </div>
                <div className="ft__items">
                  {category.items.map((item) => (
                    <div
                      key={item.id}
                      className={`ft__item${selectedItemId === item.id ? " ft__item--active" : ""}`}
                    >
                      {featureSelectionEnabled ? <button type="button" className={`ft__item-select-toggle${selectedFeatureIds.includes(item.id) ? " ft__item-select-toggle--selected" : ""}`} aria-label={`${selectedFeatureIds.includes(item.id) ? "Unselect" : "Select"} ${item.title}`} aria-pressed={selectedFeatureIds.includes(item.id)} onClick={() => toggleFeatureSelection(item.id)} /> : null}
                      <button type="button" className="ft__item-main" onClick={() => setSelectedItemId(item.id)}>
                        <span className="k-glyph" style={{ color: itemStatusColor(item.status) }}>{itemStatusGlyph(item.status)}</span>
                        <span className="ft__item-title">{item.title}</span>
                        {item.phase_ids?.[0] && phaseTitles.has(item.phase_ids[0]) ? <span className="ft__item-phase">{phaseTitles.get(item.phase_ids[0])}</span> : null}
                        {(() => {
                          const linked = decisionsForFeature(decisions, item.id);
                          if (linked.length === 0) return null;
                          const open = linked.some((decision) => decision.status === "open");
                          return <span className={`dc__count${open ? " dc__count--open" : ""}`} title={`${linked.length} decision${linked.length === 1 ? "" : "s"}`}>◆ {linked.length}</span>;
                        })()}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="ft__launcher">
          <section className="k-section">
            <div className="k-section__header">Start agent<span className="k-spacer" /><button type="button" className="ft__agent-context-trigger" aria-label="Show agent context" title="Show linked to-dos and previous agents" onClick={() => setAgentContextOpen(true)}>i</button></div>
            <div className="k-section__body ft__form">
              {launchFeatureIds.length === 0 ? (
                <p className="k-empty" style={{ padding: 0 }}>Select a feature on the left</p>
              ) : (
                <>
                  <div className="ft__selected">
                    <span className="k-glyph" style={{ color: itemStatusColor(selectedFeatures[0]!.status) }}>{itemStatusGlyph(selectedFeatures[0]!.status)}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{selectedFeatures.length === 1 ? selectedFeatures[0]!.title : `${selectedFeatures.length} selected features`}</strong>
                      <div className="k-faint" style={{ fontSize: 13 }}>{selectedFeatures.length === 1 ? `${selectedFeatures[0]!.category_title} · ${selectedFeatures[0]!.status.replace("_", " ")}` : "All selected features will be included in this agent brief."}</div>
                      {selectedFeatures.length === 1 && selectedFeatures[0]!.description ? <div className="k-note" style={{ marginTop: 4 }}>{selectedFeatures[0]!.description}</div> : null}
                    </div>
                  </div>
                  {selectedFeatures.length === 1 ? <FeatureDecisions
                    projectId={projectId}
                    featureItemId={selectedFeatures[0]!.id}
                    decisions={decisions}
                    snap={snap}
                    config={config}
                    onChanged={onDecisionsChanged}
                  /> : null}
                  <div className="k-field">
                    <label className="k-label" htmlFor="ft-profile">Profile</label>
                    <select id="ft-profile" className="k-select" value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
                      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title}</option>)}
                    </select>
                  </div>
                  <PromptPackField packs={packs} selected={selectedPacks} onChange={setSelectedPacks} />
                  <div className="k-field">
                    <label className="k-label" htmlFor="ft-prompt">Task</label>
                    <textarea id="ft-prompt" className="k-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should the agent do with this feature?" />
                  </div>
                  {error ? <p className="k-error">{error}</p> : null}
                  <button type="button" className="k-btn k-btn--primary k-btn--block" disabled={submitting} onClick={handleSubmit}>
                    {submitting ? "Starting…" : "Start agent"}
                  </button>
                  {launchMessage ? <span className="k-note">{launchMessage}</span> : null}
                </>
              )}
            </div>
          </section>

          <section className="k-section">
            <div className="k-section__header">Features</div>
            <div className="k-section__body ft__form">
              <button type="button" className="k-btn k-btn--block" disabled={categories.length === 0} onClick={() => { setCreateError(null); setFeatureDialogOpen(true); }}>
                New feature
              </button>
              <button type="button" className="k-btn k-btn--ghost k-btn--block" onClick={() => { setDialogError(null); setDialog("category"); }}>
                New feature category
              </button>
              {createMessage ? <span className="k-note">{createMessage}</span> : null}
            </div>
          </section>
        </aside>
      </div>

      {featureDialogOpen ? (
        <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFeatureDialogOpen(false); }}>
          <form
            className="k-dialog ft__name-dialog"
            style={{ width: "min(520px, 100%)" }}
            role="dialog"
            aria-modal="true"
            aria-label="New feature"
            onSubmit={(event) => { event.preventDefault(); void handleCreateFeature(); }}
          >
            <div className="k-dialog__header">
              New feature
              <span className="k-spacer" />
              <button type="button" className="k-dialog__close" aria-label="Close" onClick={() => setFeatureDialogOpen(false)}>×</button>
            </div>
            <div className="k-dialog__body ft__dialog-body">
              <div className="k-field">
                <label className="k-label" htmlFor="ft-cat">Feature category</label>
                <select id="ft-cat" className="k-select" value={selectedCategoryId} disabled={categories.length === 0} onChange={(event) => setSelectedCategoryId(event.target.value)}>
                  {categories.length === 0 ? <option value="">No feature categories</option> : null}
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
                </select>
              </div>
              <div className="k-field">
                <label className="k-label" htmlFor="ft-title">Title</label>
                <input id="ft-title" className="k-input" value={featureTitle} onChange={(event) => setFeatureTitle(event.target.value)} autoFocus />
              </div>
              <div className="k-field">
                <label className="k-label" htmlFor="ft-desc">Description</label>
                <textarea id="ft-desc" className="k-textarea" style={{ minHeight: 80 }} value={featureDescription} onChange={(event) => setFeatureDescription(event.target.value)} placeholder="Optional scope or acceptance criteria" />
              </div>
              <div className="k-field">
                <label className="k-label" htmlFor="ft-phase">Phase</label>
                <select id="ft-phase" className="k-select" value={featurePhaseId} disabled={phases.length === 0} onChange={(event) => setFeaturePhaseId(event.target.value)}>
                  <option value="">{phases.length === 0 ? "No feature phases" : "No phase"}</option>
                  {phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.title}</option>)}
                </select>
              </div>
              <div className="k-field">
                <label className="k-label" htmlFor="ft-status">Status</label>
                <select id="ft-status" className="k-select" value={featureStatus} onChange={(event) => setFeatureStatus(event.target.value as typeof featureStatus)}>
                  <option value="todo">To-do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
                </select>
              </div>
              <label className="ft__todo-toggle"><input type="checkbox" checked={createTodo} onChange={(event) => setCreateTodo(event.target.checked)} /> Create a linked to-do</label>
              {createError ? <p className="k-error">{createError}</p> : null}
              <div className="k-actions">
                <button type="submit" className="k-btn k-btn--primary" disabled={creatingFeature || !featureTitle.trim() || !selectedCategoryId}>
                  {creatingFeature ? "Adding…" : "Add feature"}
                </button>
                <button type="button" className="k-btn k-btn--ghost" onClick={() => setFeatureDialogOpen(false)}>Cancel</button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {dialog ? (
        <NameDialog
          key={dialog}
          title="New feature category"
          label="Category name"
          placeholder="API, Dashboard, Billing…"
          submitting={dialogSubmitting}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={handleDialogSubmit}
        />
      ) : null}
    </div>
  );
}
