// src/frontend/gallery.js

let galleries = {};
let lbList = [];
let lbIndex = 0;

const lb = document.getElementById("lightbox");
const lbImg = document.getElementById("lbImg");
const lbCount = document.getElementById("lbCount");
const lbCaption = document.getElementById("lbCaption");

// DEBUG: Prüfen ob Caption-Element existiert
console.log('lbCaption Element:', lbCaption);

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
    console.log('Galleries gesetzt:', galleries);  // DEBUG
}

export function openLightbox(galleryId, index) {
    lbList = galleries[galleryId] || [];
    console.log('Öffne Lightbox:', { galleryId, index, lbList });  // DEBUG

    if (!lbList.length) {
        console.warn('Keine Bilder für diese Galerie');
        return;
    }

    lbIndex = Math.min(index, lbList.length - 1);
    showLb();
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
}

function showLb() {
    const item = lbList[lbIndex];
    console.log('Zeige Bild:', item);  // DEBUG

    // Unterstützt beide Formate: String oder Objekt
    if (typeof item === 'string') {
        lbImg.src = item;
        if (lbCaption) lbCaption.style.display = 'none';
    } else if (typeof item === 'object' && item.url) {
        lbImg.src = item.url;
        if (lbCaption && item.caption) {
            lbCaption.textContent = item.caption;
            lbCaption.style.display = 'block';
            console.log('Caption gesetzt:', item.caption);  // DEBUG
        } else if (lbCaption) {
            lbCaption.style.display = 'none';
        }
    }

    lbCount.textContent = `${lbIndex + 1} von ${lbList.length}`;
}

function closeLb() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    lbImg.src = "";
    if (lbCaption) {
        lbCaption.textContent = '';
        lbCaption.style.display = 'none';
    }
}

function nextLb() {
    lbIndex = (lbIndex + 1) % lbList.length;
    showLb();
}

function prevLb() {
    lbIndex = (lbIndex - 1 + lbList.length) % lbList.length;
    showLb();
}