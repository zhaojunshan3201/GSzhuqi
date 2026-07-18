import assert from 'node:assert/strict';
import test from 'node:test';

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
