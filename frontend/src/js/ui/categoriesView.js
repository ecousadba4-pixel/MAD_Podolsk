import { renderCategories as renderCategoriesExternal } from "@js/categories.js";

export function renderCategoriesView({ groupedCategories, activeCategoryKey, elements, colors, onSelect }) {
  renderCategoriesExternal({
    groupedCategories,
    activeCategoryKey,
    elements,
    colors,
    onSelect,
  });
}
