// @ts-nocheck
// Pi coding-agent extension: emit OSC 7501 Program Status Protocol.
// Install: pi install git:github.com/p3psi-boo/pi-osc7501
// Spec: https://www.superlogical.com/rex/docs/build/program-status

import fs from "node:fs";

const APP = "pi";
const ESC = "\x1b";
const ST = `${ESC}\\`;

function enabled() {
  return process.env.OSC7501 !== "0";
}

/** Strip control chars (U+0000–U+001F, U+007F, U+0080–U+009F); take one line. */
function sanitizeText(text) {
  if (typeof text !== "string" || !text) return "";
  let s = text.replace(/[\x00-\x1F\x7F\u0080-\u009F]/g, " ").replace(/\s+/g, " ").trim();
  const nl = s.indexOf("\n");
  if (nl >= 0) s = s.slice(0, nl).trim();
  return s;
}

function b64(text) {
  const clean = sanitizeText(text);
  if (!clean) return "";
  return Buffer.from(clean, "utf8").toString("base64").replace(/\n/g, "");
}

/**
 * Build OSC 7501 report body pairs. Always includes app.
 * @param {{ state: string, kind?: string, msg?: string, progress?: number, id?: string, title?: string }} opts
 */
function formatPairs(opts) {
  const pairs = [`state=${opts.state}`, `app=${APP}`];
  if (opts.kind && opts.state === "blocked") pairs.push(`kind=${opts.kind}`);
  if (opts.msg) {
    const enc = b64(opts.msg);
    if (enc) pairs.push(`msg=${enc}`);
  }
  if (opts.title) {
    const enc = b64(opts.title);
    if (enc) pairs.push(`title=${enc}`);
  }
  if (
    typeof opts.progress === "number" &&
    opts.progress >= 0 &&
    opts.progress <= 100 &&
    (opts.state === "working" || opts.state === "blocked")
  ) {
    pairs.push(`progress=${Math.round(opts.progress)}`);
  }
  if (opts.id) pairs.push(`id=${opts.id}`);
  return pairs.join(":");
}

/** Full OSC sequence string (with ST terminator). */
function formatSequence(opts) {
  return `${ESC}]7501;${formatPairs(opts)}${ST}`;
}

function writeOsc(sequence) {
  try {
    if (process.stdout?.isTTY) {
      process.stdout.write(sequence);
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    const fd = fs.openSync("/dev/tty", "w");
    try {
      fs.writeSync(fd, sequence);
    } finally {
      fs.closeSync(fd);
    }
    return;
  } catch {
    /* ignore */
  }
  try {
    if (process.stderr) process.stderr.write(sequence);
  } catch {
    /* ignore */
  }
}

export function encodeMsg(text) {
  return b64(text);
}

export function buildSequence(opts) {
  return formatSequence(opts);
}

export default function (pi) {
  if (!enabled()) return;

  let rootSession = false;
  let agentActive = false;
  /** After settle → done; after session_start idle → idle. */
  let settledDone = false;
  let blockedCount = 0;
  let blockedMsg = undefined;
  let blockedKind = undefined;
  let lastKey = undefined;

  function desired() {
    if (blockedCount > 0) {
      return {
        state: "blocked",
        kind: blockedKind || "permission",
        msg: blockedMsg,
      };
    }
    if (agentActive) return { state: "working" };
    if (settledDone) return { state: "done" };
    return { state: "idle" };
  }

  function emit(force = false) {
    const next = desired();
    const key = `${next.state}|${next.kind || ""}|${next.msg || ""}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    writeOsc(formatSequence(next));
  }

  function onBlocked(data) {
    if (!rootSession) return;
    if (!data?.active) {
      blockedCount = Math.max(0, blockedCount - 1);
      if (blockedCount === 0) {
        blockedMsg = undefined;
        blockedKind = undefined;
      }
      emit();
      return;
    }
    blockedCount += 1;
    blockedMsg = data.label || data.msg;
    blockedKind = data.kind || "permission";
    emit();
  }

  pi.events.on("herdr:blocked", onBlocked);
  pi.events.on("osc7501:blocked", onBlocked);

  pi.on("session_start", (_event, ctx) => {
    if (ctx?.mode !== "tui") return;
    rootSession = true;
    agentActive = ctx?.isIdle?.() === false;
    settledDone = false;
    emit(true);
  });

  pi.on("agent_start", () => {
    if (!rootSession) return;
    agentActive = true;
    settledDone = false;
    emit();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!rootSession || ctx?.isIdle?.() !== true) return;
    agentActive = false;
    settledDone = true;
    emit();
  });

  pi.on("session_shutdown", () => {
    if (!rootSession) return;
    rootSession = false;
    agentActive = false;
    settledDone = false;
    blockedCount = 0;
    blockedMsg = undefined;
    blockedKind = undefined;
    // Prefer idle on shutdown so the terminal does not keep a stale working/blocked.
    lastKey = undefined;
    writeOsc(formatSequence({ state: "idle" }));
  });
}
