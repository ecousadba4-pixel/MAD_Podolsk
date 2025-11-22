import{f as y,a as v,b as u}from"./index-DS5WPrdZ.js";function b({data:l,elements:a,onAfterRender:e}){a.dailySkeleton&&(a.dailySkeleton.style.display="none");const s=Array.isArray(l==null?void 0:l.items)?l.items:[];if(s.length?a.dailyEmptyState&&(a.dailyEmptyState.style.display="none"):(a.dailyEmptyState&&(a.dailyEmptyState.style.display="block",a.dailyEmptyState.textContent="Нет данных по выбранному дню"),a.dailyTable&&(a.dailyTable.style.display="none")),a.dailyPanelTitle){const o=y(l==null?void 0:l.date,{day:"2-digit",month:"long"});a.dailyPanelTitle.textContent=o?`Данные за ${o}`:"Данные за выбранный день"}if(a.dailyPanelSubtitle){const d=y(l==null?void 0:l.date,{day:"2-digit",month:"long"})?"Данные доступны только для текущего месяца":"Выберите день, чтобы увидеть данные";a.dailyPanelSubtitle.textContent=d,a.dailyPanelSubtitle.hidden=!1}p(s,a),e&&e()}function p(l,a){if(!a.dailyTable)return;const{dailyTable:e,dailyEmptyState:s}=a;if(e.innerHTML="",!Array.isArray(l)||!l.length){s&&(s.textContent="Нет данных по выбранному дню",s.style.display="block"),e.style.display="none";return}const o=[...l].sort((t,n)=>{const i=Number.isFinite(Number(t==null?void 0:t.total_amount))?Number(t.total_amount):0;return(Number.isFinite(Number(n==null?void 0:n.total_amount))?Number(n.total_amount):0)-i});e.style.display="block",e.classList.add("has-data");const d=document.createElement("div");d.className="work-row work-row-header",d.innerHTML=`
      <div>Смета</div>
      <div>Работы</div>
      <div>Ед. изм.</div>
      <div>Объём</div>
      <div>Сумма, ₽</div>
    `;const c=document.createDocumentFragment();c.appendChild(d),o.forEach((t,n)=>{const i=document.createElement("div");i.className="work-row daily-row",n===o.length-1&&i.classList.add("work-row-last"),i.innerHTML=`
        <div class="daily-cell daily-cell-smeta">${t.smeta||"—"}</div>
        <div class="daily-cell daily-cell-name">
          <div class="work-row-name work-row-name--collapsed" data-expanded="false">
            <span class="work-row-name-text">${t.description||"Без названия"}</span>
            <button
              type="button"
              class="work-row-name-toggle"
              aria-expanded="false"
              aria-label="Развернуть полное название"
            >
              <span class="work-row-name-toggle-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="daily-cell daily-cell-unit">
          <span class="daily-cell-label">Ед. изм.</span>
          <span class="daily-cell-value">${t.unit||"—"}</span>
        </div>
        <div class="daily-cell daily-cell-volume">
          <span class="daily-cell-label">Объём</span>
          <span class="daily-cell-value"><strong>${v(t.total_volume,{maximumFractionDigits:3})}</strong></span>
        </div>
        <div class="daily-cell daily-cell-amount">
          <span class="daily-cell-label">Сумма</span>
          <span class="daily-cell-value"><strong>${u(t.total_amount)}</strong></span>
        </div>
      `,c.appendChild(i)});const m=o.reduce((t,n)=>{const i=Number(n.total_amount);return t+(Number.isFinite(i)?i:0)},0),r=document.createElement("div");r.className="work-row work-row-total daily-total-row",r.innerHTML=`
      <div class="daily-cell daily-cell-total-label">Итого по сумме</div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-amount"><strong>${u(m)}</strong></div>
    `,c.appendChild(r),e.appendChild(c)}function g(l){return b(l)}function k(l){return p(l.items,l.elements)}export{g as applyDailyData,k as renderDailyTable};
