import { describe, expect, it } from 'vitest';
import { imageMimeFor } from '@angkorgit/core';

describe('imageMimeFor', () => {
  it('maps every image extension the engine loads to its own media type', () => {
    expect(imageMimeFor('a/logo.png')).toBe('image/png');
    expect(imageMimeFor('photo.JPG')).toBe('image/jpeg');
    expect(imageMimeFor('photo.jpeg')).toBe('image/jpeg');
    expect(imageMimeFor('anim.gif')).toBe('image/gif');
    expect(imageMimeFor('pic.webp')).toBe('image/webp');
    expect(imageMimeFor('old.bmp')).toBe('image/bmp');
    expect(imageMimeFor('favicon.ico')).toBe('image/x-icon');
    expect(imageMimeFor('mark.svg')).toBe('image/svg+xml');
    expect(imageMimeFor('new.avif')).toBe('image/avif');
  });
  it('returns null for anything else', () => {
    expect(imageMimeFor('readme.md')).toBeNull();
    expect(imageMimeFor('Makefile')).toBeNull();
  });
});
