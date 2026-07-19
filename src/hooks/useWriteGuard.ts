import { useReadOnly } from "../context/ReadOnlyContext";
import { useTranslation } from "../i18n";

// S2.7 — one-liner for making a write control read-only aware. Spread
// `guardProps` onto any button/action that modifies data: in read-only mode
// it disables the control and adds an explanatory tooltip ("Upgrade your
// subscription to continue."), otherwise it contributes nothing. Keeps every
// disabled-write control consistent without each page re-reading billing
// state. Add `disabled:opacity-50 disabled:cursor-not-allowed` to the
// control's classes for the visual treatment.
export function useWriteGuard() {
  const { readOnly } = useReadOnly();
  const { t } = useTranslation();

  const guardProps = readOnly
    ? { disabled: true, title: t("readOnly.tooltip"), "aria-disabled": true }
    : {};

  return { readOnly, guardProps };
}
