import { useEffect, useRef, useState } from "react";
import {
  ChartLineUp,
  CheckCircle,
  Crown,
  GearSix,
  Keyboard,
  SignIn,
  SignOut,
  Trash,
  User
} from "@phosphor-icons/react";
import type { Profile } from "@foucusly/contracts";

interface HeaderProps {
  profile: Profile | null;
  onAccount: () => void;
  onPremium: () => void;
  onLogout: () => void;
  onShortcuts: () => void;
  onDeleteAccount: () => void;
  onReport: () => void;
  onSettings: () => void;
  onSignIn: () => void;
}

export function Header({
  profile,
  onAccount,
  onPremium,
  onLogout,
  onShortcuts,
  onDeleteAccount,
  onReport,
  onSettings,
  onSignIn
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const avatarLabel = profile?.username?.trim()
    ? profile.username.trim().charAt(0).toUpperCase()
    : "U";

  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Foucusly home">
        <span className="brand-mark">
          <CheckCircle size={21} weight="fill" />
        </span>
        <span>Foucusly</span>
      </a>

      <nav className="top-actions" aria-label="Main navigation">
        <button className="top-action desktop-action" onClick={onReport}>
          <ChartLineUp size={16} /> <span>Report</span>
        </button>

        <button className="top-action desktop-action" onClick={onSettings}>
          <GearSix size={16} /> <span>Setting</span>
        </button>

        {profile ? (
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button
              className="profile-avatar-button"
              aria-expanded={profileMenuOpen}
              aria-label={`Profile menu for ${profile.username}`}
              onClick={() => setProfileMenuOpen((prev) => !prev)}
            >
              <span className="profile-avatar-letter">{avatarLabel}</span>
            </button>

            {profileMenuOpen && (
              <div className="profile-menu-popover" role="menu">
                <button
                  role="menuitem"
                  className="profile-menu-item"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onAccount();
                  }}
                >
                  <User size={17} weight="fill" />
                  <span>Account</span>
                </button>

                <button
                  role="menuitem"
                  className="profile-menu-item"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onPremium();
                  }}
                >
                  <Crown size={17} weight="fill" />
                  <span>Premium</span>
                </button>

                <button
                  role="menuitem"
                  className="profile-menu-item"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onLogout();
                  }}
                >
                  <SignOut size={17} weight="bold" />
                  <span>Logout</span>
                </button>

                <button
                  role="menuitem"
                  className="profile-menu-item"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onShortcuts();
                  }}
                >
                  <Keyboard size={17} />
                  <span>Shortcuts</span>
                </button>

                <button
                  role="menuitem"
                  className="profile-menu-item delete-account-item"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onDeleteAccount();
                  }}
                >
                  <Trash size={17} />
                  <span>Delete Account</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="top-action sign-in" onClick={onSignIn}>
            <SignIn size={16} /> <span>Sign In</span>
          </button>
        )}

        <div className="mobile-menu-wrap" ref={mobileMenuRef}>
          <button
            className="icon-button mobile-menu-button"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span className="menu-lines" />
          </button>

          {menuOpen && (
            <div className="header-menu popover">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onReport();
                }}
              >
                <ChartLineUp size={16} /> Report
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onSettings();
                }}
              >
                <GearSix size={16} /> Setting
              </button>
              {profile ? (
                <>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onAccount();
                    }}
                  >
                    <User size={16} weight="fill" /> Account
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onPremium();
                    }}
                  >
                    <Crown size={16} weight="fill" /> Premium
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    <SignOut size={16} weight="bold" /> Logout
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onShortcuts();
                    }}
                  >
                    <Keyboard size={16} /> Shortcuts
                  </button>
                  <button
                    className="danger-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteAccount();
                    }}
                  >
                    <Trash size={16} /> Delete Account
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onSignIn();
                  }}
                >
                  <SignIn size={16} /> Sign In
                </button>
              )}
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
