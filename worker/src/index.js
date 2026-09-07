const ALLOWED_ORIGINS = new Set([
  "https://heyneeff.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const KEY = "layout";
const HISTORY_PREFIX = "history:";
const HISTORY_INDEX_KEY = "history:index";
const MAX_HISTORY = 20;
const MAX_BODY_BYTES = 512 * 1024;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://heyneeff.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Edit-Password",
    "Vary": "Origin",
  };
}

// Snapshots whatever is currently stored under KEY into a timestamped
// history entry before it gets overwritten, keeping only the most recent
// MAX_HISTORY versions. A save from a stale/cached device (the actual
// cause of a real data loss: an icon fix pushed from a browser tab whose
// cached layout predated some stage schedules, silently wiping them) can
// then be rolled back via POST /restore instead of being unrecoverable.
async function snapshotCurrent(env) {
  const current = await env.MAP_KV.get(KEY);
  if (!current) return;
  const ts = new Date().toISOString();
  await env.MAP_KV.put(HISTORY_PREFIX + ts, current);
  const idxRaw = await env.MAP_KV.get(HISTORY_INDEX_KEY);
  let idx = idxRaw ? JSON.parse(idxRaw) : [];
  idx.push(ts);
  while (idx.length > MAX_HISTORY) {
    const old = idx.shift();
    await env.MAP_KV.delete(HISTORY_PREFIX + old);
  }
  await env.MAP_KV.put(HISTORY_INDEX_KEY, JSON.stringify(idx));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/layout" && request.method === "GET") {
      const value = await env.MAP_KV.get(KEY);
      return new Response(value || "null", {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (url.pathname === "/layout" && request.method === "POST") {
      const password = request.headers.get("X-Edit-Password") || "";
      if (!env.EDIT_PASSWORD || password !== env.EDIT_PASSWORD) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return new Response(JSON.stringify({ error: "Payload too large" }), {
          status: 413,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      await snapshotCurrent(env);
      await env.MAP_KV.put(KEY, JSON.stringify(parsed));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Lists available backup timestamps (newest last), so you can find
    // which version to restore.
    if (url.pathname === "/history" && request.method === "GET") {
      const idxRaw = await env.MAP_KV.get(HISTORY_INDEX_KEY);
      const idx = idxRaw ? JSON.parse(idxRaw) : [];
      return new Response(JSON.stringify(idx), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Fetches one backed-up version's full JSON, e.g.
    // /history/2026-09-07T12:34:56.789Z
    if (url.pathname.startsWith("/history/") && request.method === "GET") {
      const ts = decodeURIComponent(url.pathname.slice("/history/".length));
      const value = await env.MAP_KV.get(HISTORY_PREFIX + ts);
      if (!value) return new Response("Not found", { status: 404, headers: cors });
      return new Response(value, {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Restores a backed-up version as the live layout. Requires the edit
    // password, same as saving; the version being replaced is itself
    // snapshotted first so a bad restore can be undone too.
    if (url.pathname === "/restore" && request.method === "POST") {
      const password = request.headers.get("X-Edit-Password") || "";
      if (!env.EDIT_PASSWORD || password !== env.EDIT_PASSWORD) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      let body;
      try {
        body = JSON.parse(await request.text());
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const ts = body && body.ts;
      if (!ts) {
        return new Response(JSON.stringify({ error: "Missing ts" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const value = await env.MAP_KV.get(HISTORY_PREFIX + ts);
      if (!value) {
        return new Response(JSON.stringify({ error: "No such backup" }), {
          status: 404,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      await snapshotCurrent(env);
      await env.MAP_KV.put(KEY, value);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers: cors });
  },
};
