/** QR code + printable "ورقة المصعد" poster. The qrcode library is loaded only when needed. */

export async function makeQrDataUrl(url: string): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(url, {
    width: 720,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0F766E', light: '#FFFFFF' },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Opens a print-ready A4 poster in a new window. Returns false when pop-ups are blocked. */
export function printElevatorPoster(buildingName: string, publicUrl: string, qrDataUrl: string): boolean {
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(buildingName)} — ورقة المصعد</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap" rel="stylesheet">
    <style>
      @page { size: A4 portrait; margin: 12mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: Cairo, system-ui, sans-serif; text-align: center; color: #1E293B; margin: 0; padding: 24px; }
      .box { border: 5px solid #0F766E; border-radius: 32px; padding: 36px 28px; max-width: 640px; margin: 0 auto; page-break-inside: avoid; }
      .brand { display: inline-block; background: #0F766E; color: #fff; font-weight: 800; border-radius: 999px; padding: 6px 22px; font-size: 22px; }
      h1 { font-size: 42px; font-weight: 800; margin: 18px 0 4px; line-height: 1.3; }
      img { width: 380px; height: 380px; margin: 18px auto; display: block; }
      .step { font-size: 26px; font-weight: 800; margin: 8px 0; }
      .sub { font-size: 20px; color: #475569; margin: 6px 0; }
      .url { direction: ltr; font-size: 18px; color: #475569; margin-top: 18px; word-break: break-all; }
      @media print { .noprint { display: none; } body { padding: 0; } }
    </style></head><body><div class="box">
    <span class="brand">صندوق البناء 🏢</span>
    <h1>${esc(buildingName)}</h1>
    <img src="${qrDataUrl}" alt="QR">
    <p class="step">📱 امسح الكود بكاميرا التلفون</p>
    <p class="sub">مين دفع · المصاريف والفواتير · أرقام الطوارئ</p>
    <p class="sub">بدون تسجيل وبدون كلمة سر</p>
    <p class="url">${esc(publicUrl)}</p>
    </div><p class="noprint" style="margin-top:16px;color:#475569">إذا ما طلعت نافذة الطباعة: اضغط Ctrl+P</p>
    <script>window.onload=function(){setTimeout(function(){window.print()},500)}</script></body></html>`);
  w.document.close();
  return true;
}
