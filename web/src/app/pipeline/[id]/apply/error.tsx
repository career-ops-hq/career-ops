"use client";

export default function ApplyError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="text-sm text-red-700 dark:text-red-400">Could not load this apply checklist.</p>
      <p className="mt-2 text-sm text-zinc-600">The report or related files could not be read.</p>
      {error.digest && <p className="mt-3 font-mono text-xs text-zinc-500">Error digest {error.digest}</p>}
      <button
        type="button"
        className="mt-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
        onClick={() => retry()}
      >
        Try again
      </button>
    </div>
  );
}
