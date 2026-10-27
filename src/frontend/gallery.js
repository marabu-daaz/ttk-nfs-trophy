// src/frontend/gallery.js

let galleries = {};
let lbList = [];
let lbIndex = 0;
let lastFocus = null;

const lb = document.getElementById("lightbox");
const lbImg = document.getElementById("lbImg");
const lbCount = document.getElementById("lbCount");
const lbCaption = document.getElementById("lbCaption");

export function initGallery() {
    if (!lb) return;

    document.getElementById("lbClose")?.addEventListener("click", closeLb);
    document.getElementById("lbNext")?.addEventListener("click", nextLb);
    document.getElementById("lbPrev")?.addEventListener("click", prevLb);

    lb.addEventListener("click", (e) => {
        if (e.target === lb) closeLb();
    });

    document.addEventListener("keydown", (e) => {
        if (!lb.classList.contains("open")) return;
        if (e.key === "Escape") closeLb();
        else if (e.key === "ArrowRight") nextLb();
        else if (e.key === "ArrowLeft") prevLb();
    });
}

export function setGalleries(data) {
    galleries = data;
}

export function openLightbox(galleryId, index) {
    lbList = galleries[galleryId] || [];
    if (!lbList.length) {
        return;
    }

    lbIndex = Math.min(index, lbList.length - 1);
    showLb();
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
    // Tastaturfokus in die Lightbox, beim Schließen zurück zum Vorschaubild
    lastFocus = document.activeElement;
    document.getElementById("lbClose")?.focus();
}

function showLb() {
    const item = lbList[lbIndex];

    // Unterstützt beide Formate: String oder Objekt
    if (typeof item === 'string') {
        lbImg.src = item;
        if (lbCaption) lbCaption.style.display = 'none';
    } else if (typeof item === 'object' && item.url) {
        lbImg.src = item.url;
        if (lbCaption && item.caption) {
            lbCaption.textContent = item.caption;
            lbCaption.style.display = 'block';
        } else if (lbCaption) {
            lbCaption.style.display = 'none';
        }
    }

    lbCount.textContent = `${lbIndex + 1} von ${lbList.length}`;
}

function closeLb() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    lbImg.removeAttribute("src");
    if (lbCaption) {
        lbCaption.textContent = '';
        lbCaption.style.display = 'none';
    }
    lastFocus?.focus?.();
    lastFocus = null;
}

function nextLb() {
    lbIndex = (lbIndex + 1) % lbList.length;
    showLb();
}

function prevLb() {
    lbIndex = (lbIndex - 1 + lbList.length) % lbList.length;
    showLb();
}