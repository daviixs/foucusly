import { Folder, Plus } from "@phosphor-icons/react";
import type { Project } from "@foucusly/contracts";

interface Props {
  projects: Project[];
  value: string | null;
  onChange: (projectId: string | null) => void;
  onManage: () => void;
}

export function ProjectPicker({ projects, value, onChange, onManage }: Props) {
  return (
    <div className="project-picker-row">
      <label className="project-picker">
        <Folder size={15} />
        <span>Project</span>
        <select
          aria-label="Task project"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="project-manage-button"
        aria-label="Manage projects"
        title="Manage projects"
        onClick={onManage}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
