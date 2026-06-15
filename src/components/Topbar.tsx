export default function Topbar() {
  return (
    <header
      className="
        flex
        items-center
        justify-between
        border-b
        border-white/10
        px-8
        py-4
      "
    >
      <div>
        <h2 className="text-lg font-semibold">
          CrewFlow
        </h2>
      </div>

      <div
        className="
          flex
          h-10
          w-10
          items-center
          justify-center
          rounded-full
          bg-orange-500
          font-bold
        "
      >
        A
      </div>
    </header>
  );
}