import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { getProjects } from "../services/project.service";
import type { Project } from "../types/project";
import NotesSection from "../components/project-activity/NotesSection";
import AttachmentsSection from "../components/project-activity/AttachmentsSection";
import ActivityTimeline from "../components/project-activity/ActivityTimeline";
import { useTranslation } from "../i18n";

export default function MyProjectDetailsPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);

  useEffect(() => {
    getProjects()
      .then((projects) => {
        setProject(projects.find((p) => p.id === Number(id)) ?? null);
      })
      .catch(() => setProject(null));
  }, [id]);

  if (project === undefined) {
    return null;
  }

  if (project === null) {
    return (
      <div className="p-4 sm:p-8">
        <EmptyState
          title={t("myProjects.notFoundTitle")}
          description={t("myProjects.notFoundDesc")}
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <Link to="/my-projects" className="text-sm text-orange-500 hover:underline">
        {t("myProjects.backToMyProjects")}
      </Link>

      <PageHeader title={project.name} subtitle={project.description} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NotesSection projectId={project.id} />
        <ActivityTimeline projectId={project.id} />
      </div>

      <div className="mt-6">
        {/* EMPLOYEE can upload but not delete — only BUSINESS_OWNER/DEVELOPER can. */}
        <AttachmentsSection projectId={project.id} canDelete={false} />
      </div>
    </div>
  );
}
