import { useState, type DragEvent } from "react";
import { Check, DotsThreeVertical, NotePencil, Trash } from "@phosphor-icons/react";
import type { Project, Task } from "@foucusly/contracts";
import { TaskEditor } from "./TaskEditor";
import type { OpenProjectManager } from "./types";

export function TaskRow({
  task,
  active,
  projects,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onSelect,
  onUpdate,
  onDelete,
  onManageProjects,
}: {
  task: Task;
  active: boolean;
  projects: Project[];
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
  onSelect: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onManageProjects: OpenProjectManager;
}) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const project = task.projectId ? (projects.find((item) => item.id === task.projectId) ?? null) : null;
  if (editing)
    return (
      <TaskEditor
        edit
        initial={task}
        projects={projects}
        onSave={async (draft) => {
          await onUpdate(draft);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
        onManageProjects={onManageProjects}
      />
    );
  return (
    <article
      className={`task-row ${active ? "task-active" : ""} ${task.completed ? "task-completed" : ""} ${draggable ? "task-draggable" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
    >
      <button
        className={`task-check ${task.completed ? "checked" : ""}`}
        aria-label={task.completed ? "Mark task incomplete" : "Mark task complete"}
        onClick={(event) => {
          event.stopPropagation();
          onUpdate({ completed: !task.completed });
        }}
      >
        {task.completed && <Check size={13} weight="bold" />}
      </button>
      <div className="task-copy">
        <button className="task-name" onClick={onSelect}>
          {task.title}
        </button>
        {project && (
          <span className="task-project-label">
            <i className="project-dot" style={{ background: project.color ?? "#9aa3ad" }} />
            {project.name}
          </span>
        )}
        {!project && task.projectId && <span className="task-project-label">Archived project</span>}
        {task.note && <p className="task-note-preview">{task.note}</p>}
        <span className="task-progress">
          {task.completedPomos} / {task.estimatePomos}
        </span>
      </div>
      <div className="task-row-actions">
        <button
          className="pomo-count"
          aria-label={`Completed ${task.completedPomos} of ${task.estimatePomos} Pomodoros`}
          onClick={(event) => {
            event.stopPropagation();
            onUpdate({ completedPomos: Math.min(task.estimatePomos, task.completedPomos + 1) });
          }}
        >
          {task.completedPomos}
          <span> / {task.estimatePomos}</span>
        </button>
        <div className="task-menu-wrap">
          <button
            className="task-menu-button"
            aria-label={`Options for ${task.title}`}
            aria-expanded={menu}
            onClick={(event) => {
              event.stopPropagation();
              setMenu(!menu);
            }}
          >
            <DotsThreeVertical size={21} weight="bold" />
          </button>
          {menu && (
            <div className="task-row-menu popover">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu(false);
                  setEditing(true);
                }}
              >
                <NotePencil size={15} /> Edit task
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu(false);
                  onDelete();
                }}
              >
                <Trash size={15} /> Delete task
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
