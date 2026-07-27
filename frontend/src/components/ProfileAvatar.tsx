import React, { useEffect, useState } from 'react';
import { UserIcon } from '@heroicons/react/24/solid';
import { getAvatarInitial, resolveUserPhotoUrl } from '@/services/userMedia';

interface ProfileAvatarProps {
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  photo?: string | null;
  alt?: string;
}

const FALLBACK_BRAND_CLASSES = [
  'avatar-fallback-blue',
  'avatar-fallback-green',
  'avatar-fallback-orange',
];

export default function ProfileAvatar({
  name = 'User',
  size = 'md',
  className = '',
  photo,
  alt,
}: ProfileAvatarProps) {
  const sizeClasses =
    size === 'sm'
      ? 'w-8 h-8 text-sm'
      : size === 'lg'
        ? 'w-16 h-16 text-2xl'
        : 'w-12 h-12 text-base';

  const resolvedPhotoUrl = resolveUserPhotoUrl(photo);
  const initial = getAvatarInitial(name);
  const [imageStatus, setImageStatus] = useState<'idle' | 'loaded' | 'error'>(
    resolvedPhotoUrl ? 'idle' : 'error',
  );

  useEffect(() => { 
    setImageStatus(resolvedPhotoUrl ? 'idle' : 'error');
  }, [resolvedPhotoUrl]);

  const fallbackIndex = (name?.length ?? 0) % FALLBACK_BRAND_CLASSES.length;
  const fallbackClass = FALLBACK_BRAND_CLASSES[fallbackIndex];
  const baseClass = `relative shrink-0 overflow-hidden rounded-full ${sizeClasses} ${className}`;
  const showImage = Boolean(resolvedPhotoUrl) && imageStatus !== 'error';

  return (
    <div className={baseClass} role="img" aria-label={alt || name}>
      <span className={`absolute inset-0 flex items-center justify-center rounded-full ${fallbackClass}`} aria-hidden="true">
        {initial ? (
          <span className="flex items-center justify-center w-full h-full font-semibold leading-none text-white translate-y-px select-none">
            {initial}
          </span>
        ) : (
          <span className="flex items-center justify-center w-full h-full">
            <UserIcon className="w-2/3 h-2/3 text-white" />
          </span>
        )}
      </span>

      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedPhotoUrl || undefined}
          alt={alt || name}
          className={`absolute inset-0 block w-full h-full object-cover transition-opacity duration-150 ${imageStatus === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageStatus('loaded')}
          onError={() => setImageStatus('error')}
          decoding="async"
        />
      )}
    </div>
  );
}
