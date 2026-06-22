import { useEffect, useState } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { hu } from "date-fns/locale";

import "react-big-calendar/lib/css/react-big-calendar.css";

import { getShifts } from "../services/shift.service";
import { useTranslation } from "../i18n";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { hu },
});

export default function CalendarPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadShifts = async () => {
      try {
        const data = await getShifts();

        const mapped = data.map((shift: any) => ({
          id: shift.id,
          title: shift.employee
            ? `${shift.employee.firstName} ${shift.employee.lastName}${shift.project ? ` – ${shift.project.name}` : ""}`
            : shift.employeeId,
          start: new Date(shift.start),
          end: new Date(shift.end),
          resource: shift,
        }));

        setEvents(mapped);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadShifts();
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">{t("schedule.calendar.title")}</h1>

        <p className="mt-2 text-slate-400">
          {t("schedule.calendar.subtitle")}
        </p>
      </div>

      {loading ? (
        <p>{t("common.loading")}</p>
      ) : (
        <div
          className="
            overflow-hidden
            rounded-3xl
            border
            border-white/10
            bg-white/5
            p-6
          "
        >
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 700 }}
            culture="hu"
            messages={{
              next: "Következő",
              previous: "Előző",
              today: "Ma",
              month: "Hónap",
              week: "Hét",
              day: "Nap",
              agenda: "Napirend",
              noEventsInRange: "Nincs műszak ebben az időszakban",
            }}
          />
        </div>
      )}
    </div>
  );
}
