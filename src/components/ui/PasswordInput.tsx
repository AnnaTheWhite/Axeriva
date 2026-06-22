import { useState, type InputHTMLAttributes } from "react";
import { useTranslation } from "../../i18n";
import PasswordStrengthMeter from "./PasswordStrengthMeter";

// Same visual styling as every plain password <input> across the auth
// pages — kept here so PasswordInput is a drop-in replacement with no
// visual change. Callers can still override via `className`.
const DEFAULT_INPUT_CLASS =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  // Opt-in so existing call sites (e.g. Login) render exactly as before —
  // only Register/Reset Password's new-password field passes this.
  showStrength?: boolean;
};

// Drop-in replacement for <input type="password">. Forwards every native
// input attribute (placeholder, autoComplete, name, disabled, etc.) so it
// can be reused on any future auth page without needing new props added
// here. The eye toggle only flips the input's `type` between "password"
// and "text" — no auth/validation logic lives in this component. The
// optional strength meter reads the same controlled `value` the caller
// already passes in, so there's no second source of truth for the
// password string.
export default function PasswordInput({
  className,
  showStrength,
  ...inputProps
}: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="relative">
        <input
          {...inputProps}
          type={visible ? "text" : "password"}
          className={`${className ?? DEFAULT_INPUT_CLASS} pr-10`}
        />

        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("common.hidePassword") : t("common.showPassword")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/50 transition hover:text-white"
        >
          {visible ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 3l18 18M10.58 10.58a2 2 0 102.83 2.83M9.88 4.24A9.77 9.77 0 0112 4c5 0 9 4 10 8a10.4 10.4 0 01-2.16 3.19M6.1 6.1A10.4 10.4 0 002 12c1 4 5 8 10 8a9.77 9.77 0 003.76-.74"
              />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2 12c1-4 5-8 10-8s9 4 10 8c-1 4-5 8-10 8s-9-4-10-8z"
              />
              <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      {showStrength && <PasswordStrengthMeter password={String(inputProps.value ?? "")} />}
    </div>
  );
}
