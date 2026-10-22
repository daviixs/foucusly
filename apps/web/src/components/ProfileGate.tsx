import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle, Plus, UserCircle, X } from "@phosphor-icons/react";
import type { Profile } from "@foucusly/contracts";

interface Props {
  profiles: Profile[];
  activeProfileId?: string | null;
  onSelect: (profile: Profile) => void;
  onCreate: (username: string) => Promise<void>;
  onClose?: () => void;
  initialCreating?: boolean;
}

export function ProfileGate({
  profiles,
  activeProfileId,
  onSelect,
  onCreate,
  onClose,
  initialCreating = false
}: Props) {
  const [creating, setCreating] = useState(initialCreating || profiles.length === 0);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCreating(initialCreating || profiles.length === 0);
  }, [initialCreating, profiles.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (trimmed.length < 2 || busy) return;

    setBusy(true);
    setError("");
    try {
      await onCreate(trimmed);
      setUsername("");
    } catch (caught) {
      setError((caught as Error).message || "Could not create account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (onClose && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="section-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        aria-describedby="profile-description"
      >
        <header className="section-dialog-header">
          {onClose && (
            <button
              className="dialog-close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          )}
          <span className="section-dialog-icon">
            <UserCircle size={28} weight="duotone" />
          </span>
          <span className="dialog-eyebrow">ACCOUNT</span>
          <h2 id="profile-title">
            {creating ? "Create account" : "Who is focusing?"}
          </h2>
          <p id="profile-description">
            {creating
              ? "Choose a username to save your focus space and progress on this device."
              : "Select an existing profile or create a new one to continue."}
          </p>
        </header>

        <div className="profile-content">
          {creating ? (
            <form className="profile-form" onSubmit={submit}>
              <div className="profile-field">
                <label htmlFor="profile-username">Username</label>
                <input
                  id="profile-username"
                  autoFocus
                  maxLength={30}
                  minLength={2}
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="e.g. alex"
                  className="profile-input"
                  disabled={busy}
                />
              </div>

              {error && (
                <small className="profile-error" role="alert">
                  {error}
                </small>
              )}

              <footer className="dialog-footer">
                {profiles.length > 0 ? (
                  <button
                    type="button"
                    className="button-muted"
                    onClick={() => {
                      setCreating(false);
                      setError("");
                    }}
                    disabled={busy}
                  >
                    Back to profiles
                  </button>
                ) : onClose ? (
                  <button
                    type="button"
                    className="button-muted"
                    onClick={onClose}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                ) : null}

                <button
                  className="button-dark"
                  type="submit"
                  disabled={busy || username.trim().length < 2}
                >
                  {busy ? "Creating…" : "Create account"}
                </button>
              </footer>
            </form>
          ) : (
            <div className="profile-selection">
              <div className="profile-options">
                {profiles.map((item) => {
                  const isActive = item.id === activeProfileId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`profile-option ${isActive ? "is-active" : ""}`}
                      onClick={() => onSelect(item)}
                    >
                      <span className="profile-option-avatar">
                        <UserCircle size={22} weight="duotone" />
                      </span>
                      <span className="profile-option-name">{item.username}</span>
                      {isActive ? (
                        <CheckCircle
                          size={18}
                          weight="fill"
                          className="profile-check-active"
                        />
                      ) : (
                        <span className="profile-select-hint">Select</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <footer className="dialog-footer">
                {onClose && (
                  <button
                    type="button"
                    className="button-muted"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  className="button-dark profile-create-trigger"
                  onClick={() => {
                    setCreating(true);
                    setError("");
                  }}
                >
                  <Plus size={15} weight="bold" />
                  <span>Create another profile</span>
                </button>
              </footer>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
