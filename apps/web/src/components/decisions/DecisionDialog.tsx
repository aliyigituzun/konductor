import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  createProjectDecision,
  formatApiError,
  resolveProjectDecision,
  updateProjectDecision,
  type DecisionPayload,
} from "../../lib/registry.js";
import type {
  Decision,
  DecisionFeatureDraft,
  DecisionImpact,
  DecisionKind,
  KonductorConfig,
  StatusSnapshot,
} from "../../lib/types.js";
import { PromptPackField } from "../agents/PromptPackField.js";
import { itemStatusColor, itemStatusGlyph } from "../../styles/ui.js";
import "./Decisions.css";

interface DecisionDialogProps {
  projectId: string;
  /** `null` opens the dialog in create mode. */
  decision: Decision | null;
  snap: StatusSnapshot | null;
  config: KonductorConfig | null;
  onClose: () => void;
  /** Called after any successful mutation so the page can reload project data. */
  onChanged: () => Promise<void>;
}

type OptionDraft = {
  id?: string;
  title: string;
  description: string;
  creates_features: DecisionFeatureDraft[];
};

type FeatureRow = { id: string; title: string; status: string; category_id: string; category_title: string };

const IMPACTS: DecisionImpact[] = ["low", "medium", "high"];

export function impactColor(impact: DecisionImpact): string {
  if (impact === "high") return "var(--danger)";
  if (impact === "medium") return "var(--warning)";
  return "var(--text-tertiary)";
}

function flattenFeatures(snap: StatusSnapshot | null): FeatureRow[] {
  return (snap?.features ?? []).flatMap((category) =>
    category.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      category_id: category.id,
      category_title: category.title,
    })),
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Editable list of features an option (or a resolution) will create. */
function FeatureDraftRows({
  drafts,
  snap,
  disabled,
  onChange,
}: {
  drafts: DecisionFeatureDraft[];
  snap: StatusSnapshot | null;
  disabled: boolean;
  onChange: (next: DecisionFeatureDraft[]) => void;
}) {
  const categories = snap?.features ?? [];
  const phases = snap?.feature_phases ?? [];
  const update = (index: number, patch: Partial<DecisionFeatureDraft>) =>
    onChange(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  return (
    <div className="dc__drafts">
      {drafts.map((draft, index) => (
        <div className="dc__draft" key={index}>
          <input
            className="k-input"
            aria-label={`Feature ${index + 1} title`}
            placeholder="Feature title"
            value={draft.title}
            disabled={disabled}
            onChange={(event) => update(index, { title: event.target.value })}
          />
          <select
            className="k-select"
            aria-label={`Feature ${index + 1} category`}
            value={draft.category_id}
            disabled={disabled}
            onChange={(event) => update(index, { category_id: event.target.value })}
          >
            {categories.length === 0 ? <option value="">No categories</option> : null}
            {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select>
          <select
            className="k-select"
            aria-label={`Feature ${index + 1} phase`}
            value={draft.phase_ids[0] ?? ""}
            disabled={disabled || phases.length === 0}
            onChange={(event) => update(index, { phase_ids: event.target.value ? [event.target.value] : [] })}
          >
            <option value="">{phases.length === 0 ? "No phases" : "No phase"}</option>
            {phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.title}</option>)}
          </select>
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--sm"
            aria-label={`Remove feature ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(drafts.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="k-btn k-btn--sm"
        disabled={disabled || categories.length === 0}
        onClick={() => onChange([...drafts, { title: "", category_id: categories[0]?.id ?? "", phase_ids: [] }])}
      >
        Add feature
      </button>
    </div>
  );
}

/** Checkbox list of every feature, grouped by category, with a filter for large projects. */
function FeatureLinkPicker({
  features,
  selected,
  disabled,
  onChange,
}: {
  features: FeatureRow[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const visible = query
    ? features.filter((feature) => feature.title.toLowerCase().includes(query) || feature.category_title.toLowerCase().includes(query))
    : features;
  const grouped = new Map<string, FeatureRow[]>();
  for (const feature of visible) {
    const list = grouped.get(feature.category_title) ?? [];
    list.push(feature);
    grouped.set(feature.category_title, list);
  }
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  if (features.length === 0) return <p className="k-empty" style={{ padding: 0 }}>No features yet.</p>;
  return (
    <div className="dc__links">
      <input
        className="k-input"
        placeholder="Filter features"
        aria-label="Filter features"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="dc__links-list">
        {[...grouped.entries()].map(([category, items]) => (
          <div key={category} className="dc__links-group">
            <div className="dc__links-group-title">{category}</div>
            {items.map((feature) => (
              <label key={feature.id} className="k-check dc__link">
                <input type="checkbox" checked={selected.includes(feature.id)} disabled={disabled} onChange={() => toggle(feature.id)} />
                <span className="k-glyph" style={{ color: itemStatusColor(feature.status) }}>{itemStatusGlyph(feature.status)}</span>
                <span className="k-truncate">{feature.title}</span>
              </label>
            ))}
          </div>
        ))}
        {visible.length === 0 ? <p className="k-empty" style={{ padding: "8px 0" }}>No matches.</p> : null}
      </div>
    </div>
  );
}

function LinkedFeatureList({ ids, features, projectId }: { ids: string[]; features: FeatureRow[]; projectId: string }) {
  if (ids.length === 0) return <span className="k-faint">None</span>;
  return (
    <ul className="dc__feature-list">
      {ids.map((id) => {
        const feature = features.find((candidate) => candidate.id === id);
        if (!feature) return <li key={id} className="k-faint">{id} (missing)</li>;
        return (
          <li key={id}>
            <span className="k-glyph" style={{ color: itemStatusColor(feature.status) }}>{itemStatusGlyph(feature.status)}</span>
            <Link to={`/project/${projectId}/features/${feature.category_id}`}>{feature.title}</Link>
            <span className="k-faint"> · {feature.category_title}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DecisionDialog({ projectId, decision, snap, config, onClose, onChanged }: DecisionDialogProps) {
  const features = useMemo(() => flattenFeatures(snap), [snap]);
  const profiles = config?.agents?.profiles ?? [];
  const packs = config?.agents?.prompt_packs ?? [];
  const mode: "create" | "open" | "resolved" = !decision ? "create" : decision.status === "resolved" ? "resolved" : "open";

  // Shared editable fields (create mode, and the editable parts of an open decision).
  const [title, setTitle] = useState(decision?.title ?? "");
  const [question, setQuestion] = useState(decision?.question ?? "");
  const [context, setContext] = useState(decision?.context ?? "");
  const [kind, setKind] = useState<DecisionKind>(decision?.kind ?? "options");
  const [problem, setProblem] = useState(decision?.problem ?? "");
  const openEnded = kind === "open_ended";
  const [impact, setImpact] = useState<DecisionImpact>(decision?.impact ?? "medium");
  const [owner, setOwner] = useState(decision?.owner ?? "");
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    decision
      ? decision.options.map((option) => ({ id: option.id, title: option.title, description: option.description ?? "", creates_features: option.creates_features }))
      : [{ title: "", description: "", creates_features: [] }, { title: "", description: "", creates_features: [] }],
  );
  const [linked, setLinked] = useState<string[]>(decision?.feature_item_ids ?? []);
  const [editingLinks, setEditingLinks] = useState(false);
  const [editingOptions, setEditingOptions] = useState(false);

  // Resolution.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [rationale, setRationale] = useState("");
  const [drafts, setDrafts] = useState<DecisionFeatureDraft[]>([]);
  const [handoff, setHandoff] = useState(false);
  const [profileId, setProfileId] = useState(config?.agents?.default_profile ?? profiles[0]?.id ?? "");
  const [selectedPacks, setSelectedPacks] = useState<string[]>([]);
  const [handoffFeature, setHandoffFeature] = useState<string>("");
  const [instructions, setInstructions] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  // Choosing an option pre-fills the features it says it creates; the operator can edit them.
  function chooseOption(id: string) {
    setChosenId(id);
    const option = decision?.options.find((candidate) => candidate.id === id);
    setDrafts((option?.creates_features ?? []).map((draft) => ({ ...draft })));
  }

  useEffect(() => {
    if (handoffFeature) return;
    if (linked[0]) setHandoffFeature(linked[0]);
  }, [linked, handoffFeature]);

  function optionsPayload(): NonNullable<DecisionPayload["options"]> {
    return options
      .filter((option) => option.title.trim())
      .map((option) => ({
        ...(option.id ? { id: option.id } : {}),
        title: option.title.trim(),
        ...(option.description.trim() ? { description: option.description.trim() } : {}),
        creates_features: option.creates_features.filter((draft) => draft.title.trim() && draft.category_id),
      }));
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) { setError("A title is required."); return; }
    const payloadOptions = openEnded ? [] : optionsPayload();
    if (openEnded && !problem.trim()) { setError("Describe the problem to think through."); return; }
    if (!openEnded && payloadOptions.length < 2) { setError("Give the decision at least two options."); return; }
    setBusy(true);
    setError(null);
    try {
      await createProjectDecision(projectId, {
        title: title.trim(),
        question: question.trim() || title.trim(),
        context: context.trim(),
        kind,
        ...(openEnded ? { problem: problem.trim() } : {}),
        impact,
        owner: owner.trim() || null,
        options: payloadOptions,
        feature_item_ids: linked,
      });
      await onChanged();
      onClose();
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdits(patch: DecisionPayload) {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      await updateProjectDecision(projectId, decision.id, patch);
      await onChanged();
      setNotice("Saved.");
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitResolve(event: React.FormEvent) {
    event.preventDefault();
    if (!decision) return;
    if (openEnded ? !answer.trim() : !chosenId) { setError(openEnded ? "Write an answer first." : "Choose an option first."); return; }
    if (handoff && !instructions.trim()) { setError(openEnded ? "Tell the agent what to do with the answer." : "Tell the agent what to do with the chosen option."); return; }
    const badDraft = drafts.find((draft) => !draft.title.trim() || !draft.category_id);
    if (badDraft) { setError("Every feature to create needs a title and a category."); return; }
    setBusy(true);
    setError(null);
    try {
      if (JSON.stringify(linked) !== JSON.stringify(decision.feature_item_ids)) {
        await updateProjectDecision(projectId, decision.id, { feature_item_ids: linked });
      }
      const result = await resolveProjectDecision(projectId, decision.id, {
        ...(openEnded ? { answer: answer.trim() } : { option_id: chosenId! }),
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
        create_features: drafts.map((draft) => ({ ...draft, title: draft.title.trim() })),
        ...(handoff
          ? {
              handoff: {
                ...(profileId ? { profile_id: profileId } : {}),
                prompt: instructions.trim(),
                prompt_packs: selectedPacks,
                feature_item_id: handoffFeature || null,
              },
            }
          : {}),
      });
      await onChanged();
      if (result.handoff_error) {
        setNotice(null);
        setError(`Decision resolved, but the agent did not start: ${result.handoff_error}`);
        return;
      }
      onClose();
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "create" ? "New decision" : decision!.title;
  const chosenOption = decision?.outcome
    ? decision.options.find((option) => option.id === decision.outcome?.option_id) ?? null
    : null;

  const optionsEditor = (
    <div className="dc__options-editor">
      {options.map((option, index) => (
        <div className="dc__option-edit" key={option.id ?? `new-${index}`}>
          <div className="dc__option-edit-row">
            <input
              className="k-input"
              aria-label={`Option ${index + 1} title`}
              placeholder={`Option ${index + 1}`}
              value={option.title}
              disabled={busy}
              onChange={(event) => setOptions((current) => current.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))}
            />
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm"
              aria-label={`Remove option ${index + 1}`}
              disabled={busy || options.length <= 2}
              onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
          <textarea
            className="k-textarea"
            style={{ minHeight: 56 }}
            aria-label={`Option ${index + 1} description`}
            placeholder="What this option means and what it costs"
            value={option.description}
            disabled={busy}
            onChange={(event) => setOptions((current) => current.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)))}
          />
          <div className="k-field">
            <span className="k-label">Creates features when chosen</span>
            <FeatureDraftRows
              drafts={option.creates_features}
              snap={snap}
              disabled={busy}
              onChange={(next) => setOptions((current) => current.map((item, i) => (i === index ? { ...item, creates_features: next } : item)))}
            />
          </div>
        </div>
      ))}
      <button type="button" className="k-btn k-btn--sm" disabled={busy} onClick={() => setOptions((current) => [...current, { title: "", description: "", creates_features: [] }])}>
        Add option
      </button>
    </div>
  );

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form
        className="k-dialog dc__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onSubmit={(event) => { if (mode === "create") void submitCreate(event); else if (mode === "open") void submitResolve(event); else event.preventDefault(); }}
      >
        <div className="k-dialog__header">
          {decision ? <span className="k-pill dc__impact" style={{ color: impactColor(decision.impact) }}>{decision.impact}</span> : null}
          <span className="k-truncate">{heading}</span>
          {decision ? <span className={`k-tag${decision.status === "open" ? " k-tag--accent" : ""}`}>{decision.status}</span> : null}
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
        </div>

        <div className="k-dialog__body dc__body">
          {mode === "create" ? (
            <>
              <div className="k-field-grid">
                <div className="k-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="k-label" htmlFor="dc-title">Title</label>
                  <input id="dc-title" className="k-input" value={title} disabled={busy} autoFocus onChange={(event) => setTitle(event.target.value)} />
                </div>
                <div className="k-field">
                  <label className="k-label" htmlFor="dc-impact">Impact</label>
                  <select id="dc-impact" className="k-select" value={impact} disabled={busy} onChange={(event) => setImpact(event.target.value as DecisionImpact)}>
                    {IMPACTS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div className="k-field">
                  <label className="k-label" htmlFor="dc-owner">Owner</label>
                  <input id="dc-owner" className="k-input" value={owner} disabled={busy} placeholder="Optional" onChange={(event) => setOwner(event.target.value)} />
                </div>
              </div>
              <div className="k-field">
                <label className="k-label" htmlFor="dc-question">Question</label>
                <input id="dc-question" className="k-input" value={question} disabled={busy} placeholder="What needs deciding?" onChange={(event) => setQuestion(event.target.value)} />
              </div>
              <div className="k-field">
                <label className="k-label" htmlFor="dc-context">Context</label>
                <textarea id="dc-context" className="k-textarea" style={{ minHeight: 72 }} value={context} disabled={busy} placeholder="Background the decider needs" onChange={(event) => setContext(event.target.value)} />
              </div>
              <div className="k-field">
                <div className="dc__field-head">
                  <span className="k-label">{openEnded ? "Problem" : "Options"}</span>
                  <div className="k-seg" role="group" aria-label="Decision kind">
                    <button type="button" className={`k-seg__btn${!openEnded ? " k-seg__btn--active" : ""}`} aria-pressed={!openEnded} disabled={busy} onClick={() => setKind("options")}>Options</button>
                    <button type="button" className={`k-seg__btn${openEnded ? " k-seg__btn--active" : ""}`} aria-pressed={openEnded} disabled={busy} onClick={() => setKind("open_ended")}>Open-ended</button>
                  </div>
                </div>
                {openEnded ? (
                  <>
                    <textarea
                      id="dc-problem"
                      className="k-textarea"
                      style={{ minHeight: 120 }}
                      aria-label="Problem description"
                      value={problem}
                      disabled={busy}
                      placeholder="Describe the problem. The decider answers in their own words instead of picking an option."
                      onChange={(event) => setProblem(event.target.value)}
                    />
                    <span className="k-note">Resolved with a written answer; no options to choose from.</span>
                  </>
                ) : optionsEditor}
              </div>
              <div className="k-field">
                <span className="k-label">Linked features</span>
                <FeatureLinkPicker features={features} selected={linked} disabled={busy} onChange={setLinked} />
              </div>
            </>
          ) : null}

          {mode !== "create" && decision ? (
            <>
              <div className="dc__question">
                <p className="dc__question-text">{decision.question}</p>
                {decision.context ? <p className="k-note dc__context">{decision.context}</p> : null}
                {decision.problem ? <p className="dc__problem">{decision.problem}</p> : null}
                <div className="k-faint dc__meta">
                  {decision.owner ? <span>Owner {decision.owner}</span> : null}
                  <span>Raised {formatDate(decision.created_at)} · {decision.source}{decision.run_id ? ` · run ${decision.run_id.slice(0, 8)}` : ""}</span>
                </div>
              </div>

              {mode === "resolved" && decision.outcome ? (
                <section className="dc__outcome" aria-label="Outcome">
                  <div className="dc__outcome-head">
                    <span className="k-glyph" style={{ color: "var(--success)" }}>✓</span>
                    <strong>{openEnded ? "Answered" : chosenOption?.title ?? decision.outcome.option_id}</strong>
                  </div>
                  {decision.outcome.answer ? <p className="dc__rationale">{decision.outcome.answer}</p> : null}
                  {chosenOption?.description ? <p className="k-note">{chosenOption.description}</p> : null}
                  {chosenOption?.consequences ? <p className="k-note">Consequences: {chosenOption.consequences}</p> : null}
                  {decision.outcome.rationale ? <p className="dc__rationale">{decision.outcome.rationale}</p> : null}
                  <dl className="k-kv">
                    <dt>Resolved</dt>
                    <dd>{formatDate(decision.outcome.resolved_at)} by {decision.outcome.resolved_by}</dd>
                    {openEnded ? null : (
                      <>
                        <dt>Rejected</dt>
                        <dd>{decision.options.filter((option) => option.id !== decision.outcome?.option_id).map((option) => option.title).join(", ") || "—"}</dd>
                      </>
                    )}
                    <dt>Agent run</dt>
                    <dd>
                      {decision.outcome.handoff_run_id
                        ? <Link to={`/project/${projectId}?tab=agents`} className="k-mono">{decision.outcome.handoff_run_id.slice(0, 8)}</Link>
                        : <span className="k-faint">None</span>}
                    </dd>
                    <dt>Created features</dt>
                    <dd><LinkedFeatureList ids={decision.outcome.created_feature_item_ids} features={features} projectId={projectId} /></dd>
                    <dt>Linked features</dt>
                    <dd><LinkedFeatureList ids={decision.feature_item_ids} features={features} projectId={projectId} /></dd>
                  </dl>
                </section>
              ) : null}

              {mode === "open" && openEnded ? (
                <div className="k-field">
                  <label className="k-label" htmlFor="dc-answer">Answer</label>
                  <textarea id="dc-answer" className="k-textarea" style={{ minHeight: 120 }} value={answer} disabled={busy} autoFocus placeholder="How this should be resolved" onChange={(event) => setAnswer(event.target.value)} />
                </div>
              ) : null}

              {mode === "open" ? (
                <>
                  {openEnded ? null : (
                  <div className="k-field">
                    <div className="dc__field-head">
                      <span className="k-label">Options</span>
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={busy} onClick={() => setEditingOptions((value) => !value)}>
                        {editingOptions ? "Done" : decision.options.length === 0 ? "Add options" : "Edit"}
                      </button>
                    </div>
                    {editingOptions ? (
                      <>
                        {optionsEditor}
                        <div className="k-actions">
                          <button type="button" className="k-btn k-btn--sm" disabled={busy} onClick={() => void saveEdits({ options: optionsPayload() }).then(() => { setEditingOptions(false); setChosenId(null); setDrafts([]); })}>
                            Save options
                          </button>
                        </div>
                      </>
                    ) : decision.options.length === 0 ? (
                      <p className="k-empty" style={{ padding: 0 }}>No options recorded yet. Add at least one to resolve this decision.</p>
                    ) : (
                      <div className="dc__options" role="radiogroup" aria-label="Options">
                        {decision.options.map((option) => (
                          <label key={option.id} className={`dc__option${chosenId === option.id ? " dc__option--chosen" : ""}`}>
                            <input type="radio" name="dc-option" value={option.id} checked={chosenId === option.id} disabled={busy} onChange={() => chooseOption(option.id)} />
                            <span className="dc__option-body">
                              <span className="dc__option-title">{option.title}</span>
                              {option.description ? <span className="k-note">{option.description}</span> : null}
                              {option.consequences ? <span className="k-note">Consequences: {option.consequences}</span> : null}
                              {option.creates_features.length > 0 ? (
                                <span className="k-faint">Creates {option.creates_features.length} feature{option.creates_features.length === 1 ? "" : "s"}</span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  )}

                  <div className="k-field">
                    <div className="dc__field-head">
                      <span className="k-label">Linked features <span className="k-faint">{linked.length}</span></span>
                      <button
                        type="button"
                        className="k-btn k-btn--ghost k-btn--sm"
                        disabled={busy}
                        onClick={() => {
                          if (!editingLinks) { setEditingLinks(true); return; }
                          void saveEdits({ feature_item_ids: linked }).then(() => setEditingLinks(false));
                        }}
                      >
                        {editingLinks ? "Save" : "Edit"}
                      </button>
                    </div>
                    {editingLinks
                      ? <FeatureLinkPicker features={features} selected={linked} disabled={busy} onChange={setLinked} />
                      : <LinkedFeatureList ids={linked} features={features} projectId={projectId} />}
                  </div>

                  {chosenId || (openEnded && answer.trim()) ? (
                    <>
                      <div className="k-field">
                        <span className="k-label">Create features on resolve</span>
                        <FeatureDraftRows drafts={drafts} snap={snap} disabled={busy} onChange={setDrafts} />
                      </div>
                      <div className="k-field">
                        <label className="k-label" htmlFor="dc-rationale">Rationale</label>
                        <textarea id="dc-rationale" className="k-textarea" style={{ minHeight: 64 }} value={rationale} disabled={busy} placeholder={openEnded ? "Why this answer" : "Why this option"} onChange={(event) => setRationale(event.target.value)} />
                      </div>
                      <label className="k-check">
                        <input type="checkbox" checked={handoff} disabled={busy || profiles.length === 0} onChange={(event) => setHandoff(event.target.checked)} />
                        Hand off to an agent{profiles.length === 0 ? <span className="k-faint"> (no agent profiles configured)</span> : null}
                      </label>
                      {handoff ? (
                        <div className="dc__handoff">
                          <div className="k-field-grid">
                            <div className="k-field">
                              <label className="k-label" htmlFor="dc-profile">Profile</label>
                              <select id="dc-profile" className="k-select" value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}>
                                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title}</option>)}
                              </select>
                            </div>
                            <div className="k-field">
                              <label className="k-label" htmlFor="dc-feature">Feature</label>
                              <select id="dc-feature" className="k-select" value={handoffFeature} disabled={busy} onChange={(event) => setHandoffFeature(event.target.value)}>
                                <option value="">No feature (direct task)</option>
                                {linked.map((id) => {
                                  const feature = features.find((candidate) => candidate.id === id);
                                  return feature ? <option key={id} value={id}>{feature.title}</option> : null;
                                })}
                                {drafts.map((draft, index) => draft.title.trim() ? <option key={`draft-${index}`} value={`draft:${index}`}>New: {draft.title.trim()}</option> : null)}
                              </select>
                            </div>
                          </div>
                          <PromptPackField packs={packs} selected={selectedPacks} onChange={setSelectedPacks} />
                          <div className="k-field">
                            <label className="k-label" htmlFor="dc-instructions">Instructions</label>
                            <textarea id="dc-instructions" className="k-textarea" value={instructions} disabled={busy} placeholder={openEnded ? "What should the agent do with the answer?" : "What should the agent do with the chosen option?"} onChange={(event) => setInstructions(event.target.value)} />
                            <span className="k-note">The agent also receives the question, {openEnded ? "the problem, your answer" : "the chosen option"}, and your rationale.</span>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {error ? <p className="k-error">{error}</p> : null}
          {notice ? <p className="k-note">{notice}</p> : null}

          <div className="k-actions dc__actions">
            {mode === "create" ? (
              <button type="submit" className="k-btn k-btn--primary" disabled={busy}>{busy ? "Saving…" : "Record decision"}</button>
            ) : mode === "open" ? (
              <button type="submit" className="k-btn k-btn--primary" disabled={busy || (openEnded ? !answer.trim() : !chosenId) || editingOptions}>
                {busy ? "Resolving…" : handoff ? "Resolve & start agent" : "Resolve"}
              </button>
            ) : null}
            <button type="button" className="k-btn k-btn--ghost" disabled={busy} onClick={onClose}>{mode === "resolved" ? "Close" : "Cancel"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
