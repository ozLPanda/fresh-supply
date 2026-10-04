import { ArrowRight } from "lucide-react";
import { AppBadge } from "@/shared/ui/AppBadge";
import "./ActivityChanges.css";

export type ActivityChange = {
  field: string;
  before: string;
  after: string;
};

export function ActivityChanges({ changes }: { changes: ActivityChange[] }) {
  return (
    <div className="activity-changes">
      {changes.map((change) => (
        <div className="activity-changes__item" key={change.field}>
          <AppBadge tone="blue">{change.field}</AppBadge>
          <span className="activity-changes__value is-before" title={change.before}>
            {change.before}
          </span>
          <ArrowRight aria-label="изменено на" size={15} />
          <span className="activity-changes__value is-after" title={change.after}>
            {change.after}
          </span>
        </div>
      ))}
    </div>
  );
}
