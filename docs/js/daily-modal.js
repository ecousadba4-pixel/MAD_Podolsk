import { formatDate, showToast } from "./utils.js";

// Режимы модального окна:
// - "average" — среднедневная выручка (только сумма)
// - "work" — расшифровка по конкретной работе (объём + сумма)

export class DailyModal {
	constructor({ elements, dataManager, visitorTracker, getSelectedMonthLabel, isCurrentMonth, announce }) {
		this.elements = elements;
		this.dataManager = dataManager;
		this.visitorTracker = visitorTracker || null;
		this.getSelectedMonthLabel = getSelectedMonthLabel;
		this.isCurrentMonth = isCurrentMonth;
		this.announce = announce || (() => {});

		this.summaryDailyRevenue = [];
		this.dailyRevenue = [];
		this.dailyModalMode = "average";
		this.selectedMonthIso = null;
	}

	setSelectedMonth(monthIso) {
		this.selectedMonthIso = monthIso;
	}

	setSummaryDailyRevenue(summaryDailyRevenue) {
		this.summaryDailyRevenue = Array.isArray(summaryDailyRevenue) ? summaryDailyRevenue : [];
	}

	bindEvents() {
		if (this.elements.dailyAverageCard) {
			this.elements.dailyAverageCard.addEventListener("click", () => this.openAverageModal());
		}
		if (this.elements.dailyModalClose) {
			this.elements.dailyModalClose.addEventListener("click", () => this.close());
		}
		if (this.elements.dailyModal) {
			this.elements.dailyModal.addEventListener("click", (event) => {
				if (event.target === this.elements.dailyModal) {
					this.close();
				}
			});
		}
	}

	openAverageModal() {
		if (!this.summaryDailyRevenue.length || !this.elements.dailyModal || !this.isCurrentMonth(this.selectedMonthIso)) {
			return;
		}

		const titleEl = this.elements.dailyModal.querySelector("#daily-modal-title")
			|| document.getElementById("daily-modal-title");
		if (titleEl) titleEl.textContent = "Среднедневная выручка";

		const monthLabel = this.getSelectedMonthLabel() || "выбранный месяц";
		if (this.elements.dailyModalSubtitle) {
			this.elements.dailyModalSubtitle.textContent = `По дням за ${monthLabel.toLowerCase()}`;
		}

		this.dailyRevenue = [...this.summaryDailyRevenue];
		this.dailyModalMode = "average";
		this.renderList();
		this.show();
	}

	async openWorkModal(item, selectedMonthIso) {
		if (!item || !this.elements.dailyModal || !this.isCurrentMonth(selectedMonthIso)) {
			return;
		}

		const workName = (item.work_name || item.description || "").toString();
		const monthIso = selectedMonthIso;
		const apiBase = (this.dataManager && this.dataManager.apiUrl)
			? this.dataManager.apiUrl.replace(/\/$/, "")
			: "/api/dashboard";

		const url = new URL(`${apiBase}/work-breakdown`, window.location.origin);
		url.searchParams.set("month", monthIso);
		url.searchParams.set("work", workName);

		try {
			const titleEl = this.elements.dailyModal.querySelector("#daily-modal-title")
				|| document.getElementById("daily-modal-title");
			if (titleEl) titleEl.textContent = `Расшифровка: ${workName}`;
			if (this.elements.dailyModalSubtitle) {
				this.elements.dailyModalSubtitle.textContent = "";
			}

			const response = await fetch(url.toString(), {
				headers: this.visitorTracker ? this.visitorTracker.buildHeaders() : {},
			});
			if (!response.ok) throw new Error("HTTP " + response.status);
			const payload = await response.json();
			const items = Array.isArray(payload) ? payload : (payload?.daily || []);

			this.dailyModalMode = "work";
			this.dailyRevenue = (items || []).map((it) => {
				const date = it.date || it.work_date || it.day;
				const raw = it.amount ?? it.total_volume ?? it.value;
				const amount = raw === null || raw === undefined ? null : Number(raw);
				const unit = it.unit || "";
				const total_amount = it.total_amount ?? null;
				if (!date || amount === null || !Number.isFinite(amount)) return null;
				return { date, amount, unit, total_amount };
			}).filter(Boolean);

			this.renderList();
			this.show();
		} catch (err) {
			console.error("Ошибка загрузки расшифровки по работе:", err);
			showToast("Не удалось загрузить расшифровку по работе.", "error");
		}
	}

	show() {
		if (!this.elements.dailyModal) return;
		this.elements.dailyModal.classList.add("visible");
		this.elements.dailyModal.setAttribute("aria-hidden", "false");
	}

	close() {
		if (!this.elements.dailyModal) return;
		this.elements.dailyModal.classList.remove("visible");
		this.elements.dailyModal.setAttribute("aria-hidden", "true");
	}

	renderList() {
		if (!this.elements.dailyModalList || !this.elements.dailyModalEmpty) return;

		const monthLabel = this.getSelectedMonthLabel() || "выбранный месяц";
		if (this.elements.dailyModalSubtitle && this.dailyModalMode === "average") {
			this.elements.dailyModalSubtitle.textContent = `По дням за ${monthLabel.toLowerCase()}`;
		}

		this.elements.dailyModalList.innerHTML = "";
		const sorted = [...this.dailyRevenue].sort((a, b) => new Date(a.date) - new Date(b.date));

		if (!sorted.length) {
			this.elements.dailyModalEmpty.style.display = "block";
			this.elements.dailyModalList.style.display = "none";
			return;
		}

		this.elements.dailyModalEmpty.style.display = "none";
		this.elements.dailyModalList.style.display = "grid";

		const isWorkMode = this.dailyModalMode === "work"
			|| sorted.some((it) => it.unit || (it.total_amount !== null && it.total_amount !== undefined));

		const header = document.createElement("div");
		header.className = "modal-row modal-row-header";
		if (isWorkMode) {
			header.innerHTML = `
					<div class="modal-row-date">Дата</div>
					<div class="modal-row-value"><span class="modal-value-number">Объем</span></div>
					<div class="modal-row-sum">Сумма,₽</div>
				`;
		} else {
			header.innerHTML = `
					<div class="modal-row-date">Дата</div>
					<div class="modal-row-sum">Сумма, ₽</div>
				`;
		}
		this.elements.dailyModalList.appendChild(header);

		const fragment = document.createDocumentFragment();
		sorted.forEach((item) => {
			const row = document.createElement("div");
			row.className = "modal-row";
			const isMobile = typeof window !== "undefined" && window.matchMedia
				? window.matchMedia("(max-width: 767px)").matches
				: false;
			const dateLabel = isMobile
				? formatDate(item.date, { day: "2-digit", month: "2-digit" })
				: formatDate(item.date);

			if (isWorkMode) {
				const amount = Number(item.amount);
				const formattedAmount = Number.isFinite(amount) ? amount.toFixed(1) : "–";
				const unit = item.unit || "";
				const totalAmount = Number(item.total_amount);
				const formattedTotal = Number.isFinite(totalAmount)
					? totalAmount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
					: "–";
				row.innerHTML = `
					<div class="modal-row-date">${dateLabel}</div>
					<div class="modal-row-value">
						<span class="modal-value-number">${formattedAmount}</span>
						${unit ? `<span class="modal-value-unit">(${unit})</span>` : ""}
					</div>
					<div class="modal-row-sum">${formattedTotal}</div>
				`;
			} else {
				const sumAmount = Number(item.amount);
				const formattedSum = Number.isFinite(sumAmount)
					? sumAmount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
					: "–";
				row.innerHTML = `
					<div class="modal-row-date">${dateLabel}</div>
					<div class="modal-row-sum">${formattedSum}</div>
				`;
			}
			fragment.appendChild(row);
		});

		this.elements.dailyModalList.appendChild(fragment);
	}
}
