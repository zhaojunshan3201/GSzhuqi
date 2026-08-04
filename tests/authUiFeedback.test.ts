import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const loginStart = appSource.indexOf('const Login =');
const loginEnd = appSource.indexOf('const SidebarItem =', loginStart);

assert.notEqual(loginStart, -1, 'Login component should exist');
assert.notEqual(loginEnd, -1, 'Login component boundary should exist');

const loginSource = appSource.slice(loginStart, loginEnd);

test('Login shows authentication-specific success and connection feedback', () => {
  assert.match(loginSource, /注册成功，请登录/);
  assert.match(loginSource, /无法连接服务器，请确认服务已启动/);
  assert.doesNotMatch(loginSource, /导入成功！已更新数据/);
  assert.doesNotMatch(loginSource, /导入失败，请检查文件格式/);
});

test('Login passes backend authentication errors through to the user', () => {
  assert.match(loginSource, /setError\(data\.message \|\| '操作失败'\)/);
});
