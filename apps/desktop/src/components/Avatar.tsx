import { memo, useEffect, useState } from 'react';
import { cn } from '@angkorgit/design-system';
import { avatarHue, initials } from '@/shared/utils';

const hashCache = new Map<string, Promise<string>>();
const urlCache = new Map<string, string>();
const noGravatar = new Set<string>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailHash(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
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

function cachedUrl(email: string, size: number): string | null {
  if (!email || noGravatar.has(email)) return null;
  return urlCache.get(`${normalizeEmail(email)}|${size}`) ?? null;
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
  const [url, setUrl] = useState<string | null>(() => cachedUrl(email, size));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = cachedUrl(email, size);
    setUrl(cached);
    setLoaded(false);
    if (cached || !email || noGravatar.has(email)) return;
    void emailHash(email).then((hash) => {
      if (!cancelled) {
        const resolved = `https://www.gravatar.com/avatar/${hash}?s=${Math.ceil(size * 2)}&d=404`;
        urlCache.set(`${normalizeEmail(email)}|${size}`, resolved);
        setUrl(resolved);
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
