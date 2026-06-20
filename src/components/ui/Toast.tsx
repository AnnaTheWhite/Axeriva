type ToastProps = {
  show: boolean;
  message: string;
};

export default function Toast({
  show,
  message,
}: ToastProps) {
  if (!show) return null;

  return (
    <div
      className="
        fixed
        top-6
        right-6
        z-50
        rounded-2xl
        border
        border-green-500/20
        bg-slate-900
        px-5
        py-4
        shadow-2xl
      "
    >
      <div className="flex items-center gap-3">
        <span className="text-green-400">
          ✓
        </span>

        <span className="text-white">
          {message}
        </span>
      </div>
    </div>
  );
}