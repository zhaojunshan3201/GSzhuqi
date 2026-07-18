import assert from 'node:assert/strict';
import test from 'node:test';

import { AXON_PAGE_TITLE, AXON_VIDEO_URL, AxonLandingPage } from '../src/components/AxonLandingPage.tsx';

type ElementNode = {
  type: unknown;
  props: { children?: unknown; [key: string]: unknown };
};

function findElement(node: unknown, type: string): ElementNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, type);
      if (match) return match;
    }
    return undefined;
  }

  if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) return undefined;
  const element = node as ElementNode;
  if (element.type === type) return element;
  return findElement(element.props.children, type);
}

test('exports the Axon page title', () => {
  assert.equal(AXON_PAGE_TITLE, 'Axon — Digital Workers for Mundane Workflows');
});

test('exports the Axon background video URL', () => {
  assert.equal(
    AXON_VIDEO_URL,
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260714_113715_c7e0daa0-8bdd-4486-a2da-040901f8f0ea.mp4',
  );
});

test('renders a working CTA and configured background video', () => {
  let enterCount = 0;
  const landingPage = AxonLandingPage({ onEnter: () => { enterCount += 1; } });
  const button = findElement(landingPage, 'button');
  const video = findElement(landingPage, 'video');

  assert.ok(button, 'CTA button should be rendered');
  assert.equal(button.props.children, 'Get Early Access');
  assert.equal(typeof button.props.onClick, 'function');
  (button.props.onClick as () => void)();
  assert.equal(enterCount, 1);

  assert.ok(video, 'background video should be rendered');
  assert.equal(video.props.autoPlay, true);
  assert.equal(video.props.muted, true);
  assert.equal(video.props.loop, true);
  assert.equal(video.props.playsInline, true);
  assert.equal(video.props.src, AXON_VIDEO_URL);
});
