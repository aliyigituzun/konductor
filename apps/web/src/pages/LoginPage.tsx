import React, { useState } from "react";
import { useAuth } from "../AuthContext.js";
import { formatApiError, login } from "../lib/registry.js";
import "./LoginPage.css";

export function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      await refresh();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card k-section" onSubmit={(event) => { void submit(event); }}>
        <div className="k-section__header">Sign in</div>
        <div className="k-section__body login__body">
          <div className="k-field">
            <label className="k-label" htmlFor="login-email">Email</label>
            <input id="login-email" className="k-input" type="email" autoComplete="username" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="login-password">Password</label>
            <input id="login-password" className="k-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-actions">
            <button className="k-btn k-btn--primary" disabled={busy || !email.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
