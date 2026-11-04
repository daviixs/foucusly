import { UserCircle } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

interface Props {
  onSubmit: (mode: "login" | "register", username: string, password: string) => Promise<void>;
}

export function AuthGate({ onSubmit }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const registering = mode === "register";
  const valid = username.trim().length >= 2 && password.length >= (registering ? 8 : 1);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(mode, username.trim(), password);
      setPassword("");
    } catch (caught) {
      setError((caught as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <section
        className="section-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        aria-describedby="auth-description"
      >
        <header className="section-dialog-header">
          <span className="section-dialog-icon">
            <UserCircle size={28} weight="duotone" />
          </span>
          <span className="dialog-eyebrow">ACCOUNT</span>
          <h2 id="auth-title">{registering ? "Create account" : "Sign in"}</h2>
          <p id="auth-description">
            {registering
              ? "Choose a username and a password (at least 8 characters)."
              : "Sign in with your username and password. Existing accounts without a password: the password you enter now becomes your password."}
          </p>
        </header>
        <div className="profile-content">
          <form className="profile-form" onSubmit={submit}>
            <div className="profile-field">
              <label htmlFor="auth-username">Username</label>
              <input
                id="auth-username"
                className="profile-input"
                autoFocus
                autoComplete="username"
                maxLength={30}
                minLength={2}
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="profile-field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                className="profile-input"
                type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                minLength={registering ? 8 : 1}
                maxLength={200}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </div>
            {error && (
              <small className="profile-error" role="alert">
                {error}
              </small>
            )}
            <footer className="dialog-footer">
              <button
                type="button"
                className="button-muted"
                disabled={busy}
                onClick={() => {
                  setMode(registering ? "login" : "register");
                  setError("");
                }}
              >
                {registering ? "I have an account" : "Create account"}
              </button>
              <button className="button-dark" type="submit" disabled={busy || !valid}>
                {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
