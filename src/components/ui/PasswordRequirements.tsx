import { useTranslation } from "../../i18n";
import { PASSWORD_MIN_LENGTH } from "../../utils/passwordPolicy";

// Purely presentational requirement hint rendered below new-password fields
// (B3). The rule belongs to the FORM, not the input widget — ResetPasswordPage
// draws two PasswordInputs but needs one hint, and LoginPage must never show
// it — which is why this is a standalone component instead of a
// PasswordInput prop.
export default function PasswordRequirements() {
  const { t } = useTranslation();

  return (
    <p className="text-xs text-white/50">
      {t("common.passwordRequirements", { min: PASSWORD_MIN_LENGTH })}
    </p>
  );
}
