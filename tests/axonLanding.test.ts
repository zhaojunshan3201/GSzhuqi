import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';

import { AXON_PAGE_TITLE, AXON_VIDEO_URL } from '../src/components/AxonLandingPage.tsx';

test('exports the Axon page title', () => {
  assert.equal(AXON_PAGE_TITLE, 'Axon — Digital Workers for Mundane Workflows');
});

test('exports the Axon background video URL', () => {
  assert.equal(
    AXON_VIDEO_URL,
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260714_113715_c7e0daa0-8bdd-4486-a2da-040901f8f0ea.mp4',
  );
});

test('renders the specified landing content and interaction markup', async () => {
  const source = await readFile(path.join(process.cwd(), 'src', 'components', 'AxonLandingPage.tsx'), 'utf8');

  for (const text of [
    'Deploy digital workers',
    'for mundane workflows',
    'Eliminate your tedious browser work and 10x your team&apos;s capacity.',
    'Get Early Access',
    'Features',
    'Plans',
    'Security',
    'About',
    'onClick={onEnter}',
    'autoPlay',
    'muted',
    'loop',
    'playsInline',
    AXON_VIDEO_URL,
  ]) {
    assert.ok(source.includes(text), `expected source to include ${text}`);
  }

  assert.ok(source.includes('<section id="axon"'), 'hero should provide the shared navigation target');
  assert.equal((source.match(/href="#axon"/g) ?? []).length, 5, 'logo and four navigation links should target the hero');
});
