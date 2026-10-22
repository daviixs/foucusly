import { useEffect, useState, type FormEvent } from "react";
import { Archive, Check, NotePencil, Plus, X } from "@phosphor-icons/react";
import type { Project } from "@foucusly/contracts";

interface Props {
  projects: Project[];
  onCreate: (name: string) => Promise<Project>;
  onRename: (id: string, name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onCreated?: (project: Project) => void;
  onClose: () => void;
}

export function ProjectManagerDialog({ projects, onCreate, onRename, onArchive, onCreated, onClose }: Props) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true); setError("");
    try { const project = await onCreate(name); setNewName(""); onCreated?.(project); }
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
    try { await onArchive(project.id); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="dialog-backdrop project-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="project-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
      <header className="dialog-header"><div><span className="dialog-eyebrow">ORGANIZE YOUR FOCUS</span><h2 id="project-manager-title">Projects</h2></div><button className="dialog-close" aria-label="Close projects" onClick={onClose}><X size={20} /></button></header>
      <div className="project-manager-content">
        <form className="project-create-form" onSubmit={(event) => void create(event)}>
          <input aria-label="New project name" maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Project name" />
          <button className="button-dark" disabled={!newName.trim() || busy}><Plus size={15} /> Add</button>
        </form>
        {error && <p className="project-error" role="alert">{error}</p>}
        {projects.length ? <ul className="project-manager-list">{projects.map((project) => <li key={project.id}>
          {editingId === project.id ? <form className="project-rename-form" onSubmit={(event) => { event.preventDefault(); void saveRename(project.id); }}>
            <input aria-label={`Rename ${project.name}`} maxLength={80} autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} />
            <button aria-label="Save project name" disabled={!editName.trim() || busy}><Check size={16} /></button>
            <button type="button" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X size={16} /></button>
          </form> : <><span>{project.name}</span><div>
            <button aria-label={`Rename ${project.name}`} title="Rename" onClick={() => { setEditingId(project.id); setEditName(project.name); }}><NotePencil size={16} /></button>
            <button aria-label={`Archive ${project.name}`} title="Archive" onClick={() => void archive(project)}><Archive size={16} /></button>
          </div></>}
        </li>)}</ul> : <p className="project-empty">No projects yet. Create one to group your focus time.</p>}
      </div>
    </section>
  </div>;
}
