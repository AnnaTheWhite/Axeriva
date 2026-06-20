import { useState, useRef, useEffect } from "react";

type Option = {
  value: string;
  label: string;
};

type CustomSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
};

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find(
    (o) => o.value === value
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={ref}
      className="relative"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="
          flex
          w-full
          items-center
          justify-between
          rounded-xl
          border
          border-white/10
          bg-white/5
          px-4
          py-3
          text-left
          text-white
          transition
          hover:border-orange-500/40
          hover:bg-white/10
        "
      >
        <span className={selected ? "text-white" : "text-slate-400"}>
          {selected ? selected.label : placeholder}
        </span>

        <svg
          className={`
            h-4
            w-4
            text-slate-400
            transition-transform
            duration-200
            ${open ? "rotate-180" : ""}
          `}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div
          className="
            absolute
            z-50
            mt-2
            w-full
            overflow-hidden
            rounded-xl
            border
            border-white/10
            bg-slate-900
            shadow-2xl
          "
        >
          {options.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400">
              No options available
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`
                  flex
                  w-full
                  items-center
                  px-4
                  py-3
                  text-left
                  text-sm
                  transition
                  hover:bg-orange-500/10
                  hover:text-orange-400
                  ${
                    option.value === value
                      ? "bg-orange-500/15 text-orange-400"
                      : "text-slate-300"
                  }
                `}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
