import { buildSoakTransferDashboard } from '../src/lib/injectionProjectViews.ts';

const projects = [{ id: 1, lifecycleStatus: 'soaking', wellNo: 'J-1', owner: '’≈π§' }];
const dashboard = buildSoakTransferDashboard(projects, '2026-07-26');
const extendedTodo: { wellNo: string; owner: string } = dashboard.todo[0];
void extendedTodo;

// @ts-expect-error Dashboard calculations must not accept a raw Date.
buildSoakTransferDashboard(projects, new Date('2026-07-25T16:30:00.000Z'));