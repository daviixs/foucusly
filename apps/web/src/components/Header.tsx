import { useState } from "react";
import { ChartLineUp, CheckCircle, GearSix, LockKey, SignIn } from "@phosphor-icons/react";

interface HeaderProps {
  onReport: () => void;
  onSettings: () => void;
  onSignIn: () => void;
}

export function Header({ onReport, onSettings, onSignIn }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Pomofocus home">
        <span className="brand-mark"><CheckCircle size={21} weight="fill" /></span>
        <span>Pomofocus</span>
      </a>
      <nav className="top-actions" aria-label="Main navigation">
        <button className="top-action desktop-action" onClick={onReport}><ChartLineUp size={16} /> <span>Report</span></button>
        <button className="top-action desktop-action" onClick={onSettings}><GearSix size={16} /> <span>Setting</span></button>
        <button className="top-action sign-in" onClick={onSignIn}><SignIn size={16} /> <span>Sign In</span></button>
        <div className="mobile-menu-wrap">
          <button className="icon-button mobile-menu-button" aria-label="Open navigation menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <span className="menu-lines" />
          </button>
          {menuOpen && <div className="header-menu popover">
            <button onClick={() => { setMenuOpen(false); onReport(); }}><ChartLineUp size={16} /> Report</button>
            <button onClick={() => { setMenuOpen(false); onSettings(); }}><GearSix size={16} /> Setting</button>
            <button onClick={() => { setMenuOpen(false); onSignIn(); }}><LockKey size={16} /> Sign In</button>
          </div>}
        </div>
      </nav>
    </header>
  );
}
