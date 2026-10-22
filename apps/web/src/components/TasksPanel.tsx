import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, DotsThreeVertical, Folder, LockKey, Minus, NotePencil, Plus, PlusCircle, Trash, X } from "@phosphor-icons/react";
import type { Project, Task, TaskTemplate } from "@foucusly/contracts";
import { ProjectPicker } from "./ProjectPicker";
import { ProjectManagerDialog } from "./ProjectManagerDialog";

type TaskDraft = Pick<Task, "title" | "note" | "estimatePomos" | "projectId">;
interface TasksPanelProps {
  tasks: Task[];
  projects: Project[];
  templates: TaskTemplate[];
  activeTaskId: string | null;
  visible: boolean;
  hourFormat: "12-hour" | "24-hour";
  onCreate: (draft: TaskDraft) => Promise<void>;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUseTemplate: (id: string) => Promise<void>;
  onCreateTemplate: (draft: TaskDraft, name: string) => Promise<void>;
  onAction: (action: "clear-finished" | "clear-all" | "clear-pomos" | "toggle-hidden") => Promise<void>;
  onSelect: (id: string) => void;
  onToast: (message: string) => void;
  onCreateProject: (name: string) => Promise<Project>;
  onRenameProject: (id: string, name: string) => Promise<void>;
  onArchiveProject: (id: string) => Promise<void>;
}

function TaskEditor({ initial, edit, canTemplate, projects, onSave, onCancel, onTemplate, onManageProjects }: {
  initial?: Task;
  edit?: boolean;
  canTemplate: boolean;
  projects: Project[];
  onSave: (draft: TaskDraft) => Promise<void>;
  onCancel: () => void;
  onTemplate: (draft: TaskDraft, name: string) => Promise<void>;
  onManageProjects: (onCreated?: (project: Project) => void) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [estimate, setEstimate] = useState(initial?.estimatePomos ?? 1);
  const [projectId, setProjectId] = useState(initial?.projectId ?? null);
  const [noteOpen, setNoteOpen] = useState(Boolean(initial?.note));
  const [templateName, setTemplateName] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
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
    {templateOpen && <input className="template-name-input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" aria-label="Template name" />}
    <div className="editor-options">
      <button type="button" className="text-option" onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? <X size={15} /> : <NotePencil size={15} />} {noteOpen ? "Remove note" : "+ Add Note"}</button>
    </div>
    <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} onManage={() => onManageProjects((project) => setProjectId(project.id))} />
    <div className="editor-bottom">
      <div className="editor-secondary">
        {canTemplate && !edit && <button type="button" className="text-option" onClick={() => setTemplateOpen(!templateOpen)}>Save as template</button>}
      </div>
      <div className="editor-actions">
        <button type="button" className="button-muted" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button-dark" disabled={!title.trim() || busy}>Save</button>
      </div>
    </div>
    {templateOpen && <div className="template-save-row"><span>Save this task preset</span><button type="button" className="button-dark" disabled={!templateName.trim()} onClick={() => { void onTemplate(draft, templateName.trim()).then(() => { setTemplateOpen(false); setTemplateName(""); }); }}>Save template</button></div>}
  </form>;
}

function TaskRow({ task, active, projects, onSelect, onUpdate, onDelete, onManageProjects }: {
  task: Task; active: boolean; projects: Project[]; onSelect: () => void; onUpdate: (patch: Partial<Task>) => void; onDelete: () => void;
  onManageProjects: (onCreated?: (project: Project) => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  if (editing) return <TaskEditor edit initial={task} canTemplate={false} projects={projects} onSave={async (draft) => { await onUpdate(draft); setEditing(false); }} onCancel={() => setEditing(false)} onTemplate={async () => {}} onManageProjects={onManageProjects} />;
  return <article className={`task-row ${active ? "task-active" : ""} ${task.completed ? "task-completed" : ""}`} onClick={onSelect}>
    <button className={`task-check ${task.completed ? "checked" : ""}`} aria-label={task.completed ? "Mark task incomplete" : "Mark task complete"} onClick={(event) => { event.stopPropagation(); onUpdate({ completed: !task.completed }); }}>
      {task.completed && <Check size={13} weight="bold" />}
    </button>
    <div className="task-copy"><button className="task-name" onClick={onSelect}>{task.title}</button>
      {task.projectId && <span className="task-project-label">{projects.find((project) => project.id === task.projectId)?.name ?? "Archived project"}</span>}
      {task.note && <p className="task-note-preview">{task.note}</p>}
      <span className="task-progress">{task.completedPomos} / {task.estimatePomos}</span>
    </div>
    <div className="task-row-actions">
      <button className="pomo-count" aria-label={`Completed ${task.completedPomos} of ${task.estimatePomos} Pomodoros`} onClick={(event) => { event.stopPropagation(); onUpdate({ completedPomos: Math.min(task.estimatePomos, task.completedPomos + 1) }); }}>{task.completedPomos}<span> / {task.estimatePomos}</span></button>
      <div className="task-menu-wrap">
        <button className="task-menu-button" aria-label={`Options for ${task.title}`} aria-expanded={menu} onClick={(event) => { event.stopPropagation(); setMenu(!menu); }}><DotsThreeVertical size={21} weight="bold" /></button>
        {menu && <div className="task-row-menu popover">
          <button onClick={(event) => { event.stopPropagation(); setMenu(false); setEditing(true); }}><NotePencil size={15} /> Edit task</button>
          <button onClick={(event) => { event.stopPropagation(); setMenu(false); onDelete(); }}><Trash size={15} /> Delete task</button>
        </div>}
      </div>
    </div>
  </article>;
}

export function TasksPanel(props: TasksPanelProps) {
  const [editing, setEditing] = useState(false);
  const [templateMenu, setTemplateMenu] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const projectCreatedCallback = useRef<((project: Project) => void) | undefined>(undefined);
  const openProjectManager = (onCreated?: (project: Project) => void) => {
    projectCreatedCallback.current = onCreated;
    setShowProjects(true);
  };
  useEffect(() => {
    const openEditor = () => setEditing(true);
    window.addEventListener("foucusly-add-task", openEditor);
    return () => window.removeEventListener("foucusly-add-task", openEditor);
  }, []);
  const tasks = [...props.tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const completed = tasks.filter((task) => task.completed).length;
  const activeIndex = Math.max(0, tasks.findIndex((task) => task.id === props.activeTaskId));
  const finishMinutes = tasks.filter((task) => !task.completed).reduce((total, task) => total + Math.max(0, task.estimatePomos - task.completedPomos) * 25, 0);
  const finishAt = new Date(Date.now() + finishMinutes * 60_000).toLocaleTimeString([], {
    hour: props.hourFormat === "12-hour" ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: props.hourFormat === "12-hour"
  });

  return <section className="tasks-section" aria-label="Tasks">
    <div className="tasks-heading">
      <div><h2>Tasks</h2>{tasks.length > 0 && <span className="task-summary">{completed} of {tasks.length} complete</span>}</div>
      <div className="task-heading-actions">
        <button className="icon-button task-overflow-button" aria-label="Task options" aria-expanded={overflow} onClick={() => { setOverflow(!overflow); setTemplateMenu(false); }}><DotsThreeVertical size={24} weight="bold" /></button>
        {overflow && <div className="tasks-overflow popover">
          <button onClick={() => { setOverflow(false); void props.onAction("clear-finished"); }}><Check size={15} /> Clear finished tasks</button>
          <button onClick={() => { setTemplateMenu(!templateMenu); }}><Plus size={15} /> Use Template</button>
          {templateMenu && <div className="template-list">{props.templates.length ? props.templates.map((template) => <button key={template.id} onClick={() => { setOverflow(false); setTemplateMenu(false); void props.onUseTemplate(template.id); }}>{template.name}<span>{template.estimatePomos} pomodoros</span></button>) : <p>No templates saved yet.</p>}</div>}
          <button onClick={() => { setOverflow(false); setShowImport(true); }}><span className="menu-icon"><Plus size={15} /></span> Import from Todoist <LockKey size={13} className="menu-lock" /></button>
          <button onClick={() => { setOverflow(false); setShowProjects(true); }}><Folder size={15} /> Manage projects</button>
          <button onClick={() => { setOverflow(false); void props.onAction("clear-pomos"); }}><Trash size={15} /> Clear act pomodoros</button>
          <button onClick={() => { setOverflow(false); void props.onAction("toggle-hidden"); }}><span className="menu-icon"><Plus size={15} /></span> {props.visible ? "Hide tasks" : "Show tasks"}</button>
          <button className="danger-item" onClick={() => { setOverflow(false); void props.onAction("clear-all"); }}><Trash size={15} /> Clear all tasks</button>
        </div>}
      </div>
    </div>
    {tasks.length > 0 && <div className="tasks-progress"><span style={{ width: `${(completed / tasks.length) * 100}%` }} /></div>}
    {props.visible && <>
      <div className="task-list">
        {tasks.map((task) => <TaskRow key={task.id} task={task} projects={props.projects} active={task.id === props.activeTaskId} onSelect={() => props.onSelect(task.id)} onUpdate={(patch) => void props.onUpdate(task.id, patch)} onDelete={() => void props.onDelete(task.id)} onManageProjects={openProjectManager} />)}
      </div>
      {editing ? <TaskEditor canTemplate={props.templates.length < 3} projects={props.projects} onSave={props.onCreate} onCancel={() => setEditing(false)} onTemplate={props.onCreateTemplate} onManageProjects={openProjectManager} /> : <button className="add-task-button" onClick={() => setEditing(true)}><PlusCircle size={22} weight="fill" /> <span>Add Task</span><kbd>T</kbd></button>}
      {tasks.length > 0 && <div className="finish-estimate">Pomos: {tasks[activeIndex]?.completedPomos ?? 0}/{tasks[activeIndex]?.estimatePomos ?? 0}<span>Finish At: {finishAt} ({(finishMinutes / 60).toFixed(1)}h)</span></div>}
      {tasks.length === 0 && <div className="empty-tasks"><span className="empty-spark"><Plus size={17} /></span><p>You've finished all your tasks for today</p><span className="party-mark">✳</span></div>}
    </>}
    {showImport && <div className="popover-backdrop" onClick={() => setShowImport(false)}><section className="small-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <button className="dialog-close" aria-label="Close" onClick={() => setShowImport(false)}><X size={20} /></button><div className="dialog-lock"><LockKey size={22} /></div><h2>Todoist integration</h2><p>Connect Todoist to bring your tasks into Foucusly.</p><button className="button-dark full-button" onClick={() => { setShowImport(false); props.onToast("Todoist integration is a Premium feature."); }}>Connect Todoist</button>
    </section></div>}
    {showProjects && <ProjectManagerDialog projects={props.projects} onCreate={props.onCreateProject} onRename={props.onRenameProject} onArchive={props.onArchiveProject} onCreated={(project) => projectCreatedCallback.current?.(project)} onClose={() => { setShowProjects(false); projectCreatedCallback.current = undefined; }} />}
  </section>;
}
