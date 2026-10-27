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
//  4) { action: "notify_promoted", registration_id, bewerb }   (nur Admins)
//     - Mail an den Nachruecker: Startplatz ist fix, inkl. Abmeldelink
//
//  5) { action: "send_reminder", text?, include_waitlist?, resend?, test? }  (nur Admins)
//     - persoenliche Erinnerung vor dem Turnier (Bewerbe, Startzeiten, Abmeldelink)
//     - eine Mail pro Adresse; merkt sich Versendete (reminder_sent_at),
//       damit man nach dem Tageslimit von Resend einfach fortsetzen kann
//     - test: nur eine Beispielmail an den angemeldeten Admin
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

/** Eingeloggter Admin? Prueft die Datenbank-Funktion is_admin() mit dem Token des Aufrufers. */
async function adminEmail(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || jwtRole(token) !== "authenticated") return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok || (await res.json()) !== true) return null;
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.email || null;
  } catch {
    return null;
  }
}

/** Mehrere Mails in einem Aufruf (max. 100). Liefert false, wenn Resend ablehnt (z.B. Tageslimit). */
async function sendBatch(mails: { to: string; subject: string; html: string }[]) {
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(mails.map((m) => ({ from: FROM, ...m }))),
  });
  const body = await res.text();
  if (!res.ok) console.error(`Resend Batch Fehler (${res.status}): ${body}`);
  return { ok: res.ok, status: res.status, body };
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
          <a href="${esc(SITE_URL)}/public/admin.html#/bewerbe" style="color:#1a4d2e;font-weight:bold;">Im Admin nachrücken lassen</a></p>`
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
// Gemeinsam fuer 4) und 5)
// ============================================================
async function activeTournament() {
  const [t] = await db("tournaments?select=id,name,date_text,bewerbe&order=date_iso.desc&limit=1") || [];
  return t || null;
}

/** Startzeit je Bewerb aus der Turnier-Konfiguration ({ name, time, ... } als JSON) */
function bewerbTimes(t: any): Record<string, string> {
  let list: any = t?.bewerbe;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
  return Object.fromEntries((Array.isArray(list) ? list : [])
    .filter((b: any) => b && typeof b === "object" && b.name)
    .map((b: any) => [b.name, String(b.time || "").trim()]));
}

function regLists(r: any) {
  const list = asList(r.bewerbe_list).length ? asList(r.bewerbe_list) : (r.bewerb ? [r.bewerb] : []);
  const wl = asList(r.waitlist_bewerbe).length ? asList(r.waitlist_bewerbe) : (r.waitlist ? list : []);
  return { active: list.filter((b) => !wl.includes(b)), waiting: list.filter((b) => wl.includes(b)) };
}

// ============================================================
// 4) Nachruecker benachrichtigen (Admin)
// ============================================================
async function handleNotifyPromoted(registrationId: string, bewerb: string) {
  if (!/^[0-9a-f-]{36}$/i.test(registrationId || "") || !bewerb) return json({ ok: false, reason: "bad_request" }, 400);
  const [r] = await db(`registrations?id=eq.${encodeURIComponent(registrationId)}&select=vorname,email,cancel_token,tournament_id`) || [];
  if (!r) return json({ ok: false, reason: "not_found" });
  if (!r.email) return json({ ok: false, reason: "no_email" });
  const [t] = await db(`tournaments?id=eq.${encodeURIComponent(r.tournament_id)}&select=name,date_text,bewerbe`) || [];
  const time = bewerbTimes(t)[bewerb];

  const ok = await sendMail(r.email, `${t?.name || "NFS Trophy"}: Du bist im Bewerb „${bewerb}“ nachgerückt`, wrap(`
    <h2 style="color:#1a4d2e;margin:0 0 16px;">Du bist nachgerückt!</h2>
    <p>Hallo ${esc(r.vorname)},</p>
    <p>gute Nachrichten: Im Bewerb <strong>${esc(bewerb)}</strong> ist ein Platz frei geworden und du bist von der
       Warteliste nachgerückt. Dein Startplatz bei der ${esc(t?.name || "NFS Trophy")}${t?.date_text ? ` (${esc(t.date_text)})` : ""} ist damit fix.</p>
    ${time ? `<p>Start des Bewerbs: <strong>${esc(time)}</strong></p>` : ""}
    <p>Bei Fragen einfach auf diese Mail antworten.</p>
    ${r.cancel_token ? cancelBox(r.cancel_token) : ""}`));
  return json({ ok });
}

// ============================================================
// 5) Erinnerung vor dem Turnier (Admin)
// ============================================================
const BATCH = 50;

async function handleReminder(opts: { text?: string; include_waitlist?: boolean; resend?: boolean; test?: boolean }, admin: string) {
  const t = await activeTournament();
  if (!t) return json({ ok: false, reason: "no_tournament" });
  const times = bewerbTimes(t);
  const regs = await db(`registrations?tournament_id=eq.${encodeURIComponent(t.id)}&select=id,vorname,nachname,email,bewerbe_list,bewerb,waitlist_bewerbe,waitlist,cancel_token,reminder_sent_at&order=created_at.asc`) || [];

  // Wer bekommt eine Erinnerung? Startplatz – oder auf Wunsch auch nur Warteliste
  const eligible = regs.filter((r: any) => {
    if (!String(r.email || "").includes("@")) return false;
    const { active, waiting } = regLists(r);
    return active.length > 0 || (opts.include_waitlist && waiting.length > 0);
  });

  // Eine Mail pro Adresse (z.B. Eltern, die ihre Kinder nennen)
  const groups = new Map<string, any[]>();
  for (const r of eligible) {
    const key = String(r.email).trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  let todo = [...groups.entries()];
  if (!opts.resend && !opts.test) todo = todo.filter(([, rs]) => rs.some((r) => !r.reminder_sent_at));

  const extra = String(opts.text || "").trim().slice(0, 3000);
  const build = (rs: any[]) => {
    const people = rs.map((r) => {
      const { active, waiting } = regLists(r);
      const lines = [
        ...active.map((b) => `<li><strong>${esc(b)}</strong>${times[b] ? ` – Start ${esc(times[b])}` : ""}</li>`),
        ...(opts.include_waitlist ? waiting.map((b) => `<li>${esc(b)} <span style="color:#966f08;">(Warteliste)</span></li>`) : []),
      ].join("");
      return `<p style="margin:14px 0 4px;"><strong>${esc(r.vorname)} ${esc(r.nachname)}</strong></p>
        <ul style="margin:0 0 6px;padding-left:18px;">${lines}</ul>
        ${r.cancel_token ? `<a href="${esc(cancelUrl(r.cancel_token))}" style="color:#1a4d2e;font-size:13px;">Kann doch nicht? Hier abmelden</a>` : ""}`;
    }).join("");
    const first = rs[0];
    return wrap(`
      <h2 style="color:#1a4d2e;margin:0 0 16px;">Bald geht's los: ${esc(t.name)}</h2>
      <p>Hallo ${esc(rs.length === 1 ? first.vorname : "zusammen")},</p>
      <p>eine kurze Erinnerung an die ${esc(t.name)}${t.date_text ? ` am ${esc(t.date_text)}` : ""}. ${rs.length === 1 ? "Du bist" : "Ihr seid"} für folgende Bewerbe gemeldet:</p>
      ${people}
      ${extra ? `<p style="margin-top:18px;">${esc(extra).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="margin-top:18px;">TTK Naturfreunde Stadlau, Erzherzog-Karl-Straße 108, 1220 Wien</p>
      <p style="margin-top:14px;padding:12px 14px;background:#f3f6f2;border-radius:6px;font-size:13px;color:#3d5445;">
        Falls du doch nicht kommen kannst, melde dich bitte über den Link oben ab – dann rückt jemand von der Warteliste nach.</p>`);
  };
  const subject = `${t.name}: Erinnerung${t.date_text ? ` – ${t.date_text}` : ""}`;

  if (opts.test) {
    if (!todo.length) return json({ ok: false, reason: "nobody" });
    const ok = await sendMail(admin, `[Test] ${subject}`, build(todo[0][1]));
    return json({ ok, test: true, to: admin, recipients: groups.size });
  }

  let sent = 0;
  let stopped: string | null = null;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (i) await new Promise((r) => setTimeout(r, 700)); // Resend: max. 2 Anfragen pro Sekunde
    const chunk = todo.slice(i, i + BATCH);
    const res = await sendBatch(chunk.map(([email, rs]) => ({ to: email, subject, html: build(rs) })));
    if (!res.ok) {
      stopped = res.status === 429 ? "limit" : "error";
      break;
    }
    const ids = chunk.flatMap(([, rs]) => rs.map((r) => r.id));
    await db(`registrations?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
    });
    sent += chunk.length;
  }
  return json({ ok: !stopped, sent, remaining: todo.length - sent, total: groups.size, stopped });
}

// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const payload = await req.json().catch(() => ({}));

    if (payload?.action === "cancel") return await handleCancel(payload.token, payload.bewerbe ?? null);
    if (payload?.action === "resend_link") return await handleResendLink(payload.email);

    // Admin-Aktionen: nur mit Login eines Admins aus der Admin-Liste
    if (payload?.action === "notify_promoted" || payload?.action === "send_reminder") {
      const admin = await adminEmail(req);
      if (!admin) return json({ ok: false, reason: "forbidden" }, 403);
      if (payload.action === "notify_promoted") return await handleNotifyPromoted(payload.registration_id, payload.bewerb);
      return await handleReminder(payload, admin);
    }

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
