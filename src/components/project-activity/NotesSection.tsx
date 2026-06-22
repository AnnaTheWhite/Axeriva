import { useEffect, useState } from "react";
import Button from "../ui/Button";
import {
  createProjectNote,
  getProjectNotes,
} from "../../services/projectActivity.service";
import type { ProjectNote } from "../../types/projectActivity";
import { useTranslation } from "../../i18n";

type NotesSectionProps = {
  projectId: number;
};

export default function NotesSection({ projectId }: NotesSectionProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjectNotes(projectId)
      .then(setNotes)
      .catch(() => setError(t("projectActivity.notes.loadFailed")))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const note = await createProjectNote(projectId, content.trim());
      setNotes((prev) => [note, ...prev]);
      setContent("");
    } catch {
      setError(t("projectActivity.notes.addFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
      <h3 className="text-lg font-semibold text-white">{t("projectActivity.notes.title")}</h3>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("projectActivity.notes.placeholder")}
          rows={3}
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit">
          {isSubmitting ? t("projectActivity.notes.adding") : t("projectActivity.notes.addNote")}
        </Button>
      </form>

      <div className="mt-6 space-y-4">
        {isLoading ? null : notes.length === 0 ? (
          <p className="text-sm text-slate-400">{t("projectActivity.notes.noNotes")}</p>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-white">{note.userName}</span>
                <span className="text-slate-500">
                  {new Date(note.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-slate-300">
                {note.content}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
