import { useEffect, useState } from "react";
import { getProjectActivity } from "../../services/projectActivity.service";
import type { ProjectActivityEntry } from "../../types/projectActivity";

type ActivityTimelineProps = {
  projectId: number;
};

function describeActivity(entry: ProjectActivityEntry): string {
  const fileName = (entry.metadata?.fileName as string | undefined) ?? "a file";
  const preview = entry.metadata?.preview as string | undefined;

  switch (entry.type) {
    case "NOTE_CREATED":
      return preview ? `added a note: "${preview}"` : "added a note";
    case "FILE_UPLOADED":
      return `uploaded ${fileName}`;
    case "PHOTO_UPLOADED":
      return `uploaded ${fileName}`;
    case "CLOCK_IN":
      return "clocked in";
    case "CLOCK_OUT":
      return "clocked out";
    case "TASK_COMPLETED":
      return "completed a task";
    default:
      return entry.type;
  }
}

export default function ActivityTimeline({ projectId }: ActivityTimelineProps) {
  const [activity, setActivity] = useState<ProjectActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getProjectActivity(projectId)
      .then(setActivity)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [projectId]);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
      <h3 className="text-lg font-semibold text-white">Activity Timeline</h3>

      <div className="mt-6 space-y-4">
        {isLoading ? null : activity.length === 0 ? (
          <p className="text-sm text-slate-400">No activity yet.</p>
        ) : (
          <ol className="space-y-4 border-l border-white/10 pl-4">
            {activity.map((entry) => (
              <li key={entry.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-orange-500" />
                <p className="text-sm text-slate-300">
                  <span className="text-slate-500">
                    {new Date(entry.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>{" "}
                  — <span className="font-medium text-white">{entry.userName}</span>{" "}
                  {describeActivity(entry)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
