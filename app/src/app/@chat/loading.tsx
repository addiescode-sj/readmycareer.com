export default function ChatLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`flex gap-3 ${i % 2 === 1 ? "flex-row-reverse" : ""}`}>
          <div className="skeleton h-8 w-8 rounded-full shrink-0" />
          <div className="space-y-1 max-w-xs">
            <div className="skeleton h-4 w-48 rounded-2xl" />
            <div className="skeleton h-4 w-36 rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
