import { Suspense } from 'react';

import GoogleAuthResultClient from './GoogleAuthResultClient';

export default function GoogleAuthResultPage() {
  return (
    <Suspense fallback={null}>
      <GoogleAuthResultClient />
    </Suspense>
  );
}
