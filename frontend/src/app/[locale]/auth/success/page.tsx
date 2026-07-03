import { Suspense } from 'react';

import GoogleAuthSuccessClient from './GoogleAuthSuccessClient';

export default function GoogleAuthSuccessPage() {
  return (
    <Suspense fallback={null}>
      <GoogleAuthSuccessClient />
    </Suspense>
  );
}