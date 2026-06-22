import { useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentDownloadUrl,
  deleteProjectAttachment,
  getProjectAttachments,
  uploadProjectAttachments,
} from "../../services/projectActivity.service";
import AttachmentLightbox from "./AttachmentLightbox";
import {
  ATTACHMENT_CATEGORIES,
  type AttachmentCategory,
  type ProjectAttachment,
} from "../../types/projectActivity";
import { useTranslation } from "../../i18n";
import { translateAttachmentCategory } from "../../i18n/labels";

type AttachmentsSectionProps = {
  projectId: number;
  canDelete: boolean;
};

type TypeFilter = "All" | "Images" | "Documents";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AttachmentsSection({
  projectId,
  canDelete,
}: AttachmentsSectionProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploadCategory, setUploadCategory] = useState<AttachmentCategory>("Other");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [categoryFilter, setCategoryFilter] = useState<AttachmentCategory | "All">("All");

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const typeFilterLabels: Record<TypeFilter, string> = {
    All: t("projectActivity.attachments.typeAll"),
    Images: t("projectActivity.attachments.typeImages"),
    Documents: t("projectActivity.attachments.typeDocuments"),
  };

  useEffect(() => {
    getProjectAttachments(projectId)
      .then(setAttachments)
      .catch(() => setError(t("projectActivity.attachments.loadFailed")))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  async function handleUpload(files: File[]) {
    if (files.length === 0) return;

    setError(null);
    setIsUploading(true);

    try {
      const uploaded = await uploadProjectAttachments(projectId, files, uploadCategory);
      setAttachments((prev) => [...uploaded, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("projectActivity.attachments.uploadFailed"));
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleUpload(Array.from(e.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    handleUpload(Array.from(e.dataTransfer.files ?? []));
  }

  async function handleDelete(id: number) {
    try {
      await deleteProjectAttachment(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError(t("projectActivity.attachments.deleteFailed"));
    }
  }

  const filteredAttachments = useMemo(() => {
    return attachments.filter((a) => {
      if (typeFilter === "Images" && !a.isImage) return false;
      if (typeFilter === "Documents" && a.isImage) return false;
      if (categoryFilter !== "All" && a.category !== categoryFilter) return false;
      return true;
    });
  }, [attachments, typeFilter, categoryFilter]);

  const galleryImages = filteredAttachments.filter((a) => a.isImage);
  const documents = filteredAttachments.filter((a) => !a.isImage);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
      <h3 className="text-lg font-semibold text-white">{t("projectActivity.attachments.title")}</h3>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="text-sm text-slate-400">
          {t("projectActivity.attachments.categoryLabel")}
        </label>
        <select
          value={uploadCategory}
          onChange={(e) => setUploadCategory(e.target.value as AttachmentCategory)}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-500"
        >
          {ATTACHMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {translateAttachmentCategory(t, category)}
            </option>
          ))}
        </select>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition sm:p-8 ${
          isDragging
            ? "border-orange-500 bg-orange-500/10"
            : "border-white/10 bg-white/5 hover:border-white/20"
        }`}
      >
        <p className="text-sm text-slate-300">
          {isUploading
            ? t("projectActivity.attachments.uploading")
            : t("projectActivity.attachments.dropHint")}
        </p>
        <p className="mt-1 text-xs text-slate-500">{t("projectActivity.attachments.allowedTypes")}</p>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t("table.type")}</span>
          {(["All", "Images", "Documents"] as TypeFilter[]).map((option) => (
            <button
              key={option}
              onClick={() => setTypeFilter(option)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                typeFilter === option
                  ? "bg-orange-500 text-white"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {typeFilterLabels[option]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t("table.category")}</span>
          <button
            onClick={() => setCategoryFilter("All")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              categoryFilter === "All"
                ? "bg-orange-500 text-white"
                : "bg-white/5 text-slate-400 hover:bg-white/10"
            }`}
          >
            {t("projectActivity.attachments.categoryAll")}
          </button>
          {ATTACHMENT_CATEGORIES.map((category) => (
            <button
              key={category}
              onClick={() => setCategoryFilter(category)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                categoryFilter === category
                  ? "bg-orange-500 text-white"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {translateAttachmentCategory(t, category)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? null : filteredAttachments.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">{t("projectActivity.attachments.noMatch")}</p>
      ) : (
        <>
          {galleryImages.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium text-slate-300">{t("projectActivity.attachments.gallery")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {galleryImages.map((attachment, i) => (
                  <button
                    key={attachment.id}
                    onClick={() => setLightboxIndex(i)}
                    className="group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black/20"
                  >
                    <img
                      src={attachmentDownloadUrl(attachment.fileUrl)}
                      alt={attachment.fileName}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                    <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                      {translateAttachmentCategory(t, attachment.category)}
                    </span>
                    {canDelete && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(attachment.id);
                        }}
                        className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-red-400 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        {t("common.delete")}
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[10px] text-white">
                      {attachment.userName} · {formatDate(attachment.createdAt)} ·{" "}
                      {formatFileSize(attachment.fileSize)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {documents.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium text-slate-300">{t("projectActivity.attachments.documents")}</p>
              <div className="space-y-2">
                {documents.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-2xl">📄</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {attachment.fileName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {translateAttachmentCategory(t, attachment.category)} · {attachment.userName} ·{" "}
                          {formatDate(attachment.createdAt)} ·{" "}
                          {formatFileSize(attachment.fileSize)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <a
                        href={attachmentDownloadUrl(attachment.fileUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-orange-500 hover:underline"
                      >
                        {t("common.download")}
                      </a>

                      {canDelete && (
                        <button
                          onClick={() => handleDelete(attachment.id)}
                          className="text-xs text-red-400 hover:underline"
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {lightboxIndex !== null && (
        <AttachmentLightbox
          images={galleryImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
