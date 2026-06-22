import { useTranslation } from "../../i18n";
import { getPasswordStrength } from "../../utils/passwordStrength";

type PasswordStrengthMeterProps = {
  password: string;
};

const BAR_COLOR: Record<"weak" | "medium" | "strong", string> = {
  weak: "bg-red-500",
  medium: "bg-orange-500",
  strong: "bg-green-500",
};

const TEXT_COLOR: Record<"weak" | "medium" | "strong", string> = {
  weak: "text-red-400",
  medium: "text-orange-400",
  strong: "text-green-400",
};

const LABEL_KEY: Record<"weak" | "medium" | "strong", string> = {
  weak: "common.passwordStrength.weak",
  medium: "common.passwordStrength.medium",
  strong: "common.passwordStrength.strong",
};

// Renders nothing for an empty password so the meter doesn't clutter the
// form before the user starts typing. Purely presentational — all scoring
// logic lives in utils/passwordStrength.ts, kept separate so this stays a
// thin, reusable view over that pure function.
export default function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const { t } = useTranslation();

  if (!password) return null;

  const { score, level } = getPasswordStrength(password);

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map((segment) => {
          const filled =
            (level === "weak" && segment === 0) ||
            (level === "medium" && segment <= 1) ||
            level === "strong";

          return (
            <div
              key={segment}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                filled ? BAR_COLOR[level] : "bg-white/10"
              }`}
            />
          );
        })}
      </div>

      <p className="text-xs text-white/50">
        {t("common.passwordStrength.label")}{" "}
        <span className={`font-medium ${TEXT_COLOR[level]}`}>{t(LABEL_KEY[level])}</span>
        <span className="text-white/30"> ({score}/5)</span>
      </p>
    </div>
  );
}
