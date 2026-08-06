import { PageSkeleton } from '@/components/Skeleton';

/**
 * App Router route-transition fallback. Most pages under `[locale]/` are
 * client components that fetch their own data, so this mainly covers the
 * navigation/hydration gap before that client code takes over — it's what
 * keeps that gap from being a blank white screen.
 */
export default function LocaleLoading() {
  return <PageSkeleton />;
}
