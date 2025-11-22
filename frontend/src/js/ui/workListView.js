import { initializeWorkList, renderWorkRows as renderWorkRowsExternal } from "@js/work-list.js";
import { calculateDelta } from "@js/utils.js";

export function initWorkListView({ container, onSortChange, onWorkClick, initializeNameToggle }) {
  return initializeWorkList({
    container,
    onSortChange,
    onWorkClick,
  });
}

export function renderWorkRowsView({ scroller, works, onWorkClick, initializeNameToggle }) {
  renderWorkRowsExternal({
    scroller,
    works,
    onWorkClick,
    initializeNameToggle,
    calculateDeltaFn: (item) => calculateDelta(item),
  });
}
