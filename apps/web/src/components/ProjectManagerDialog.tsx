import { useEffect, useState, type FormEvent } from "react";
import { Archive, ArrowCounterClockwise, Check, NotePencil, Plus, X } from "@phosphor-icons/react";
import type { Project } from "@foucusly/contracts";
import { api } from "../api";

interface Props {
  projects: Project[];
  onCreate: (name: string, color?: string | null) => Promise<Project>;
  onRename: (id: string, name: string) => Promise<void>;
  onUpdateColor: (id: string, color: string | null) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onCreated?: (project: Project) => void;
  onClose: () => void;
}

const projectColors = ["#e5989b", "#f2c14e", "#b6cfb6", "#9ad0ec", "#b8b5ff", "#c9a7eb", "#e5b19f", "#94a7b7"];

function ColorSwatches({ value, onSelect, allowNone = true }: { value: string | null; onSelect: (color: string | null) => void; allowNone?: boolean }) {
  return <div className="color-swatches" role="radiogroup" aria-label="Project color">
    {projectColors.map((color) => <button key={color} type="button" role="radio" aria-checked={value === color} aria-label={`Set project color ${color}`} className={`color-swatch ${value === color ? "swatch-active" : ""}`} style={{ background: color }} onClick={() => onSelect(color)} />)}
    {allowNone && value && <button type="button" aria-label="Remove project color" className="color-swatch swatch-none" onClick={() => onSelect(null)}><X size={11} /></button>}
  </div>;
}

export function ProjectManagerDialog({ projects, onCreate, onRename, onUpdateColor, onArchive, onRestore, onCreated, onClose }: Props) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(projectColors[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archived, setArchived] = useState<Project[]>([]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const loadArchived = () => {
    setArchivedOpen((open) => !open);
    void api.archivedProjects().then((rows) => setArchived(rows)).catch(() => setArchived([]));
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true); setError("");
    try { const project = await onCreate(name, newColor); setNewName(""); setNewColor(project.color); onCreated?.(project); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const saveRename = async (id: string) => {
    if (!editName.trim() || busy) return;
    setBusy(true); setError("");
    try { await onRename(id, editName.trim()); setEditingId(null); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const archive = async (project: Project) => {
    if (busy || !window.confirm(`Archive “${project.name}”? Existing focus history will be kept.`)) return;
    setBusy(true); setError("");
    try { await onArchive(project.id); if (archivedOpen) setArchived(await api.archivedProjects()); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const restore = async (project: Project) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await onRestore(project.id);
      setArchived((rows) => rows.filter((item) => item.id !== project.id));
      setArchived([]);
      if (archivedOpen) setArchived(await api.archivedProjects());
    }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const pickColor = async (project: Project, color: string | null) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await onUpdateColor(project.id, color); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="dialog-backdrop project-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="project-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
      <header className="dialog-header"><div><span className="dialog-eyebrow">ORGANIZE YOUR FOCUS</span><h2 id="project-manager-title">Projects</h2></div><button className="dialog-close" aria-label="Close projects" onClick={onClose}><X size={20} /></button></header>
      <div className="project-manager-content">
        <form className="project-create-form" onSubmit={(event) => void create(event)}>
          <input aria-label="New project name" maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Project name" />
          <ColorSwatches value={newColor} onSelect={setNewColor} />
          <button className="button-dark" disabled={!newName.trim() || busy}><Plus size={15} /> Add</button>
        </form>
        {error && <p className="project-error" role="alert">{error}</p>}
        {projects.length ? <ul className="project-manager-list">{projects.map((project) => <li key={project.id}>
          {editingId === project.id ? <form className="project-rename-form" onSubmit={(event) => { event.preventDefault(); void saveRename(project.id); }}>
            <input aria-label={`Rename ${project.name}`} maxLength={80} autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} />
            <ColorSwatches value={project.color} onSelect={(color) => { void pickColor(project, color); }} />
            <button aria-label="Save project name" disabled={!editName.trim() || busy}><Check size={16} /></button>
            <button type="button" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X size={16} /></button>
          </form> : <><span><i className="project-dot" style={{ background: project.color ?? "#9aa3ad" }} />{project.name}</span><div>
            <button aria-label={`Set color for ${project.name}`} title="Set color" onClick={() => { setEditingId(project.id); setEditName(project.name); }}><NotePencil size={16} /></button>
            <button aria-label={`Archive ${project.name}`} title="Archive" onClick={() => void archive(project)}><Archive size={16} /></button>
          </div></>}
        </li>)}</ul> : <p className="project-empty">No projects yet. Create one to group your focus time.</p>}
        <button className="archived-toggle" aria-expanded={archivedOpen} onClick={loadArchived}><Archive size={14} /> {archivedOpen ? "Hide archived projects" : "Archived projects"}</button>
        {archivedOpen && <ul className="project-manager-list archived-list">
          {archived.length ? archived.map((project) => <li key={project.id} className="archived-project-row">
            <span><i className="project-dot" style={{ background: project.color ?? "#9aa3ad" }} />{project.name}<small>archived {new Date(project.archivedAt ?? "").toLocaleDateString()}</small></span>
            <div><button aria-label={`Restore ${project.name}`} title="Restore" onClick={() => void restore(project)}><ArrowCounterClockwise size={16} /> Restore</button></div>
          </li>) : <p className="project-empty">No archived projects.</p>}
        </ul>}
      </div>
    </section>
  </div>;
}
