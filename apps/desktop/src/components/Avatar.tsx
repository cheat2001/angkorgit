import { memo, useEffect, useState } from 'react';
import { cn } from '@angkorgit/design-system';
import { avatarHue, initials } from '@/shared/utils';

/**
 * Author avatar: Gravatar profile picture looked up by email, with the
 * colored-initials circle as instant fallback (shown immediately and kept
 * whenever no Gravatar exists). Hash computations and failed lookups are
 * cached module-wide so a 100k-commit graph never repeats work.
 */

const hashCache = new Map<string, Promise<string>>();
const noGravatar = new Set<string>();

function emailHash(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  let promise = hashCache.get(normalized);
  if (!promise) {
    promise = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(normalized))
      .then((buf) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      );
    hashCache.set(normalized, promise);
  }
  return promise;
}

export const Avatar = memo(function Avatar({
  name,
  email,
  size = 20,
  className,
  title,
}: {
  name: string;
  email: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setLoaded(false);
    if (!email || noGravatar.has(email)) return;
    void emailHash(email).then((hash) => {
      if (!cancelled) {
        // d=404 → missing avatars fail fast onto the initials fallback
        setUrl(`https://www.gravatar.com/avatar/${hash}?s=${Math.ceil(size * 2)}&d=404`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [email, size]);

  return (
    <span
      className={cn(
        'relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `hsl(${avatarHue(email)} 45% 45%)`,
        fontSize: Math.max(8, Math.round(size * 0.42)),
      }}
      title={title ?? `${name} <${email}>`}
      aria-label={name}
    >
      {initials(name)}
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-150',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => setLoaded(true)}
          onError={() => {
            noGravatar.add(email);
            setUrl(null);
          }}
        />
      )}
    </span>
  );
});
