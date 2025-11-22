import{f as y,a as m,b as u}from"./index-Blq4MZpy.js";function f({data:a,elements:l,onAfterRender:e}){l.dailySkeleton&&(l.dailySkeleton.style.display="none");const s=Array.isArray(a==null?void 0:a.items)?a.items:[];if(s.length?l.dailyEmptyState&&(l.dailyEmptyState.style.display="none"):(l.dailyEmptyState&&(l.dailyEmptyState.style.display="block",l.dailyEmptyState.textContent="Нет данных по выбранному дню"),l.dailyTable&&(l.dailyTable.style.display="none")),l.dailyPanelTitle){const n=y(a==null?void 0:a.date,{day:"2-digit",month:"long"});l.dailyPanelTitle.textContent=n?`Данные за ${n}`:"Данные за выбранный день"}if(l.dailyPanelSubtitle){const d=y(a==null?void 0:a.date,{day:"2-digit",month:"long"})?"Данные доступны только для текущего месяца":"Выберите день, чтобы увидеть данные";l.dailyPanelSubtitle.textContent=d,l.dailyPanelSubtitle.hidden=!1}v(s,l),e&&e()}function v(a,l){if(!l.dailyTable)return;const{dailyTable:e,dailyEmptyState:s}=l;if(e.innerHTML="",!Array.isArray(a)||!a.length){s&&(s.textContent="Нет данных по выбранному дню",s.style.display="block"),e.style.display="none";return}const n=[...a].sort((t,o)=>{const i=Number.isFinite(Number(t==null?void 0:t.total_amount))?Number(t.total_amount):0;return(Number.isFinite(Number(o==null?void 0:o.total_amount))?Number(o.total_amount):0)-i});e.style.display="block",e.classList.add("has-data");const d=document.createElement("div");d.className="work-row work-row-header",d.innerHTML=`
      <div>Смета</div>
      <div>Работы</div>
      <div>Ед. изм.</div>
      <div>Объём</div>
      <div>Сумма, ₽</div>
    `;const c=document.createDocumentFragment();c.appendChild(d),n.forEach((t,o)=>{const i=document.createElement("div");i.className="work-row daily-row",o===n.length-1&&i.classList.add("work-row-last"),i.innerHTML=`
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
          <span class="daily-cell-value"><strong>${m(t.total_volume,{maximumFractionDigits:3})}</strong></span>
        </div>
        <div class="daily-cell daily-cell-amount">
          <span class="daily-cell-label">Сумма</span>
          <span class="daily-cell-value"><strong>${u(t.total_amount)}</strong></span>
        </div>
      `,c.appendChild(i)});const p=n.reduce((t,o)=>{const i=Number(o.total_amount);return t+(Number.isFinite(i)?i:0)},0),r=document.createElement("div");r.className="work-row work-row-total daily-total-row",r.innerHTML=`
      <div class="daily-cell daily-cell-total-label">Итого по сумме</div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-gap"></div>
      <div class="daily-cell daily-cell-total-amount"><strong>${u(p)}</strong></div>
    `,c.appendChild(r),e.appendChild(c)}export{f as applyDailyData,v as renderDailyTable};
