import { useMemo, useState } from "react";
import { saveHostFeatureFlags } from "../lib/registry.js";
import "./OnboardingPage.css";

export const ONBOARDING_COMPLETE_KEY = "konductor-onboarding-complete";
export const ONBOARDING_PREFERENCES_KEY = "konductor-onboarding-preferences";

type InstanceType = "home" | "extension";

const HARNESSES = [
  { id: "claude_code", title: "Claude Code" },
  { id: "codex", title: "OpenAI Codex CLI" },
  { id: "gemini_cli", title: "Gemini CLI" },
  { id: "pi", title: "Pi" },
  { id: "opencode", title: "OpenCode" },
] as const;

interface OnboardingPreferences {
  instance_type: InstanceType;
  remote_enabled: boolean;
  auth_required: boolean;
  agent_harnesses: string[];
  customer_endpoint_enabled: boolean;
  asset_manager_enabled: boolean;
  docs_manager_enabled: boolean;
}

type StepId =
  | "instance"
  | "remote"
  | "integrations"
  | "harnesses"
  | "customer-endpoint"
  | "assets"
  | "docs";

export function OnboardingPage({ onProceed }: { onProceed: () => void }) {
  const [instanceType, setInstanceType] = useState<InstanceType>("home");
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [harnesses, setHarnesses] = useState<Set<string>>(new Set(["claude_code"]));
  const [customerEndpointEnabled, setCustomerEndpointEnabled] = useState(false);
  const [assetManagerEnabled, setAssetManagerEnabled] = useState(false);
  const [docsManagerEnabled, setDocsManagerEnabled] = useState(false);

  const steps = useMemo<StepId[]>(() => [
    "instance",
    ...(instanceType === "home" ? (["remote"] as const) : []),
    "integrations",
    "harnesses",
    "customer-endpoint",
    "assets",
    "docs",
  ], [instanceType]);

  const [stepIndex, setStepIndex] = useState(0);
  const stepId = steps[Math.min(stepIndex, steps.length - 1)]!;
  const isLast = stepIndex === steps.length - 1;

  function toggleHarness(id: string) {
    setHarnesses((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function finish() {
    const preferences: OnboardingPreferences = {
      instance_type: instanceType,
      remote_enabled: instanceType === "home" ? remoteEnabled : false,
      auth_required: instanceType === "home" ? authRequired : false,
      agent_harnesses: [...harnesses],
      customer_endpoint_enabled: customerEndpointEnabled,
      asset_manager_enabled: assetManagerEnabled,
      docs_manager_enabled: docsManagerEnabled,
    };
    try {
      localStorage.setItem(ONBOARDING_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Private window or blocked storage: preferences just aren't remembered.
    }
    try {
      // Persisted so the dashboard can hide tabs for features the operator chose not to enable.
      await saveHostFeatureFlags({
        asset_manager_enabled: assetManagerEnabled,
        docs_manager_enabled: docsManagerEnabled,
        customer_endpoint_enabled: customerEndpointEnabled,
      });
    } catch {
      // The host may not be reachable yet; the choice still lives in localStorage above.
    }
    onProceed();
  }

  function next() {
    if (isLast) { void finish(); return; }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function back() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  return (
    <div className="onboarding">
      <div className="onboarding__card k-section">
        <div className="k-section__header">
          Welcome to Konductor
          <span className="onboarding__step-count">{stepIndex + 1} / {steps.length}</span>
        </div>
        <div className="k-section__body onboarding__body">
          {stepId === "instance" && (
            <fieldset className="onboarding__step">
              <legend className="k-label">Is this the home instance, or an extension of one?</legend>
              <div className="k-checks">
                <label className="k-check">
                  <input type="radio" name="instance-type" checked={instanceType === "home"} onChange={() => setInstanceType("home")} />
                  Home instance
                </label>
                <label className="k-check">
                  <input type="radio" name="instance-type" checked={instanceType === "extension"} onChange={() => setInstanceType("extension")} />
                  Extension instance — projects are stored in a Konductor instance elsewhere
                </label>
              </div>
            </fieldset>
          )}

          {stepId === "remote" && (
            <fieldset className="onboarding__step">
              <legend className="k-label">Remote connection & authentication</legend>
              <div className="k-checks">
                <label className="k-check">
                  <input type="checkbox" checked={remoteEnabled} onChange={(event) => setRemoteEnabled(event.target.checked)} />
                  Prepare remote access
                </label>
                <label className="k-check">
                  <input type="checkbox" checked={authRequired} onChange={(event) => setAuthRequired(event.target.checked)} />
                  Require authentication
                </label>
              </div>
            </fieldset>
          )}

          {stepId === "integrations" && (
            <fieldset className="onboarding__step">
              <legend className="k-label">Integrations</legend>
              <div className="k-checks">
                <label className="k-check k-check--disabled">
                  <input type="checkbox" disabled />
                  Jira <span className="onboarding__soon">Coming soon</span>
                </label>
                <label className="k-check k-check--disabled">
                  <input type="checkbox" disabled />
                  Trello <span className="onboarding__soon">Coming soon</span>
                </label>
                <label className="k-check k-check--disabled">
                  <input type="checkbox" disabled />
                  GitHub Issues <span className="onboarding__soon">Coming soon</span>
                </label>
              </div>
              <p className="onboarding__hint">Konductor's own features work without any of these.</p>
            </fieldset>
          )}

          {stepId === "harnesses" && (
            <fieldset className="onboarding__step">
              <legend className="k-label">Agent harnesses</legend>
              <div className="k-checks">
                {HARNESSES.map((harness) => (
                  <label className="k-check" key={harness.id}>
                    <input type="checkbox" checked={harnesses.has(harness.id)} onChange={() => toggleHarness(harness.id)} />
                    {harness.title}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {stepId === "customer-endpoint" && (
            <fieldset className="onboarding__step">
              <legend className="k-label">Customer endpoint</legend>
              <div className="k-checks">
                <label className="k-check">
                  <input type="checkbox" checked={customerEndpointEnabled} onChange={(event) => setCustomerEndpointEnabled(event.target.checked)} />
                  Enable customer review links
                </label>
              </div>
              <p className="onboarding__hint">Leave this off and the Reviews tab stays hidden. You can turn it on later in Configuration.</p>
            </fieldset>
          )}

          {stepId === "assets" && (
            <fieldset className="onboarding__step">
              <legend className="k-label">Asset manager</legend>
              <div className="k-checks">
                <label className="k-check">
                  <input type="checkbox" checked={assetManagerEnabled} onChange={(event) => setAssetManagerEnabled(event.target.checked)} />
                  Enable the asset manager
                </label>
              </div>
              <p className="onboarding__hint">Leave this off and the Assets tab stays hidden. You can turn it on later in Configuration.</p>
            </fieldset>
          )}

          {stepId === "docs" && (
            <fieldset className="onboarding__step">
              <legend className="k-label">Docs / wiki manager</legend>
              <div className="k-checks">
                <label className="k-check">
                  <input type="checkbox" checked={docsManagerEnabled} onChange={(event) => setDocsManagerEnabled(event.target.checked)} />
                  Enable the docs / wiki manager
                </label>
              </div>
              <p className="onboarding__hint">Leave this off and the Project Details tab stays hidden. You can turn it on later in Configuration.</p>
            </fieldset>
          )}

          <div className="k-actions onboarding__actions">
            <button className="k-btn k-btn--ghost" onClick={back} disabled={stepIndex === 0}>Back</button>
            <button className="k-btn k-btn--primary" onClick={next}>{isLast ? "Finish" : "Continue"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
  } catch {
    // Private window or blocked storage: onboarding just reappears next visit.
  }
}
