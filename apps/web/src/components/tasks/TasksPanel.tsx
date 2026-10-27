import { useEffect, useRef, useState, type DragEvent } from "react";
import { Plus, PlusCircle } from "@phosphor-icons/react";
import type { Project, Task, TaskBulkAction } from "@foucusly/contracts";
import { ProjectManagerDialog } from "../ProjectManagerDialog";
import { TaskEditor } from "./TaskEditor";
import { TaskRow } from "./TaskRow";
import { TasksMenu } from "./TasksMenu";
import type { OpenProjectManager, TaskDraft } from "./types";

interface TasksPanelProps {
  tasks: Task[];
  projects: Project[];
  activeTaskId: string | null;
  hourFormat: "12-hour" | "24-hour";
  pomodoroMinutes: number;
  onCreate: (draft: TaskDraft) => Promise<void>;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (order: string[]) => Promise<void>;
  onAction: (action: TaskBulkAction) => Promise<void>;
  onSelect: (id: string) => void;
  onToast: (message: string) => void;
  onCreateProject: (name: string, color?: string | null) => Promise<Project>;
  onRenameProject: (id: string, name: string) => Promise<void>;
  onUpdateProjectColor: (id: string, color: string | null) => Promise<void>;
  onArchiveProject: (id: string) => Promise<void>;
  onRestoreProject: (id: string) => Promise<void>;
}

export function TasksPanel(props: TasksPanelProps) {
  const [editing, setEditing] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const dragId = useRef<string | null>(null);
  const projectCreatedCallback = useRef<((project: Project) => void) | undefined>(undefined);
  const openProjectManager: OpenProjectManager = (onCreated) => {
    projectCreatedCallback.current = onCreated;
    setShowProjects(true);
  };
  useEffect(() => {
    const openEditor = () => setEditing(true);
    window.addEventListener("foucusly-add-task", openEditor);
    return () => window.removeEventListener("foucusly-add-task", openEditor);
  }, []);
  const tasks = [...props.tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const handleDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    const draggedId = dragId.current ?? event.dataTransfer.getData("text/plain");
    dragId.current = null;
    if (!draggedId || draggedId === targetId) return;
    const ids = tasks.map((task) => task.id).filter((id) => id !== draggedId);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex === -1) return;
    ids.splice(targetIndex, 0, draggedId);
    void props.onReorder(ids).catch((error: Error) => props.onToast(`Could not reorder tasks: ${error.message}`));
  };
  const completed = tasks.filter((task) => task.completed).length;
  const activeIndex = Math.max(0, tasks.findIndex((task) => task.id === props.activeTaskId));
  const finishMinutes = tasks.filter((task) => !task.completed).reduce((total, task) => total + Math.max(0, task.estimatePomos - task.completedPomos) * Math.max(1, props.pomodoroMinutes), 0);
  const finishAt = new Date(Date.now() + finishMinutes * 60_000).toLocaleTimeString([], {
    hour: props.hourFormat === "12-hour" ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: props.hourFormat === "12-hour"
  });

  return <section className="tasks-section" aria-label="Tasks">
    <div className="tasks-heading">
      <div><h2>Tasks</h2>{tasks.length > 0 && <span className="task-summary">{completed} of {tasks.length} complete</span>}</div>
      <TasksMenu tasks={tasks} onAction={props.onAction} onManageProjects={() => openProjectManager()} onToast={props.onToast} />
    </div>
    {tasks.length > 0 && <div className="tasks-progress"><span style={{ width: `${(completed / tasks.length) * 100}%` }} /></div>}
    <div className="task-list">
      {tasks.map((task) => <TaskRow key={task.id} task={task} projects={props.projects} active={task.id === props.activeTaskId} draggable onDragStart={() => { dragId.current = task.id; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, task.id)} onSelect={() => props.onSelect(task.id)} onUpdate={(patch) => void props.onUpdate(task.id, patch)} onDelete={() => void props.onDelete(task.id)} onManageProjects={openProjectManager} />)}
    </div>
    {editing ? <TaskEditor projects={props.projects} onSave={props.onCreate} onCancel={() => setEditing(false)} onManageProjects={openProjectManager} /> : <button className="add-task-button" onClick={() => setEditing(true)}><PlusCircle size={22} weight="fill" /> <span>Add Task</span><kbd>T</kbd></button>}
    {tasks.length > 0 && <div className="finish-estimate">Pomos: {tasks[activeIndex]?.completedPomos ?? 0}/{tasks[activeIndex]?.estimatePomos ?? 0}<span>Finish At: {finishAt} ({(finishMinutes / 60).toFixed(1)}h)</span></div>}
    {tasks.length === 0 && <div className="empty-tasks"><span className="empty-spark"><Plus size={17} /></span><p>You've finished all your tasks for today</p><span className="party-mark">✳</span></div>}
    {showProjects && <ProjectManagerDialog projects={props.projects} onCreate={props.onCreateProject} onRename={props.onRenameProject} onUpdateColor={props.onUpdateProjectColor} onArchive={props.onArchiveProject} onRestore={props.onRestoreProject} onCreated={(project) => projectCreatedCallback.current?.(project)} onClose={() => { setShowProjects(false); projectCreatedCallback.current = undefined; }} />}
  </section>;
}
