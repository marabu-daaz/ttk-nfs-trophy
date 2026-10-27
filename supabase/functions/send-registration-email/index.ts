// ============================================================
//  NFS Trophy  Edge Function  send-registration-email  (v2)
//
//  1) Database-Webhook (registrations INSERT):
//     - Bestaetigung an den Spieler (jetzt mit Abmeldelink)
//     - Benachrichtigung an die Turnierleitung
//     Nur mit Service-Role-Schluessel aufrufbar (wie der Webhook).
//
//  2) { action: "cancel", token, bewerbe? }      (oeffentlich, Abmeldeseite)
//     - meldet ab (ganz oder einzelne Bewerbe)
//     - Bestaetigung an den Spieler, Info an die Turnierleitung
//       inkl. naechstem Nachruecker auf der Warteliste
//
//  3) { action: "resend_link", email }           (oeffentlich)
//     - schickt die Abmeldelinks erneut an genau diese Adresse
//     - hoechstens alle 10 Minuten, Antwort verraet nicht,
//       ob es die Adresse gibt
//
//  Secrets: RESEND_API_KEY, optional ADMIN_EMAIL, SITE_URL.
//  SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.
// ============================================================

const FROM = "NFS Trophy <nennung@nfs-trophy.com>";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "christianritter1310@gmail.com";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://nfs-trophy.com").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)
  );

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const cancelUrl = (token: string) => `${SITE_URL}/abmelden?t=${encodeURIComponent(token)}`;

async function sendMail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Resend Fehler (${res.status}) an ${to}: ${body}`);
  } else {
    console.log(`Mail an ${to} angenommen: ${body}`);
  }
  return res.ok;
}

// ---------- Datenbank (PostgREST mit Service-Schluessel) ----------
async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const asList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string" && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return v.split(",").map((s) => s.trim()).filter(Boolean); }
  }
  return [];
};

// ---------- Wer ruft auf? ----------
function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

/** Webhook-Aufrufe kommen mit dem Service-Role-Schluessel (Signatur prueft Supabase per "Verify JWT"). */
function isServiceCall(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return !!token && (token === SERVICE_KEY || jwtRole(token) === "service_role");
}

// ---------- Mail-Bausteine ----------
const wrap = (inner: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;color:#0d2818;max-width:520px;">${inner}
     <p style="margin-top:24px;color:#1a4d2e;font-weight:bold;">TTK Naturfreunde Stadlau</p></div>`;

const cancelBox = (token: string) => `
  <p style="margin-top:20px;padding:12px 14px;background:#f3f6f2;border-radius:6px;font-size:13px;color:#3d5445;">
    Du kannst doch nicht? Dann melde dich bitte hier ab – so rückt jemand von der Warteliste nach:<br>
    <a href="${esc(cancelUrl(token))}" style="color:#1a4d2e;font-weight:bold;">Nennung verwalten / abmelden</a>
  </p>`;

// ============================================================
// 1) Neue Nennung (Webhook)
// ============================================================
async function handleNewRegistration(r: Record<string, any>) {
  if (!r || !r.email) {
    console.log("Keine E-Mail-Adresse – keine Mail an den Spieler", r?.id);
    return json({ ok: false, reason: "no email" });
  }

  const name = `${r.vorname ?? ""} ${r.nachname ?? ""}`.trim();
  const bewerbeArr = asList(r.bewerbe_list).length ? asList(r.bewerbe_list) : (r.bewerb ? [r.bewerb] : []);
  const bewerbe = bewerbeArr.map(esc).join(", ") || "keine Angabe";

  const waitlistBewerbe = asList(r.waitlist_bewerbe);
  const aufWarteliste = waitlistBewerbe.length > 0 || r.waitlist === true;
  const aktivBewerbe = bewerbeArr.filter((b: string) => !waitlistBewerbe.includes(b));
  const wlText = waitlistBewerbe.map(esc).join(", ");
  const aktivText = aktivBewerbe.map(esc).join(", ");

  const playerHtml = wrap(`
    <h2 style="color:#1a4d2e;margin:0 0 16px;">${aufWarteliste ? "Nennung NFS Trophy eingegangen" : "Nennung NFS Trophy bestätigt"}</h2>
    <p>Hallo ${esc(r.vorname)},</p>
    <p>wir haben deine Nennung erhalten. Hier deine Angaben:</p>
    <table style="border-collapse:collapse;font-size:14px;margin:12px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Name</td><td>${esc(name)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Verein</td><td>${esc(r.verein) || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">RC-Punkte</td><td>${esc(r.rc) || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Bewerbe</td><td>${bewerbe}</td></tr>
    </table>
    ${waitlistBewerbe.length
      ? `<p style="background:#fff4d6;padding:10px 14px;">
           Für ${wlText} stehst du auf der <strong>Warteliste</strong> und rückst bei freien Plätzen nach.${
             aktivBewerbe.length ? ` Für ${aktivText} bist du regulär gemeldet.` : ""
           }</p>`
      : ""}
    <p>Bei Fragen einfach auf diese Mail antworten oder
       ${esc(ADMIN_EMAIL)} kontaktieren.</p>
    ${r.cancel_token ? cancelBox(r.cancel_token) : ""}`);

  const adminHtml = wrap(`
    <h2 style="color:#1a4d2e;margin:0 0 16px;">Neue Nennung${aufWarteliste ? " (Warteliste)" : ""}</h2>
    <table style="border-collapse:collapse;font-size:14px;margin:12px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Name</td><td>${esc(name)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">E-Mail</td><td>${esc(r.email)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Telefon</td><td>${esc(r.telefon) || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Verein</td><td>${esc(r.verein) || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">RC-Punkte</td><td>${esc(r.rc) || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Bewerbe</td><td>${bewerbe}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Warteliste</td><td>${waitlistBewerbe.length ? wlText : "nein"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">Anmerkung</td><td>${esc(r.notiz) || "-"}</td></tr>
    </table>`);

  let playerSubject;
  if (waitlistBewerbe.length && aktivBewerbe.length) playerSubject = "NFS Trophy: Teils Warteliste, teils bestätigt";
  else if (waitlistBewerbe.length) playerSubject = "NFS Trophy: Du stehst auf der Warteliste";
  else playerSubject = "Nennung NFS Trophy bestätigt";

  const results = await Promise.all([
    sendMail(r.email, playerSubject, playerHtml),
    sendMail(ADMIN_EMAIL, `Neue Nennung: ${name}${waitlistBewerbe.length ? " (Warteliste: " + waitlistBewerbe.join(", ") + ")" : ""}`, adminHtml),
  ]);
  return json({ ok: true, player: results[0], admin: results[1] });
}

// ============================================================
// 2) Abmelden
// ============================================================
async function handleCancel(token: string, bewerbe: string[] | null) {
  if (!/^[0-9a-f-]{36}$/i.test(token || "")) return json({ ok: false, reason: "not_found" });

  const res = await db("rpc/cancel_registration", {
    method: "POST",
    body: JSON.stringify({ p_token: token, p_bewerbe: bewerbe && bewerbe.length ? bewerbe : null }),
  });
  if (!res?.ok) return json(res || { ok: false });

  const name = `${res.vorname ?? ""} ${res.nachname ?? ""}`.trim();
  const removed: string[] = res.removed || [];
  const remaining: string[] = res.remaining || [];
  const freed: string[] = res.freed || [];

  // Naechste Nachruecker fuer frei gewordene Startplaetze
  let nextUp: { bewerb: string; name: string; email: string }[] = [];
  if (freed.length) {
    const regs = await db(`registrations?tournament_id=eq.${encodeURIComponent(res.tournament_id)}&select=vorname,nachname,email,bewerbe_list,bewerb,waitlist_bewerbe,waitlist,created_at&order=created_at.asc`);
    nextUp = freed.map((b) => {
      const n = (regs || []).find((x: any) => {
        const list = asList(x.bewerbe_list).length ? asList(x.bewerbe_list) : [x.bewerb];
        const wl = asList(x.waitlist_bewerbe).length ? asList(x.waitlist_bewerbe) : (x.waitlist ? list : []);
        return list.includes(b) && wl.includes(b);
      });
      return n ? { bewerb: b, name: `${n.vorname} ${n.nachname}`, email: n.email || "" } : null;
    }).filter(Boolean) as any;
  }

  const tasks: Promise<boolean>[] = [];
  if (res.email) {
    tasks.push(sendMail(res.email, "NFS Trophy: Abmeldung bestätigt", wrap(`
      <h2 style="color:#1a4d2e;margin:0 0 16px;">Abmeldung bestätigt</h2>
      <p>Hallo ${esc(res.vorname)},</p>
      <p>${res.deleted
        ? `deine Nennung (${removed.map(esc).join(", ")}) ist storniert.`
        : `du bist von <strong>${removed.map(esc).join(", ")}</strong> abgemeldet. Weiterhin gemeldet: ${remaining.map(esc).join(", ")}.`}</p>
      <p>Danke, dass du Bescheid gegeben hast – so kann jemand von der Warteliste nachrücken.</p>`)));
  }
  tasks.push(sendMail(ADMIN_EMAIL, `Abmeldung: ${name} (${removed.join(", ")})`, wrap(`
    <h2 style="color:#1a4d2e;margin:0 0 16px;">Selbst-Abmeldung</h2>
    <p><strong>${esc(name)}</strong> hat sich ${res.deleted ? "komplett" : "teilweise"} abgemeldet.</p>
    <table style="border-collapse:collapse;font-size:14px;margin:12px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Abgemeldet</td><td>${removed.map(esc).join(", ")}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Weiterhin</td><td>${remaining.map(esc).join(", ") || "–"}</td></tr>
    </table>
    ${nextUp.length
      ? `<p style="background:#e8f5ec;padding:10px 14px;">Platz frei – nächste auf der Warteliste:<br>${
          nextUp.map((n) => `<strong>${esc(n.bewerb)}:</strong> ${esc(n.name)}${n.email ? ` (${esc(n.email)})` : ""}`).join("<br>")}<br>
          Nachrücken im Admin unter „Bewerbe“.</p>`
      : freed.length ? `<p>Platz frei in ${freed.map(esc).join(", ")} – niemand auf der Warteliste.</p>` : ""}`)));
  await Promise.all(tasks);

  return json({ ok: true, deleted: res.deleted, removed, remaining });
}

// ============================================================
// 3) Abmeldelink erneut zusenden
// ============================================================
async function handleResendLink(emailRaw: string) {
  const email = String(emailRaw || "").trim().toLowerCase();
  // Immer gleiche Antwort – verraet nicht, ob die Adresse genannt ist
  const neutral = json({ ok: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return neutral;

  const [t] = await db("tournaments?select=id,name,date_text&order=date_iso.desc&limit=1") || [];
  if (!t) return neutral;

  const pattern = email.replace(/[%_\\]/g, (c) => "\\" + c);
  const regs = (await db(`registrations?tournament_id=eq.${encodeURIComponent(t.id)}&email=ilike.${encodeURIComponent(pattern)}&select=id,email,vorname,nachname,bewerbe_list,bewerb,cancel_token,link_sent_at`) || [])
    .filter((r: any) => String(r.email || "").trim().toLowerCase() === email);
  if (!regs.length) return neutral;

  const recent = regs.some((r: any) => r.link_sent_at && Date.now() - new Date(r.link_sent_at).getTime() < RESEND_COOLDOWN_MS);
  if (recent) return neutral;

  await db(`registrations?id=in.(${regs.map((r: any) => encodeURIComponent(r.id)).join(",")})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ link_sent_at: new Date().toISOString() }),
  });

  const rows = regs.map((r: any) => {
    const list = asList(r.bewerbe_list).length ? asList(r.bewerbe_list) : [r.bewerb];
    return `<li style="margin-bottom:8px;"><strong>${esc(r.vorname)} ${esc(r.nachname)}</strong> – ${list.map(esc).join(", ")}<br>
      <a href="${esc(cancelUrl(r.cancel_token))}" style="color:#1a4d2e;font-weight:bold;">Nennung verwalten / abmelden</a></li>`;
  }).join("");

  await sendMail(email, `${t.name}: Dein Link zur Nennung`, wrap(`
    <h2 style="color:#1a4d2e;margin:0 0 16px;">Dein Link zur Nennung</h2>
    <p>Für diese E-Mail-Adresse ${regs.length === 1 ? "ist folgende Nennung" : "sind folgende Nennungen"} für die ${esc(t.name)}${t.date_text ? ` (${esc(t.date_text)})` : ""} gespeichert:</p>
    <ul style="padding-left:18px;">${rows}</ul>
    <p style="color:#6b7f70;font-size:13px;">Du hast diesen Link nicht angefordert? Dann kannst du diese Mail einfach ignorieren.</p>`));

  return neutral;
}

// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const payload = await req.json().catch(() => ({}));

    if (payload?.action === "cancel") return await handleCancel(payload.token, payload.bewerbe ?? null);
    if (payload?.action === "resend_link") return await handleResendLink(payload.email);

    // Ab hier: nur der Database-Webhook (Service-Role) darf Bestaetigungen ausloesen
    if (!isServiceCall(req)) {
      console.warn("Abgelehnt: Bestaetigungsmail ohne Service-Role angefordert");
      return json({ ok: false, reason: "forbidden" }, 403);
    }
    // Webhook liefert { type, table, record }
    return await handleNewRegistration(payload.record ?? payload);
  } catch (err) {
    console.error("Function-Fehler:", err);
    return json({ ok: false, error: "server_error" }, 200);
  }
});
