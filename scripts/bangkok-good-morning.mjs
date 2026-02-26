#!/usr/bin/env node
/**
 * BangkokGoodMorning – daily WhatsApp greeter
 * Env overrides for testing:
 *   TEST_SEND=1           → actually send even outside normal window
 *   TZ_OVERRIDE=<tz>      → use this timezone instead of Asia/Bangkok
 *   SEND_HOUR=<h>         → override the required hour (default 8)
 *   SEND_MIN_FROM=<m>     → override window start minute (default 0)
 *   SEND_MIN_TO=<m>       → override window end minute (default 4)
 */

const BASE_URL = "http://127.0.0.1:8787";
const TO = "Sandra Kaufmann";
const TIMEZONE = process.env.TZ_OVERRIDE ?? "Asia/Bangkok";
const SEND_HOUR = parseInt(process.env.SEND_HOUR ?? "8", 10);
const WIN_FROM = parseInt(process.env.SEND_MIN_FROM ?? "0", 10);
const WIN_TO = parseInt(process.env.SEND_MIN_TO ?? "4", 10);
const TEST_SEND = process.env.TEST_SEND === "1";

// ── A) Current Bangkok time ───────────────────────────────────────────────────
const now = new Date();
const bkkParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).formatToParts(now);

const get = (type) => bkkParts.find((p) => p.type === type)?.value ?? "";
const dateBKK = `${get("year")}-${get("month")}-${get("day")}`;
const hourBKK = parseInt(get("hour"), 10);
const minBKK = parseInt(get("minute"), 10);

console.log(
  `[BangkokGoodMorning] BKK time: ${dateBKK} ${String(hourBKK).padStart(2, "0")}:${String(minBKK).padStart(2, "0")} | TEST_SEND=${TEST_SEND}`,
);

// ── B) Window check ──────────────────────────────────────────────────────────
const inWindow = hourBKK === SEND_HOUR && minBKK >= WIN_FROM && minBKK <= WIN_TO;
if (!inWindow) {
  if (TEST_SEND) {
    console.log(
      `[BangkokGoodMorning] ⚠️  Outside window (${SEND_HOUR}:${String(WIN_FROM).padStart(2, "0")}–${String(WIN_TO).padStart(2, "0")}), but TEST_SEND=1 → continuing.`,
    );
  } else {
    console.log(`[BangkokGoodMorning] Outside send window – nothing to do.`);
    process.exit(0);
  }
}

// ── C) Idempotency check ──────────────────────────────────────────────────────
let statusRes;
try {
  statusRes = await fetch(`${BASE_URL}/status`);
  statusRes = await statusRes.json();
} catch (e) {
  console.error(`[BangkokGoodMorning] Could not reach /status: ${e.message}`);
  process.exit(1);
}

if (statusRes.lastSentDateBKK === dateBKK) {
  console.log(`[BangkokGoodMorning] Already sent today (${dateBKK}) – nothing to do.`);
  process.exit(0);
}

// ── D) Generate 3 candidates, pick best ──────────────────────────────────────
// Vary based on day-of-year so it rotates automatically
const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
const useCoffee = dayOfYear % 10 < 3; // ~30% of days

const candidates = [
  `Guten Morgen, mein Schatz! ❤️ Ich hoffe, du hast wunderschön geschlafen. Ich liebe dich – hab einen tollen Tag!`,
  `Guten Morgen, meine Liebe! 😘 Ein Bussi von mir${useCoffee ? " – und hoffentlich steht ein guter Kaffee für dich bereit ☕" : ""}. Ich liebe dich!`,
  `Guten Morgen, Süße! ❤️ Ich denke an dich und wünsch dir einen wundervollen Tag${useCoffee ? " – am besten mit einer guten Tasse Kaffee ☕😊" : ""}.`,
];

// Pick by rotating through them
const best = candidates[dayOfYear % candidates.length];
console.log(`[BangkokGoodMorning] Chosen message: "${best.slice(0, 30)}…"`);

// ── E) POST /send with retries ────────────────────────────────────────────────
const body = JSON.stringify({ toName: TO, text: best, dryRun: false });
let attempt = 0;
let result = null;

while (attempt < 3) {
  attempt++;
  try {
    const res = await fetch(`${BASE_URL}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MorningBot-Token": process.env.MORNINGBOT_TOKEN ?? "",
      },
      body,
    });
    console.log(`[BangkokGoodMorning] Attempt ${attempt}: HTTP ${res.status}`);
    result = await res.json();
    console.log(`[BangkokGoodMorning] Response:`, result);
    if (!res.ok) {
      throw new Error(`Send failed (HTTP ${res.status}): ${JSON.stringify(result)}`);
    }
    if (result.mode === "dryRun") {
      throw new Error("Message was NOT sent (dryRun active on server)");
    }
    if (result.ok) {
      break;
    }
    console.warn(
      `[BangkokGoodMorning] Attempt ${attempt}: server returned ok:false – ${result.error}`,
    );
  } catch (e) {
    console.warn(`[BangkokGoodMorning] Attempt ${attempt}: network error – ${e.message}`);
  }
  if (attempt < 3) {
    console.log(`[BangkokGoodMorning] Retrying in 20s…`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

// ── F) Result summary ─────────────────────────────────────────────────────────
if (result?.ok) {
  console.log(
    `✅ BangkokGoodMorning | dateBKK=${dateBKK} | msg="${best.slice(0, 30)}…" | id=${result.messageId} | ts=${result.ts}`,
  );
} else {
  const errMsg = result?.error ?? "unknown (no response)";
  console.error(
    `❌ BangkokGoodMorning | dateBKK=${dateBKK} | FAILED after ${attempt} attempts: ${errMsg}`,
  );
  process.exit(1);
}
