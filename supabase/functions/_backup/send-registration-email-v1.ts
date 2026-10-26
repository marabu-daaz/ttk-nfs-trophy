// ============================================================
//  SICHERUNG – Version 1 (vor dem Umbau im Oktober 2026)
//  Nur für den Notfall: bei Problemen mit v2 diesen Inhalt im Dashboard
//  unter Edge Functions → send-registration-email → Code einfügen und deployen.
//  Achtung: v1 ist für jeden mit dem öffentlichen Schlüssel aufrufbar (siehe v2).
// ============================================================
//  NFS Trophy  Edge Function  send-registration-email
//  Verschickt bei jeder neuen Nennung zwei Mails:
//   1) Bestaetigung an den Spieler
//   2) Benachrichtigung an Christian (Admin)
//
//  Wird durch den Database-Webhook auf der Tabelle
//  registrations (Event INSERT) ausgeloest.
// ============================================================

// Verifizierte Resend-Absenderadresse (Domain nfs-trophy.com).
const FROM = "NFS Trophy <nennung@nfs-trophy.com>";

// Diese Werte kommen aus den Secrets (Schritt in der Anleitung):
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "christianritter1310@gmail.com";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)
  );

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

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Webhook liefert { record }, direkter Aufruf evtl. das Objekt selbst
    const r = payload.record ?? payload;

    if (!r || !r.email) {
      console.error("Keine Anmeldedaten im Payload", JSON.stringify(payload));
      return new Response(JSON.stringify({ ok: false, reason: "no record" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const name = `${r.vorname ?? ""} ${r.nachname ?? ""}`.trim();
    const bewerbeArr = Array.isArray(r.bewerbe_list) && r.bewerbe_list.length
      ? r.bewerbe_list
      : (r.bewerb ? [r.bewerb] : []);
    const bewerbe = bewerbeArr.map(esc).join(", ") || "keine Angabe";

    // Warteliste pro Bewerb
    const waitlistBewerbe = Array.isArray(r.waitlist_bewerbe) ? r.waitlist_bewerbe : [];
    const aufWarteliste = waitlistBewerbe.length > 0 || r.waitlist === true;
    // Bewerbe, die regulaer (nicht Warteliste) sind
    const aktivBewerbe = bewerbeArr.filter((b: string) => !waitlistBewerbe.includes(b));
    const wlText = waitlistBewerbe.map(esc).join(", ");
    const aktivText = aktivBewerbe.map(esc).join(", ");

    // ---- 1) Mail an den Spieler ----
    const playerHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0d2818;max-width:520px;">
        <h2 style="color:#1a4d2e;margin:0 0 16px;">${aufWarteliste ? "Nennung NFS Trophy eingegangen" : "Nennung NFS Trophy bestaetigt"}</h2>
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
           christianritter1310@gmail.com kontaktieren.</p>
        <p style="margin-top:24px;color:#1a4d2e;font-weight:bold;">TTK Naturfreunde Stadlau</p>
      </div>`;

    // ---- 2) Mail an Christian (Admin) ----
    const adminHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0d2818;max-width:520px;">
        <h2 style="color:#1a4d2e;margin:0 0 16px;">Neue Nennung${aufWarteliste ? " (Warteliste)" : ""}</h2>
        <table style="border-collapse:collapse;font-size:14px;margin:12px 0;">
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Name</td><td>${esc(name)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">E-Mail</td><td>${esc(r.email)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Telefon</td><td>${esc(r.telefon) || "-"}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Verein</td><td>${esc(r.verein) || "-"}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">RC-Punkte</td><td>${esc(r.rc) || "-"}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Bewerbe</td><td>${bewerbe}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Warteliste</td><td>${waitlistBewerbe.length ? esc(wlText) : "nein"}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">Anmerkung</td><td>${esc(r.notiz) || "-"}</td></tr>
        </table>
      </div>`;

    // Betreff fuer den Spieler je nach Wartelisten-Status
    let playerSubject;
    if (waitlistBewerbe.length && aktivBewerbe.length) {
      playerSubject = "NFS Trophy: Teils Warteliste, teils bestaetigt";
    } else if (waitlistBewerbe.length) {
      playerSubject = "NFS Trophy: Du stehst auf der Warteliste";
    } else {
      playerSubject = "Nennung NFS Trophy bestaetigt";
    }

    const results = await Promise.all([
      sendMail(r.email, playerSubject, playerHtml),
      sendMail(ADMIN_EMAIL, `Neue Nennung: ${name}${waitlistBewerbe.length ? " (Warteliste: " + wlText + ")" : ""}`, adminHtml),
    ]);

    return new Response(JSON.stringify({ ok: true, player: results[0], admin: results[1] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Function-Fehler:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
