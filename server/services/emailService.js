/**
 * Email sharing via Gmail SMTP (Nodemailer).
 * Provides transport creation and professional HTML email builder.
 */
const nodemailer = require("nodemailer");
const { EMAIL_USER, EMAIL_PASS } = require("../config/env");

let _emailTransport = null;

function getEmailTransport() {
  if (_emailTransport) return _emailTransport;
  if (!EMAIL_USER || !EMAIL_PASS) return null;
  _emailTransport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
  return _emailTransport;
}

function buildEmailHtml({
  province,
  pollutant,
  columns,
  rows,
  totalRows,
  filters,
  generatedAt,
}) {
  const STATUS_COLORS = {
    Good: "#34d399",
    Fair: "#fbbf24",
    "Unhealthy for Sensitive Groups": "#fb923c",
    "Very Unhealthy": "#f87171",
    "Acutely Unhealthy": "#a78bfa",
    Emergency: "#fb7185",
  };

  const filterSummary = [];
  if (filters?.dateRange && filters.dateRange[0]) {
    filterSummary.push(
      `Date: ${filters.dateRange[0]} to ${filters.dateRange[1]}`,
    );
  }
  if (filters?.statuses?.length) {
    filterSummary.push(`Status: ${filters.statuses.join(", ")}`);
  }
  if (
    filters?.aqiRange &&
    (filters.aqiRange[0] > 0 || filters.aqiRange[1] < 500)
  ) {
    filterSummary.push(
      `AQI Range: ${filters.aqiRange[0]}–${filters.aqiRange[1]}`,
    );
  }

  const displayRows = rows.slice(0, 100);
  const visibleCols = columns.filter(
    (c) => !(/aqi/i.test(c) && (/category/i.test(c) || /µg/i.test(c))),
  );

  const tableHeader = visibleCols
    .map(
      (c) =>
        `<th style="padding:8px 12px;text-align:left;background:#f0f5ff;border-bottom:2px solid #1677ff;font-size:12px;color:#1e3a5f;white-space:nowrap;">${c}</th>`,
    )
    .join("");

  const tableRows = displayRows
    .map((row, idx) => {
      const bgColor = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
      const cells = visibleCols
        .map((c) => {
          let val = row[c] == null ? "" : String(row[c]);
          let style = `padding:6px 12px;font-size:12px;border-bottom:1px solid #e8e8e8;`;
          if (c === "Status" && val) {
            const color = STATUS_COLORS[val] || "#888";
            style += `color:${color};font-weight:600;`;
          }
          if (c === "AQI" && val) {
            style += "font-weight:600;";
          }
          if (c.toLowerCase().includes("rolling average") && val) {
            const n = parseFloat(val);
            if (isFinite(n)) val = n.toFixed(2);
          }
          return `<td style="${style}">${val}</td>`;
        })
        .join("");
      return `<tr style="background:${bgColor};">${cells}</tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f2f5;padding:24px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="700" style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1677ff 0%,#4096ff 100%);padding:28px 32px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">
                    EMB Region III — Air Quality Report
                  </h1>
                  <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">
                    Environmental Management Bureau — Central Luzon
                  </p>
                </td>
                <td align="right" style="vertical-align:top;">
                  <div style="background:rgba(255,255,255,0.2);border-radius:8px;padding:8px 14px;display:inline-block;">
                    <span style="color:#fff;font-size:11px;font-weight:600;">AUTOMATED REPORT</span>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Report info -->
        <tr>
          <td style="padding:24px 32px 16px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding:12px 16px;background:#f0f5ff;border-radius:8px;border-left:4px solid #1677ff;">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="50%">
                        <p style="margin:0 0 4px;font-size:11px;color:#8c8c8c;text-transform:uppercase;letter-spacing:0.5px;">Station</p>
                        <p style="margin:0;font-size:15px;font-weight:600;color:#1e3a5f;">${province}</p>
                      </td>
                      <td width="25%">
                        <p style="margin:0 0 4px;font-size:11px;color:#8c8c8c;text-transform:uppercase;letter-spacing:0.5px;">Pollutant</p>
                        <p style="margin:0;font-size:15px;font-weight:600;color:#1e3a5f;">${pollutant}</p>
                      </td>
                      <td width="25%">
                        <p style="margin:0 0 4px;font-size:11px;color:#8c8c8c;text-transform:uppercase;letter-spacing:0.5px;">Records</p>
                        <p style="margin:0;font-size:15px;font-weight:600;color:#1e3a5f;">${totalRows.toLocaleString()}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            ${
              filterSummary.length
                ? `
            <div style="margin-top:12px;padding:10px 14px;background:#fffbe6;border-radius:6px;border:1px solid #ffe58f;">
              <p style="margin:0;font-size:11px;color:#8c6d1f;font-weight:600;">APPLIED FILTERS</p>
              <p style="margin:4px 0 0;font-size:12px;color:#614700;">${filterSummary.join(" · ")}</p>
            </div>`
                : ""
            }
            <p style="margin:12px 0 0;font-size:11px;color:#8c8c8c;">
              Generated: ${generatedAt} · Showing ${Math.min(displayRows.length, 100)} of ${totalRows.toLocaleString()} records${totalRows > 100 ? " (first 100 included in email)" : ""}
            </p>
          </td>
        </tr>

        <!-- Data table -->
        <tr>
          <td style="padding:0 32px 24px;">
            <div style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                <thead><tr>${tableHeader}</tr></thead>
                <tbody>${tableRows}</tbody>
              </table>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa;padding:20px 32px;border-top:1px solid #e8e8e8;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <p style="margin:0;font-size:12px;font-weight:600;color:#1e3a5f;">
                    EMB Region 3 — Air Quality Monitoring System
                  </p>
                  <p style="margin:4px 0 0;font-size:11px;color:#8c8c8c;">
                    Masinop cor. Matalino St., Diosdado Macapagal Government Center, Maimpis, San Fernando, Pampanga
                  </p>
                  <p style="margin:4px 0 0;font-size:11px;color:#8c8c8c;">
                    📞 (045) 963-3623 · 📧 emb_region3@emb.gov.ph · 🌐 r3.emb.gov.ph
                  </p>
                </td>
                <td align="right" style="vertical-align:top;">
                  <p style="margin:0;font-size:10px;color:#bfbfbf;">
                    This is an automated email from the<br>EMBR3 AQI Monitoring System.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = {
  getEmailTransport,
  buildEmailHtml,
  EMAIL_USER,
};
