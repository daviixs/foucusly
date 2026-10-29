import type { TaskBulkAction } from "@foucusly/contracts";
import type { AppDatabase } from "../db.js";

const statements: Record<TaskBulkAction, string> = {
  "clear-finished": "DELETE FROM tasks WHERE completed=1 AND profile_id=?",
  "clear-pomos": "UPDATE tasks SET completed_pomos=0 WHERE profile_id=?",
  "clear-all": "DELETE FROM tasks WHERE profile_id=?",
};

/** Applies a bulk action to the profile's tasks and compacts the remaining sort order. Returns affected rows. */
export function runTaskBulkAction(db: AppDatabase, profileId: string, action: TaskBulkAction): number {
  const apply = db.transaction(() => {
    const { changes } = db.prepare(statements[action]).run(profileId);
    const remaining = db
      .prepare("SELECT id FROM tasks WHERE profile_id=? ORDER BY sort_order, created_at")
      .all(profileId) as Array<{ id: string }>;
    const reorder = db.prepare("UPDATE tasks SET sort_order=? WHERE id=? AND profile_id=?");
    remaining.forEach((task, index) => reorder.run(index, task.id, profileId));
    return changes;
  });
  return apply();
}
