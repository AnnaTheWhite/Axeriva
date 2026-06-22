import { useState } from "react";
import DeleteAccountModal from "./DeleteAccountModal";
import { useTranslation } from "../../i18n";

type DangerZoneSectionProps = {
  warning?: string;
};

export default function DangerZoneSection({ warning }: DangerZoneSectionProps) {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="mt-8 max-w-md rounded-3xl border border-red-500/30 bg-red-500/5 p-8">
      <h3 className="text-lg font-semibold text-red-400">{t("account.dangerZone.title")}</h3>
      <p className="mt-2 text-sm text-slate-400">
        {t("account.dangerZone.description")}
      </p>

      {warning && (
        <p className="mt-4 rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
          {warning}
        </p>
      )}

      <button
        onClick={() => setIsModalOpen(true)}
        className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
      >
        {t("account.dangerZone.deleteAccount")}
      </button>

      <DeleteAccountModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
