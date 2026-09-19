import "./OnboardingPage.css";

export const ONBOARDING_COMPLETE_KEY = "konductor-onboarding-complete";

export function OnboardingPage({ onProceed }: { onProceed: () => void }) {
  return (
    <div className="onboarding">
      <div className="onboarding__card k-section">
        <div className="k-section__header">Welcome to Konductor</div>
        <div className="k-section__body onboarding__body">
          <button className="k-btn k-btn--primary" autoFocus onClick={onProceed}>Proceed</button>
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
