import Link from 'next/link';

/**
 * Root-level fallback: reached for any URL outside the `[locale]/` segment
 * (via the `[...notfound]` catch-all's `notFound()` call). There is no
 * locale context available at this level, so this stays plain-English by
 * design rather than guessing a locale.
 */
export default function RootNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        The page you&apos;re looking for doesn&apos;t exist or may have been moved.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Go to IPROTEX
      </Link>
    </div>
  );
}
