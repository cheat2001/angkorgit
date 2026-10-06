const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

export function imageMimeFor(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null;
}
