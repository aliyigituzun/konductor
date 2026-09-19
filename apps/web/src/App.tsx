import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AppContext } from "./AppContext.js";
import { AuthProvider, useAuth } from "./AuthContext.js";
import { LoginPage } from "./pages/LoginPage.js";
import { Header } from "./components/Header.js";
import { Portfolio } from "./pages/Portfolio.js";
import { FeatureCategoryPage } from "./pages/FeatureCategoryPage.js";
import { ProjectDetail } from "./pages/ProjectDetail.js";
import { CustomerReview } from "./pages/CustomerReview.js";
import { RootPage } from "./pages/RootPage.js";
import { OnboardingPage, isOnboardingComplete, markOnboardingComplete } from "./pages/OnboardingPage.js";
import "./styles/tokens.css";
import "./styles/ui.css";

export function App() {
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectProfileName, setProjectProfileName] = useState("Personal");
  const [projectProfileId, setProjectProfileId] = useState("personal");

  useEffect(() => {
    const theme = localStorage.getItem("konductor-theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else document.documentElement.removeAttribute("data-theme");
  }, []);

  return (
    <AppContext.Provider value={{ projectName, setProjectName, projectProfileName, setProjectProfileName, projectProfileId, setProjectProfileId }}>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </AppContext.Provider>
  );
}

/** Customer review links and `/root` stay outside the dashboard session entirely;
 * everything else waits for onboarding, then for a session when one is required. */
function Shell() {
  const { status } = useAuth();
  const location = useLocation();
  const [onboarded, setOnboarded] = useState(isOnboardingComplete());
  const isReview = location.pathname.startsWith("/review/");
  const isRoot = location.pathname.startsWith("/root");

  if (isRoot) return <RootPage />;
  if (!isReview) {
    if (!onboarded) return <OnboardingPage onProceed={() => { markOnboardingComplete(); setOnboarded(true); }} />;
    if (!status) return null;
    if (status.required && !status.principal) return <LoginPage />;
  }
  return (
    <div className="k-shell">
      <Header />
      <main className="k-main">
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/project/:id/features/:categoryId" element={<FeatureCategoryPage />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/review/:token" element={<CustomerReview />} />
        </Routes>
      </main>
    </div>
  );
}
