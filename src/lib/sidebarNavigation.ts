export type SidebarGroupKey = 'overview' | 'analysis' | 'focus' | 'measures' | 'production';

export type SidebarIcon =
  | 'LayoutDashboard'
  | 'MapPinned'
  | 'Thermometer'
  | 'Database'
  | 'Activity'
  | 'TrendingUp'
  | 'ClipboardList'
  | 'FileSpreadsheet'
  | 'AlertTriangle'
  | 'Droplets'
  | 'Filter'
  | 'Target'
  | 'MessageSquare';

export interface SidebarNavigationItem {
  tab: string;
  label: string;
  icon: SidebarIcon;
}

export interface SidebarNavigationGroup {
  key: SidebarGroupKey;
  label: string;
  items: SidebarNavigationItem[];
}

export const sidebarNavigationGroups: SidebarNavigationGroup[] = [
  {
    key: 'overview',
    label: '基本情况',
    items: [
      { tab: 'dashboard', label: '系统概览', icon: 'LayoutDashboard' },
      { tab: 'oilWellMap', label: '油井位图', icon: 'MapPinned' },
      { tab: 'wellTemperature', label: '井温监控', icon: 'Thermometer' },
    ],
  },
  {
    key: 'analysis',
    label: '分析系统',
    items: [
      { tab: 'well', label: '单井分析', icon: 'Database' },
      { tab: 'block', label: '区块分析', icon: 'Activity' },
      { tab: 'comparison', label: '对比分析', icon: 'TrendingUp' },
      { tab: 'pumpDeepAnalysis', label: '检泵分析', icon: 'ClipboardList' },
      { tab: 'occupancyAnalysis', label: '占产分析', icon: 'FileSpreadsheet' },
    ],
  },
  {
    key: 'focus',
    label: '重点情况',
    items: [
      { tab: 'analysis', label: '重点监控', icon: 'AlertTriangle' },
      { tab: 'waterLab', label: '含水化验', icon: 'Droplets' },
      { tab: 'pumpAnalysis', label: '检泵跟踪', icon: 'Filter' },
    ],
  },
  {
    key: 'measures',
    label: '措施项目',
    items: [
      { tab: 'measureWellSelection', label: '措施选井', icon: 'Target' },
      { tab: 'measures', label: '措施跟踪', icon: 'ClipboardList' },
      { tab: 'measureAnalysis', label: '措施分析', icon: 'MessageSquare' },
    ],
  },
  {
    key: 'production',
    label: '产量掌控',
    items: [{ tab: 'productionForecast', label: '产量预测', icon: 'TrendingUp' }],
  },
];

export const getSidebarGroupKey = (tab: string) => (
  sidebarNavigationGroups.find((group) => group.items.some((item) => item.tab === tab))?.key
);
