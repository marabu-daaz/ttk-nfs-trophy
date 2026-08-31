// src/shared/supabase.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Hilfsfunktion: Public URL für Storage-Dateien
 */
export function getPublicUrl(bucket, path) {
    if (!path) return null;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Hilfsfunktion: Public URL für PDFs
 */
export function publicPdfUrl(path) {
    return getPublicUrl('pdfs', path);
}

/**
 * Hilfsfunktion: Public URL für Fotos
 */
export function publicFotoUrl(path) {
    return getPublicUrl('fotos', path);
}