import { describe, expect, it } from 'vitest';
import { tabLabels } from '@angkorgit/core';

describe('tabLabels', () => {
  it('uses the folder name alone when names are unique', () => {
    const labels = tabLabels(['/a/hippo-wl', '/b/arpia']);
    expect(labels.get('/a/hippo-wl')).toEqual({ name: 'hippo-wl', hint: null });
    expect(labels.get('/b/arpia')).toEqual({ name: 'arpia', hint: null });
  });

  it('adds the nearest parent folder that tells same-named repositories apart', () => {
    const labels = tabLabels([
      '/Users/me/LCG/csmc-gitlab.remotes.local/arpia',
      '/Users/me/LCG/1. Projects/products/thirdparty/supportingservices/arpia',
    ]);
    expect(labels.get('/Users/me/LCG/csmc-gitlab.remotes.local/arpia')?.hint).toBe('csmc-gitlab.remotes.local');
    expect(labels.get('/Users/me/LCG/1. Projects/products/thirdparty/supportingservices/arpia')?.hint).toBe(
      'supportingservices',
    );
  });

  it('walks further up when the parent folders share a name too', () => {
    const labels = tabLabels(['/work/client/api', '/home/client/api', '/x/other']);
    expect(labels.get('/work/client/api')?.hint).toBe('work/client');
    expect(labels.get('/home/client/api')?.hint).toBe('home/client');
    expect(labels.get('/x/other')?.hint).toBeNull();
  });

  it('matches names case-insensitively and handles Windows separators', () => {
    const labels = tabLabels(['C:\\code\\one\\Api', 'C:\\code\\two\\api']);
    expect(labels.get('C:\\code\\one\\Api')).toEqual({ name: 'Api', hint: 'one' });
    expect(labels.get('C:\\code\\two\\api')).toEqual({ name: 'api', hint: 'two' });
  });
});
