export async function readJsonResponse(res, context = "API request") {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    return res.json();
  }

  const text = await res.text().catch(() => "");
  const trimmed = text.trim();
  const isHtml = /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
  if (isHtml) {
    throw new Error(
      `${context} returned HTML instead of JSON. Check the VPS proxy for /air-quality-monitoring/api/.`
    );
  }

  throw new Error(
    `${context} returned ${contentType || "a non-JSON response"} instead of JSON.`
  );
}

export async function responseToError(res, context = "API request") {
  const contentType = res.headers.get("content-type") || "";
  const status = `HTTP ${res.status}`;

  if (contentType.toLowerCase().includes("application/json")) {
    try {
      const json = await res.json();
      return new Error(json?.error || json?.message || `${context} failed: ${status}`);
    } catch {
      return new Error(`${context} failed: ${status}`);
    }
  }

  const text = await res.text().catch(() => "");
  const trimmed = text.trim();
  const isHtml = /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
  if (isHtml) {
    return new Error(
      `${context} failed: ${status}. The server returned HTML instead of JSON; check the VPS proxy for /air-quality-monitoring/api/.`
    );
  }

  return new Error(trimmed || `${context} failed: ${status}`);
}
