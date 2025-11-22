import { applyDailyDataView, renderDailyTableView } from "@js/ui/dailyReportView.js";

// Прокси-функции для обратной совместимости. Весь UI-код теперь в ui/dailyReportView.

export function applyDailyData(args) {
  return applyDailyDataView(args);
}

export function renderDailyTable(args) {
  return renderDailyTableView(args.items, args.elements);
}
