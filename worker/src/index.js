const ALLOWED_ORIGINS = new Set([
  "https://heyneeff.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const KEY = "layout";
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname !== "/layout") {
      return new Response("Not found", { status: 404, headers: cors });
    }

    if (request.method === "GET") {
      const value = await env.MAP_KV.get(KEY);
      return new Response(value || "null", {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (request.method === "POST") {
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

      await env.MAP_KV.put(KEY, JSON.stringify(parsed));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};
