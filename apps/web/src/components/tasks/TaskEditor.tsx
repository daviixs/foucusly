import { useState, type FormEvent } from "react";
import { Minus, NotePencil, Plus, X } from "@phosphor-icons/react";
import type { Project, Task } from "@foucusly/contracts";
import { ProjectPicker } from "../ProjectPicker";
import type { OpenProjectManager, TaskDraft } from "./types";

export function TaskEditor({ initial, edit, projects, onSave, onCancel, onManageProjects }: {
  initial?: Task;
  edit?: boolean;
  projects: Project[];
  onSave: (draft: TaskDraft) => Promise<void>;
  onCancel: () => void;
  onManageProjects: OpenProjectManager;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [estimate, setEstimate] = useState(initial?.estimatePomos ?? 1);
  const [projectId, setProjectId] = useState(initial?.projectId ?? null);
  const [noteOpen, setNoteOpen] = useState(Boolean(initial?.note));
  const [busy, setBusy] = useState(false);
  const draft = { title: title.trim(), note, estimatePomos: estimate, projectId };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title || busy) return;
    setBusy(true);
    try { await onSave(draft); if (!edit) { setTitle(""); setNote(""); setEstimate(1); setProjectId(null); setNoteOpen(false); onCancel(); } }
    finally { setBusy(false); }
  };
  return <form className="task-editor" onSubmit={submit}>
    <input className="task-title-input" autoFocus={!edit} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What are you working on?" aria-label="What are you working on?" />
    <div className="estimate-row"><span>Est Pomodoros</span><div className="stepper">
      <button type="button" aria-label="Decrease estimate" onClick={() => setEstimate(Math.max(1, estimate - 1))}><Minus size={15} /></button>
      <input aria-label="Estimated Pomodoros" type="number" min={1} max={24} value={estimate} onChange={(event) => setEstimate(Math.min(24, Math.max(1, Number(event.target.value) || 1)))} />
      <button type="button" aria-label="Increase estimate" onClick={() => setEstimate(Math.min(24, estimate + 1))}><Plus size={15} /></button>
    </div></div>
    {noteOpen && <textarea className="task-note-input" value={note} maxLength={3000} onChange={(event) => setNote(event.target.value)} placeholder="Add a note..." aria-label="Task note" rows={3} />}
    <div className="editor-options">
      <button type="button" className="text-option" onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? <X size={15} /> : <NotePencil size={15} />} {noteOpen ? "Remove note" : "+ Add Note"}</button>
    </div>
    <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} onManage={() => onManageProjects((project) => setProjectId(project.id))} />
    <div className="editor-bottom">
      <div className="editor-secondary" />
      <div className="editor-actions">
        <button type="button" className="button-muted" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button-dark" disabled={!title.trim() || busy}>Save</button>
      </div>
    </div>
  </form>;
}
