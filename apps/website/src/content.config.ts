import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ base: '../../docs', pattern: ['*.md', '!Launch-Checklist.md'] }),
});

export const collections = { docs };
