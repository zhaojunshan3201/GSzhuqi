import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AXON_AERIAL_VIDEO, AXON_PAGE_TITLE, AxonLandingPage } from '../src/components/AxonLandingPage.tsx';

type ElementNode = { type: unknown; props: { children?: unknown; [key: string]: unknown } };

function findElement(node: unknown, type: string): ElementNode | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean);
  if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) return undefined;
  const element = node as ElementNode;
  return element.type === type ? element : findElement(element.props.children, type);
}

test('exports the Chinese system title', () => {
  assert.equal(AXON_PAGE_TITLE, '高采三厂生产动态分析与采油作业管理系统');
});

test('exports the aerial background video', () => {
  assert.match(AXON_AERIAL_VIDEO, /axon-aerial-background\.mp4$/);
});

test('renders a working Chinese CTA and looping video', () => {
  let enterCount = 0;
  const landingPage = AxonLandingPage({ onEnter: () => { enterCount += 1; } });
  const button = findElement(landingPage, 'button');
  const video = findElement(landingPage, 'video');
  assert.ok(button);
  assert.equal(button.props.children, '进入系统');
  (button.props.onClick as () => void)();
  assert.equal(enterCount, 1);
  assert.ok(video);
  assert.equal(video.props.src, AXON_AERIAL_VIDEO);
  assert.equal(video.props.loop, true);
});

test('moves runtime status details out of the header and into the runtime logs page', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const header = appSource.match(/<header className="app-header">([\s\S]*?)<\/header>/)?.[1];

  assert.ok(header);
  assert.doesNotMatch(header, /syncStatus|cacheInfo|cacheSourceText/);
  assert.match(appSource, /activeTab === 'runtimeLogs'/);
  assert.match(appSource, /数据更新日期/);
  assert.match(appSource, /同步状态/);
  assert.match(appSource, /缓存预热/);
  assert.match(appSource, /缓存来源/);
  assert.match(appSource, /同步错误详情/);
  assert.match(appSource, /syncStatus\?\.lastError &&/);
  assert.match(appSource, /\{syncStatus\.lastError\}/);
});
