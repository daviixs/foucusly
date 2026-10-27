import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, DotsThreeVertical, Folder, Trash } from "@phosphor-icons/react";
import type { Task, TaskBulkAction } from "@foucusly/contracts";

interface BulkMenuItem {
  action: TaskBulkAction;
  label: string;
  icon: ReactNode;
  success: string;
  danger?: boolean;
  confirm?: (tasks: Task[]) => string;
  enabled: (tasks: Task[]) => boolean;
}

const bulkItems: Record<TaskBulkAction, BulkMenuItem> = {
  "clear-finished": {
    action: "clear-finished", label: "Clear finished tasks", icon: <Check size={15} />, success: "Finished tasks cleared.",
    enabled: (tasks) => tasks.some((task) => task.completed)
  },
  "clear-pomos": {
    action: "clear-pomos", label: "Clear act pomodoros", icon: <Trash size={15} />, success: "Pomodoro counts reset.",
    enabled: (tasks) => tasks.some((task) => task.completedPomos > 0)
  },
  "clear-all": {
    action: "clear-all", label: "Clear all tasks", icon: <Trash size={15} />, success: "All tasks cleared.", danger: true,
    confirm: (tasks) => `Delete all ${tasks.length} tasks? This cannot be undone.`,
    enabled: (tasks) => tasks.length > 0
  }
};

export function TasksMenu({ tasks, onAction, onManageProjects, onToast }: {
  tasks: Task[];
  onAction: (action: TaskBulkAction) => Promise<void>;
  onManageProjects: () => void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const run = async (item: BulkMenuItem) => {
    setOpen(false);
    if (item.confirm && !window.confirm(item.confirm(tasks))) return;
    setBusy(true);
    try { await onAction(item.action); onToast(item.success); }
    catch (error) { onToast(`Could not ${item.label.toLowerCase()}: ${(error as Error).message}`); }
    finally { setBusy(false); }
  };

  const bulkButton = (item: BulkMenuItem) => <button key={item.action} className={item.danger ? "danger-item" : undefined} disabled={busy || !item.enabled(tasks)} onClick={() => void run(item)}>{item.icon} {item.label}</button>;

  return <div className="task-heading-actions" ref={wrapRef}>
    <button className="icon-button task-overflow-button" aria-label="Task options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><DotsThreeVertical size={24} weight="bold" /></button>
    {open && <div className="tasks-overflow popover" role="menu">
      {bulkButton(bulkItems["clear-finished"])}
      <button onClick={() => { setOpen(false); onManageProjects(); }}><Folder size={15} /> Manage projects</button>
      {bulkButton(bulkItems["clear-pomos"])}
      {bulkButton(bulkItems["clear-all"])}
    </div>}
  </div>;
}
