export async function downloadPdf({ apiPdfUrl, selectedMonthIso }) {
  const url = new URL(apiPdfUrl, window.location.origin);
  if (selectedMonthIso) {
    url.searchParams.set("month", selectedMonthIso);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки PDF: ${response.status}`);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = "otchet.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(blobUrl);
}
