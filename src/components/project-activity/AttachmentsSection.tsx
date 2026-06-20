import { useEffect, useRef, useState } from "react";
import {
  attachmentDownloadUrl,
  deleteProjectAttachment,
  getProjectAttachments,
  uploadProjectAttachment,
} from "../../services/projectActivity.service";
import type { ProjectAttachment } from "../../types/projectActivity";

type AttachmentsSectionProps = {
  projectId: number;
  canDelete: boolean;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentsSection({
  projectId,
  canDelete,
}: AttachmentsSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjectAttachments(projectId)
      .then(setAttachments)
      .catch(() => setError("Failed to load files"))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  async function handleUpload(file: File) {
    setError(null);
    setIsUploading(true);

    try {
      const attachment = await uploadProjectAttachment(projectId, file);
      setAttachments((prev) => [attachment, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }

  async function handleDelete(id: number) {
    try {
      await deleteProjectAttachment(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError("Failed to delete file");
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
      <h3 className="text-lg font-semibold text-white">Photos & Files</h3>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
          isDragging
            ? "border-orange-500 bg-orange-500/10"
            : "border-white/10 bg-white/5 hover:border-white/20"
        }`}
      >
        <p className="text-sm text-slate-300">
          {isUploading
            ? "Uploading..."
            : "Drag & drop a file here, or click to choose one"}
        </p>
        <p className="mt-1 text-xs text-slate-500">JPG, PNG, PDF, DOCX, XLSX</p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? null : attachments.length === 0 ? (
          <p className="text-sm text-slate-400">No files uploaded yet.</p>
        ) : (
          attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
            >
              {attachment.isImage ? (
                <a
                  href={attachmentDownloadUrl(attachment.fileUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-video w-full overflow-hidden bg-black/20"
                >
                  <img
                    src={attachmentDownloadUrl(attachment.fileUrl)}
                    alt={attachment.fileName}
                    className="h-full w-full object-cover"
                  />
                </a>
              ) : (
                <a
                  href={attachmentDownloadUrl(attachment.fileUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex aspect-video w-full items-center justify-center bg-black/20 text-3xl"
                >
                  📄
                </a>
              )}

              <div className="p-3">
                <p className="truncate text-sm font-medium text-white" title={attachment.fileName}>
                  {attachment.fileName}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {attachment.userName} · {formatFileSize(attachment.fileSize)}
                </p>

                <div className="mt-3 flex items-center justify-between">
                  <a
                    href={attachmentDownloadUrl(attachment.fileUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-orange-500 hover:underline"
                  >
                    Download
                  </a>

                  {canDelete && (
                    <button
                      onClick={() => handleDelete(attachment.id)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
