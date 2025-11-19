from playwright.sync_api import sync_playwright

URL = "http://localhost:8001"
OUT = "docs/modal_screenshot.png"

sample_rows = [
    {"date": "2025-11-01", "amount": 40.9, "unit": "100 м", "total": 311096},
    {"date": "2025-11-02", "amount": 33.5, "unit": "100 м", "total": 254747},
    {"date": "2025-11-03", "amount": 51.5, "unit": "100 м", "total": 391854},
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 900, "height": 900})
    page.goto(URL)
    # Ждём основного рендера
    page.wait_for_timeout(500)

    # Вставляем тестовые строки в модальное окно и показываем его
    page.evaluate("""
    (rows) => {
      const list = document.getElementById('daily-modal-list');
      const empty = document.getElementById('daily-modal-empty');
      if (!list) return;
      list.innerHTML = '';
      // header
      const header = document.createElement('div');
      header.className = 'modal-row modal-row-header';
      header.innerHTML = '<div>Дата</div><div>Объем</div><div>Сумма,₽</div>';
      list.appendChild(header);
      rows.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'modal-row';
        const date = new Date(it.date).toLocaleDateString('ru-RU', {day: '2-digit', month: 'long'});
        const formattedAmount = Number.isFinite(it.amount) ? it.amount.toFixed(1) : '–';
        const valueText = it.unit ? `${formattedAmount} (${it.unit})` : formattedAmount;
        const formattedTotal = Number.isFinite(it.total) ? it.total.toLocaleString('ru-RU') : '–';
        row.innerHTML = `\n          <div class="modal-row-date">${date}</div>\n          <div class="modal-row-value">${valueText}</div>\n          <div class="modal-row-sum">${formattedTotal}</div>\n        `;
        list.appendChild(row);
      });
      if (empty) empty.style.display = 'none';
      list.style.display = 'grid';
      const modal = document.getElementById('daily-modal');
      if (modal) {
        modal.classList.add('visible');
        modal.setAttribute('aria-hidden', 'false');
      }
    }
    """, sample_rows)

    # Подождём анимацию, если есть
    page.wait_for_timeout(300)

    # Сделаем скриншот модального контейнера
    modal = page.query_selector('#daily-modal .modal')
    if modal:
        modal.screenshot(path=OUT)
    else:
        page.screenshot(path=OUT, full_page=True)

    browser.close()
    print('Saved screenshot to', OUT)
