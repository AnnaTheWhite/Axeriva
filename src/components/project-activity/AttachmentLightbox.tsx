import { useEffect } from "react";
import { attachmentDownloadUrl } from "../../services/projectActivity.service";
import type { ProjectAttachment } from "../../types/projectActivity";

type AttachmentLightboxProps = {
  images: ProjectAttachment[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
};

export default function AttachmentLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: AttachmentLightboxProps) {
  const current = images[index];

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNavigate((index + 1) % images.length);
      if (e.key === "ArrowLeft") onNavigate((index - 1 + images.length) % images.length);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, images.length, onClose, onNavigate]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-6 top-6 text-3xl text-white/70 hover:text-white"
        aria-label="Close"
      >
        ×
      </button>

      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate((index - 1 + images.length) % images.length);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-2xl text-white hover:bg-white/20"
          aria-label="Previous"
        >
          ‹
        </button>
      )}

      <img
        src={attachmentDownloadUrl(current.fileUrl)}
        alt={current.fileName}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
      />

      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate((index + 1) % images.length);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-2xl text-white hover:bg-white/20"
          aria-label="Next"
        >
          ›
        </button>
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-black/60 px-4 py-2 text-center text-sm text-white">
        <p>{current.fileName}</p>
        <p className="text-xs text-slate-400">
          {index + 1} / {images.length}
        </p>
      </div>
    </div>
  );
}
