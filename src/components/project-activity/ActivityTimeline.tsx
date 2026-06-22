import { useEffect, useState } from "react";
import { getProjectActivity } from "../../services/projectActivity.service";
import type { ProjectActivityEntry } from "../../types/projectActivity";
import { useTranslation } from "../../i18n";
import { translateAttachmentCategory } from "../../i18n/labels";

type ActivityTimelineProps = {
  projectId: number;
};

function describeActivity(
  entry: ProjectActivityEntry,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const fileName =
    (entry.metadata?.fileName as string | undefined) ??
    t("projectActivity.timeline.defaultFileName");
  const preview = entry.metadata?.preview as string | undefined;
  const category = entry.metadata?.category as string | undefined;
  const categoryLabel =
    category && category !== "Other" ? translateAttachmentCategory(t, category) : "";

  switch (entry.type) {
    case "NOTE_CREATED":
      return preview
        ? t("projectActivity.timeline.addedNoteWithPreview", { preview })
        : t("projectActivity.timeline.addedNote");
    case "FILE_UPLOADED":
    case "PHOTO_UPLOADED":
      return categoryLabel
        ? t("projectActivity.timeline.uploadedFileWithCategory", { fileName, category: categoryLabel })
        : t("projectActivity.timeline.uploadedFile", { fileName });
    case "CLOCK_IN":
      return t("projectActivity.timeline.clockedIn");
    case "CLOCK_OUT":
      return t("projectActivity.timeline.clockedOut");
    case "TASK_COMPLETED":
      return t("projectActivity.timeline.completedTask");
    default:
      return entry.type;
  }
}

export default function ActivityTimeline({ projectId }: ActivityTimelineProps) {
  const { t } = useTranslation();
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
      <h3 className="text-lg font-semibold text-white">{t("projectActivity.timeline.title")}</h3>

      <div className="mt-6 space-y-4">
        {isLoading ? null : activity.length === 0 ? (
          <p className="text-sm text-slate-400">{t("projectActivity.timeline.noActivity")}</p>
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
                  {describeActivity(entry, t)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
