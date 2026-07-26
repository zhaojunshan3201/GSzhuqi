export type SidebarGroupKey = 'overview' | 'injection' | 'analysis' | 'monitoring' | 'system';

export type SidebarTab =
  | 'dashboard'
  | 'injectionProductionCockpit'
  | 'oilWellMap'
  | 'wellTemperature'
  | 'runtimeLogs'
  | 'well'
  | 'block'
  | 'comparison'
  | 'pumpDeepAnalysis'
  | 'occupancyAnalysis'
  | 'analysis'
  | 'waterLab'
  | 'pumpAnalysis'
  | 'injectionProjectManagement'
  | 'channelingProjectManagement'
  | 'injectionOptimization'
  | 'measureWellSelection'
  | 'injectionPlan'
  | 'injectionConstruction'
  | 'injectionSoakTransfer'
  | 'measures'
  | 'measureAnalysis'
  | 'productionForecast'
  | 'externalTransferTracking';

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
  tab: SidebarTab;
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
      { tab: 'injectionProductionCockpit', label: '注汽驾驶舱', icon: 'LayoutDashboard' },
      { tab: 'oilWellMap', label: '注采状态地图', icon: 'MapPinned' },
      { tab: 'wellTemperature', label: '井温监控', icon: 'Thermometer' },
    ],
  },
  {
    key: 'injection',
    label: '注汽管理',
    items: [
      { tab: 'channelingProjectManagement', label: '\u6ce8\u7a9c\u9879\u76ee\u53f0\u8d26', icon: 'Target' },
      { tab: 'injectionOptimization', label: '注汽优化预测', icon: 'TrendingUp' },
      { tab: 'measureWellSelection', label: '选井决策', icon: 'Target' },
      { tab: 'injectionPlan', label: '方案与计划', icon: 'ClipboardList' },
      { tab: 'injectionConstruction', label: '施工监控', icon: 'Activity' },
      { tab: 'injectionSoakTransfer', label: '焖井转抽', icon: 'TrendingUp' },
      { tab: 'measures', label: '生产响应', icon: 'ClipboardList' },
      { tab: 'measureAnalysis', label: '效果评价', icon: 'MessageSquare' },
    ],
  },
  {
    key: 'analysis',
    label: '生产分析',
    items: [
      { tab: 'well', label: '单井分析', icon: 'Database' },
      { tab: 'block', label: '区块分析', icon: 'Activity' },
      { tab: 'comparison', label: '对比分析', icon: 'TrendingUp' },
      { tab: 'productionForecast', label: '产量预测', icon: 'TrendingUp' },
      { tab: 'externalTransferTracking', label: '外输跟踪', icon: 'TrendingUp' },
    ],
  },
  {
    key: 'monitoring',
    label: '专项监测',
    items: [
      { tab: 'waterLab', label: '含水化验', icon: 'Droplets' },
      { tab: 'pumpAnalysis', label: '检泵跟踪', icon: 'Filter' },
      { tab: 'pumpDeepAnalysis', label: '检泵分析', icon: 'ClipboardList' },
      { tab: 'occupancyAnalysis', label: '占产分析', icon: 'FileSpreadsheet' },
    ],
  },
  {
    key: 'system',
    label: '系统管理',
    items: [{ tab: 'runtimeLogs', label: '运行日志', icon: 'ClipboardList' }],
  },
];

export const getSidebarGroupKey = (tab: string) => (
  sidebarNavigationGroups.find((group) => group.items.some((item) => item.tab === tab))?.key
);
