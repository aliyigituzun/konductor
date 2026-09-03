import React, { useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppContext } from "./AppContext.js";
import { Header } from "./components/Header.js";
import { Portfolio } from "./pages/Portfolio.js";
import { FeatureCategoryPage } from "./pages/FeatureCategoryPage.js";
import { ProjectDetail } from "./pages/ProjectDetail.js";
import "./styles/tokens.css";

export function App() {
  const [projectName, setProjectName] = useState<string | null>(null);

  return (
    <AppContext.Provider value={{ projectName, setProjectName }}>
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/project/:id/features/:categoryId" element={<FeatureCategoryPage />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
