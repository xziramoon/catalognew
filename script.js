// --- ฟังก์ชัน Debounce (หน่วงเวลา) ---
function debounce(func, delay = 300) {
    let timerId;
    return function (...args) {
        clearTimeout(timerId);
        timerId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}
const debouncedSearch = debounce(resetAndRender, 300);

// --- 1. STATE MANAGEMENT ---
let STATE = {
    items: JSON.parse(localStorage.getItem('ww_items')) || [],
    categories: JSON.parse(localStorage.getItem('ww_cats')) || ['ทั่วไป'],
    favoriteIds: JSON.parse(localStorage.getItem('ww_favs')) || [],
    config: { name: "Nexus System", url: "", imgbb: "" },

    isBulkMode: false,
    selectedIds: [],
    currentFilter: 'ทั้งหมด',
    displayLimit: 20,
    editingId: null
};

// โหลด Config
try {
    const secureConfig = localStorage.getItem('ww_config_secure');
    if (secureConfig) {
        STATE.config = JSON.parse(atob(secureConfig));
    } else {
        const oldConfig = localStorage.getItem('ww_config');
        if (oldConfig) {
            STATE.config = JSON.parse(oldConfig);
            saveSettings();
        }
    }
} catch(e) { console.error("Config Loading Error", e); }

// --- 2. SECURITY HELPER ---
function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/[&<>'"]/g, match => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[match]));
}

// --- 2b. LOCAL PLACEHOLDER IMAGES ---
// via.placeholder.com is unreliable/offline, which used to make items look like
// "broken images" (ปัญหารูปมองเห็นไม่ชัด). Generate crisp placeholders locally instead,
// so they always render regardless of network/third-party status.
function makePlaceholder(label, fg = "94a3b8", bg = "1e293b") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#${bg}"/><text x="50%" y="50%" font-family="Prompt, sans-serif" font-size="26" fill="#${fg}" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}
const IMG_PLACEHOLDER = makePlaceholder('NO IMAGE');
const IMG_ERROR = makePlaceholder('LOAD ERROR', 'fca5a5', '3a1518');

// Old items can end up with a dead image URL (e.g. a free ImgBB-hosted photo that got
// deleted/expired externally) with no way to recover except editing manually. Turn the
// broken state into a one-tap fix instead of a dead end.
function handleImageError(imgEl, itemId) {
    imgEl.onerror = null;
    imgEl.src = IMG_ERROR;
    const wrap = imgEl.closest('.card-img-wrap');
    if (wrap && !wrap.querySelector('.img-broken-hint')) {
        const hint = document.createElement('div');
        hint.className = 'img-broken-hint';
        hint.innerHTML = '<i class="ri-refresh-line"></i> รูปเสีย แตะเพื่ออัปโหลดใหม่';
        hint.onclick = (e) => { e.stopPropagation(); editItem(itemId); };
        wrap.appendChild(hint);
    }
}

// --- 2c. DRAFT AUTO-SAVE ---
// Fixes "ถ้าลืมอัพโหลด แล้วงานหายไปเลย": typed data in the add/edit form used to
// vanish completely if the modal closed unexpectedly (accidental close, tab crash,
// phone lock) before pressing save. Now every keystroke is auto-saved to a draft
// in localStorage and restored automatically next time the same form is opened.
const DRAFT_KEY = 'ww_draft';

function getDraftFields() {
    return {
        editingId: STATE.editingId,
        name: document.getElementById('nName').value,
        code: document.getElementById('nCode').value,
        cat: document.getElementById('nCatSelect').value,
        catNew: document.getElementById('nCatInput').value
    };
}

function persistDraft() {
    const d = getDraftFields();
    if (d.name || d.code || d.catNew) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
        showDraftIndicator();
    }
}
const autoSaveDraft = debounce(persistDraft, 400);

function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    hideDraftIndicator();
}

function showDraftIndicator() {
    const el = document.getElementById('draftIndicator');
    if (el) el.classList.add('show');
}
function hideDraftIndicator() {
    const el = document.getElementById('draftIndicator');
    if (el) el.classList.remove('show');
}

function attachDraftAutoSave() {
    ['nName', 'nCode', 'nCatSelect', 'nCatInput'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', autoSaveDraft);
        el.addEventListener('change', autoSaveDraft);
    });
}

function restoreDraftIfExists(forEditingId) {
    hideDraftIndicator();
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (String(d.editingId) !== String(forEditingId)) return;
        if (!d.name && !d.code && !d.catNew) return;

        document.getElementById('nName').value = d.name || '';
        document.getElementById('nCode').value = d.code || '';
        if (d.cat === 'NEW' && d.catNew) {
            document.getElementById('nCatSelect').value = 'NEW';
            document.getElementById('nCatInput').style.display = 'block';
            document.getElementById('nCatInput').value = d.catNew;
        } else if (d.cat) {
            document.getElementById('nCatSelect').value = d.cat;
        }
        showDraftIndicator();
        showToast("📝 กู้คืนข้อมูลที่พิมพ์ค้างไว้ล่าสุดให้แล้ว");
    } catch(e) { console.error("Draft Restore Error", e); }
}

// --- 3. INITIALIZATION ---
init();

function init() {
    document.getElementById('shopName').value = STATE.config.name;
    document.getElementById('brandName').innerText = escapeHTML(STATE.config.name);
    document.getElementById('scriptUrl').value = STATE.config.url || "";
    document.getElementById('imgbbKey').value = STATE.config.imgbb || "";

    updateCategoriesUI();
    attachDraftAutoSave();
    render();

    if(STATE.items.length === 0 && STATE.config.url) pullFromCloud(false);

    window.addEventListener('scroll', () => {
        document.getElementById('btnTop').style.display = window.scrollY > 400 ? 'flex' : 'none';
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 200) {
            loadMore();
        }
    });
}

// --- 4. RENDER ENGINE ---
function resetAndRender() {
    STATE.displayLimit = 20;
    render();
}

function getFilteredItems() {
    const term = document.getElementById('search').value.toLowerCase().trim();
    return STATE.items.filter(i => {
        const matchCat = (STATE.currentFilter === 'ทั้งหมด' || i.cat === STATE.currentFilter);
        const matchSearch = (i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term));
        return matchCat && matchSearch;
    }).sort((a,b) => b.id - a.id);
}

function buildCard(item) {
    const isSelected = STATE.selectedIds.includes(item.id);
    const isFav = STATE.favoriteIds.includes(String(item.id));
    let img = IMG_PLACEHOLDER;
    if (item.img && item.img.length > 5) img = escapeHTML(item.img);

    const safeName = escapeHTML(item.name);
    const safeCode = escapeHTML(item.code);

    const cardEl = document.createElement('div');
    cardEl.className = `card glass-panel ${isSelected ? 'selected' : ''}`;
    cardEl.setAttribute('role', 'button');
    cardEl.setAttribute('tabindex', '0');
    cardEl.onclick = () => handleCardClick(item.id, safeCode);

    cardEl.innerHTML = `
        <div class="card-select-overlay" style="display: ${STATE.isBulkMode ? 'block' : 'none'}">
            <div class="check-box"><i class="ri-check-line"></i></div>
        </div>
        <div class="card-img-wrap">
            <img src="${img}" class="card-img" alt="${safeName}" loading="lazy" referrerpolicy="no-referrer"
                 onerror="handleImageError(this, ${item.id})">
            <div class="card-actions-top" style="display: ${STATE.isBulkMode ? 'none' : 'flex'}">
                <div class="btn-icon-mini" onclick="event.stopPropagation(); editItem(${item.id})"><i class="ri-pencil-line"></i></div>
                <div class="btn-icon-mini" onclick="event.stopPropagation(); toggleFav('${item.id}')">
                    <i class="${isFav ? 'ri-star-fill' : 'ri-star-line'}" style="${isFav ? 'color:#f59e0b' : ''}"></i>
                </div>
            </div>
        </div>
        <div class="card-body">
            <div class="card-name">${safeName}</div>
            <div class="card-code"><i class="ri-barcode-box-line"></i> ${safeCode}</div>
            <button class="btn-action-outline" style="display: ${STATE.isBulkMode ? 'none' : 'block'}">
                <i class="ri-file-copy-line"></i> คัดลอก
            </button>
        </div>
    `;
    return cardEl;
}

function render() {
    const grid = document.getElementById('grid');

    const filtered = getFilteredItems();

    const toDisplay = filtered.slice(0, STATE.displayLimit);
    document.getElementById('itemStatus').innerText = `SYSTEM: แสดง ${toDisplay.length} จาก ${filtered.length} รายการ`;

    grid.innerHTML = '';

    if(toDisplay.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--text-sub); padding:50px 0;"><i class="ri-database-2-line" style="font-size:2rem; opacity:0.5; display:block; margin-bottom:10px;"></i>ไม่พบข้อมูลในระบบ</div>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    toDisplay.forEach(item => fragment.appendChild(buildCard(item)));
    grid.appendChild(fragment);
}

function appendItems(newItems) {
    const grid = document.getElementById('grid');
    const fragment = document.createDocumentFragment();
    newItems.forEach(item => fragment.appendChild(buildCard(item)));
    grid.appendChild(fragment);

    const filtered = getFilteredItems();
    const shown = Math.min(STATE.displayLimit, filtered.length);
    document.getElementById('itemStatus').innerText = `SYSTEM: แสดง ${shown} จาก ${filtered.length} รายการ`;
}

function loadMore() {
    const filtered = getFilteredItems();

    if (STATE.displayLimit < filtered.length) {
        document.getElementById('scrollLoader').style.display = 'block';
        setTimeout(() => {
            const oldLimit = STATE.displayLimit;
            const newLimit = oldLimit + 20;
            const newItems = filtered.slice(oldLimit, newLimit);
            appendItems(newItems);
            STATE.displayLimit = Math.min(newLimit, filtered.length);
            document.getElementById('scrollLoader').style.display = 'none';
        }, 200);
    }
}

// --- 5. BULK ACTIONS ---
function enterBulkMode() { STATE.isBulkMode = true; STATE.selectedIds = []; document.getElementById('bulkBar').style.display = 'flex'; document.getElementById('searchContainer').style.display = 'none'; render(); }
function exitBulkMode() { STATE.isBulkMode = false; STATE.selectedIds = []; document.getElementById('bulkBar').style.display = 'none'; document.getElementById('searchContainer').style.display = ''; render(); }

function handleCardClick(id, code) {
    if (STATE.isBulkMode) {
        if (STATE.selectedIds.includes(id)) STATE.selectedIds = STATE.selectedIds.filter(x => x !== id);
        else STATE.selectedIds.push(id);
        document.getElementById('bulkCount').innerText = `เลือก ${STATE.selectedIds.length} รายการ`;
        render();
    } else {
        copy(code);
    }
}

function bulkDelete() {
    if (STATE.selectedIds.length === 0) return;
    if (confirm(`ลบข้อมูล ${STATE.selectedIds.length} รายการ ออกจากระบบ?`)) {
        STATE.items = STATE.items.filter(i => !STATE.selectedIds.includes(i.id));
        saveLocal(); pushToCloud(false); exitBulkMode(); showToast("ลบข้อมูลสำเร็จ");
    }
}

function bulkMove() {
    if (STATE.selectedIds.length === 0) return;
    const sel = document.getElementById('bulkCatSelect');
    sel.innerHTML = STATE.categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    openModal('modalMove');
}

function confirmBulkMove() {
    const newCat = document.getElementById('bulkCatSelect').value;
    STATE.items.forEach(i => { if (STATE.selectedIds.includes(i.id)) i.cat = newCat; });
    saveLocal(); pushToCloud(false); closeModal('modalMove'); exitBulkMode(); showToast(`ย้ายไปหมวด ${newCat} สำเร็จ`);
}

// --- 6. IMAGE PROCESSING ---
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("File Read Error"));
        reader.readAsDataURL(file);
        reader.onload = e => {
            const img = new Image();
            img.onerror = () => reject(new Error("Image Decode Error"));
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                // Higher resolution + quality than before (was 800px / 0.7) so
                // product photos stay sharp instead of looking blurry/compressed.
                const maxWidth = 1000;
                let scale = 1;
                if (img.width > maxWidth) scale = maxWidth / img.width;
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            }
        }
    });
}

async function uploadToImgBB(base64Str) {
    if(!STATE.config.imgbb) throw new Error("API Key Missing");
    const base64Data = base64Str.split(',')[1];
    const formData = new FormData();
    formData.append("image", base64Data);

    const res = await fetch(`https://api.imgbb.com/1/upload?key=${STATE.config.imgbb}`, { method: "POST", body: formData });
    const data = await res.json();
    if(data.success) return data.data.url;
    else throw new Error("Upload Failed");
}

// --- 7. CRUD & MODALS ---
async function saveItem() {
    const name = document.getElementById('nName').value.trim();
    const code = document.getElementById('nCode').value.trim();
    const catSelect = document.getElementById('nCatSelect');
    const catInput = document.getElementById('nCatInput');
    let cat = catSelect.value === 'NEW' ? catInput.value.trim() : catSelect.value;

    if(!name || !code) return showToast("กรอกข้อมูลไม่ครบถ้วน");

    const isDuplicate = STATE.items.some(i => i.code.toLowerCase() === code.toLowerCase() && i.id !== STATE.editingId);
    if(isDuplicate) {
        showToast("⚠️ รหัสสินค้านี้ซ้ำกับที่มีอยู่ในระบบแล้ว");
        return;
    }

    const saveBtn = document.getElementById('btnSaveItem');
    saveBtn.disabled = true; saveBtn.innerText = 'กำลังบันทึก...';

    if(catSelect.value === 'NEW' && cat && !STATE.categories.includes(cat)) {
        STATE.categories.push(cat); updateCategoriesUI();
    }

    const file = document.getElementById('nFile').files[0];
    if (file && file.size > 15 * 1024 * 1024) {
        showToast("⚠️ ไฟล์รูปใหญ่เกินไป (สูงสุด 15MB)");
        saveBtn.disabled = false; saveBtn.innerText = 'บันทึกข้อมูลเข้าสู่ระบบ';
        return;
    }
    let imgUrl = "";

    if(STATE.editingId) { const old = STATE.items.find(i => i.id == STATE.editingId); imgUrl = old.img || ""; }

    if(file) {
        document.getElementById('loader').style.display='flex';
        try {
            document.getElementById('loaderText').innerText = "กำลังประมวลผลรูปภาพ...";
            const compressedBase64 = await compressImage(file);
            // Always keep a local copy as the working image first. Previously, if the
            // ImgBB upload failed (missing key, offline, quota), the whole save was
            // aborted and every field the user typed (name/code/category) was lost.
            // Now the item is always saved; the cloud upload is a best-effort upgrade.
            imgUrl = compressedBase64;

            if (STATE.config.imgbb) {
                try {
                    document.getElementById('loaderText').innerText = "กำลังอัปโหลดขึ้น Cloud...";
                    imgUrl = await uploadToImgBB(compressedBase64);
                } catch (uploadErr) {
                    showToast("⚠️ อัปโหลดรูปขึ้น Cloud ไม่สำเร็จ บันทึกข้อมูลด้วยรูปในเครื่องแทน");
                }
            } else {
                showToast("💡 ยังไม่ได้ตั้งค่า Cloud รูปภาพ (ImgBB) รูปนี้จะถูกเก็บในเครื่องนี้เท่านั้น");
            }
        } catch(e) {
            showToast("⚠️ ประมวลผลรูปภาพไม่สำเร็จ: " + e.message);
            document.getElementById('loader').style.display='none';
            saveBtn.disabled = false; saveBtn.innerText = 'บันทึกข้อมูลเข้าสู่ระบบ';
            return;
        }
    }

    const newItem = { id: STATE.editingId || Date.now(), name, code, cat, img: imgUrl };
    if(STATE.editingId) { const idx = STATE.items.findIndex(i => i.id == STATE.editingId); STATE.items[idx] = newItem; }
    else { STATE.items.push(newItem); }

    saveLocal(); resetAndRender(); pushToCloud(false);
    clearDraft();
    document.getElementById('loader').style.display='none';
    saveBtn.disabled = false; saveBtn.innerText = 'บันทึกข้อมูลเข้าสู่ระบบ';
    closeModal('modalAdd'); showToast("อัปเดตระบบเรียบร้อย");
}

function editItem(id) {
    if(STATE.isBulkMode) return;
    const i = STATE.items.find(x => x.id == id);
    if(!i) return;
    STATE.editingId = id;
    document.getElementById('modalAddTitle').innerText = "แก้ไขข้อมูล";
    document.getElementById('nName').value = i.name;
    document.getElementById('nCode').value = i.code;
    document.getElementById('nFile').value = "";
    renderCatDropdown(i.cat);
    restoreDraftIfExists(id);
    openModal('modalAdd');
}

function delItem(id) {
    if(confirm("ยืนยันการลบข้อมูล?")) {
        STATE.items = STATE.items.filter(i => i.id != id);
        saveLocal(); resetAndRender(); pushToCloud(false); showToast("ลบข้อมูลสำเร็จ");
    }
}

function deleteFromModal() { if(STATE.editingId) { delItem(STATE.editingId); closeModal('modalAdd'); } }
function openModalAdd() {
    STATE.editingId = null;
    document.getElementById('modalAddTitle').innerText = "เพิ่มข้อมูลใหม่";
    document.getElementById('nName').value = "";
    document.getElementById('nCode').value = "";
    document.getElementById('nFile').value = "";
    renderCatDropdown(STATE.currentFilter === 'ทั้งหมด' ? '' : STATE.currentFilter);
    restoreDraftIfExists(null);
    openModal('modalAdd');
}

// --- 8. CLOUD SYNC ---
async function pushToCloud(manual=false) {
    if (!STATE.config.url) return;
    if(manual) document.getElementById('cloudLoader').style.display='flex';
    try {
        await fetch(STATE.config.url + "?action=save", { method: "POST", body: JSON.stringify({ items: STATE.items, categories: STATE.categories }) });
        if(manual) { showToast("Sync Complete ✅"); closeModal('modalCloud'); }
    } catch(e) { if(manual) showToast("Connection Error"); } finally { document.getElementById('cloudLoader').style.display='none'; }
}

async function pullFromCloud(manual=false) {
    if (!STATE.config.url) return;
    if(manual) document.getElementById('cloudLoader').style.display='flex';
    try {
        const res = await fetch(STATE.config.url + "?action=load");
        const data = await res.json();
        if(data && data.items) {
            if(manual) { STATE.items = data.items; STATE.categories = data.categories || STATE.categories; }
            else { data.items.forEach(cItem => { const idx = STATE.items.findIndex(l => String(l.id) == String(cItem.id)); if(idx === -1) STATE.items.push(cItem); }); }
            saveLocal(); updateCategoriesUI(); resetAndRender();
            if(manual) { showToast("Data Loaded ✅"); closeModal('modalCloud'); }
        }
    } catch(e) { if(manual) showToast("Download Error"); } finally { document.getElementById('cloudLoader').style.display='none'; }
}
function openCloudMenu() { if(!STATE.config.url) return showToast("API URL Required"); openModal('modalCloud'); }

// --- 9. UI & SETTINGS ---
function saveLocal() {
    try {
        localStorage.setItem('ww_items', JSON.stringify(STATE.items));
        localStorage.setItem('ww_cats', JSON.stringify(STATE.categories));
        localStorage.setItem('ww_favs', JSON.stringify(STATE.favoriteIds));
    } catch(e) {
        // Storage quota exceeded (can happen once local-fallback images pile up).
        // Surface it instead of silently losing data.
        showToast("⚠️ พื้นที่จัดเก็บในเครื่องเต็ม ข้อมูลอาจไม่ถูกบันทึกครบถ้วน");
        console.error("Storage Error", e);
    }
}

function saveSettings() {
    STATE.config.name = document.getElementById('shopName').value.trim();
    STATE.config.url = document.getElementById('scriptUrl').value.trim();
    STATE.config.imgbb = document.getElementById('imgbbKey').value.trim();

    localStorage.setItem('ww_config_secure', btoa(JSON.stringify(STATE.config)));
    localStorage.removeItem('ww_config');

    document.getElementById('brandName').innerText = escapeHTML(STATE.config.name);
    closeModal('modalSettings'); showToast("บันทึกการตั้งค่าสำเร็จ");
}

function updateCategoriesUI() {
    const container = document.getElementById('catFilters');

    let html = `<div class="chip ${STATE.currentFilter==='ทั้งหมด'?'active':''}" role="button" tabindex="0" onclick="setFilter('ทั้งหมด', this)">ทั้งหมด</div>`;
    const topCats = STATE.categories.slice(0, 4);
    topCats.forEach(c => {
        html += `<div class="chip ${STATE.currentFilter===c?'active':''}" role="button" tabindex="0" onclick="setFilter('${escapeHTML(c)}', this)">${escapeHTML(c)}</div>`;
    });
    if (STATE.categories.length > 4) {
        html += `<div class="chip" role="button" tabindex="0" style="background:var(--primary); color:white; border:none; display:flex; align-items:center; gap:5px;" onclick="openModal('modalAllCats')"><i class="ri-menu-search-line"></i> เพิ่มเติม</div>`;
    }
    container.innerHTML = html;

    document.getElementById('catManageList').innerHTML = STATE.categories.map((c,i) => `
        <div style="background:rgba(255,255,255,0.05); border:1px solid var(--border-light); padding:5px 10px; margin:3px; border-radius:10px; font-size:0.9rem;">
            ${escapeHTML(c)} <span onclick="delCat(${i})" style="color:var(--accent-red); cursor:pointer; margin-left:5px;">x</span>
        </div>`).join('');

    document.getElementById('allCatsList').innerHTML = STATE.categories.map(c => `
        <div class="cat-list-item" onclick="setFilterFromModal('${escapeHTML(c)}')">
            <span style="font-weight: ${STATE.currentFilter === c ? '600' : '400'}; color: ${STATE.currentFilter === c ? 'var(--primary)' : 'inherit'};">${escapeHTML(c)}</span>
            ${STATE.currentFilter === c ? '<i class="ri-check-line" style="color:var(--primary);"></i>' : '<i class="ri-arrow-right-s-line" style="color:var(--text-sub);"></i>'}
        </div>`).join('');
}

function setFilter(c, el) {
    STATE.currentFilter = c;
    document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
    if(el) el.classList.add('active');
    updateCategoriesUI();
    resetAndRender();
}

function setFilterFromModal(c) {
    setFilter(c, null);
    closeModal('modalAllCats');
}

function renderCatDropdown(sel="") {
    let h = STATE.categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`);
    h.push(`<option value="NEW">+ เพิ่มหมวดใหม่...</option>`);
    document.getElementById('nCatSelect').innerHTML = h.join('');
    if(sel) document.getElementById('nCatSelect').value = sel;
}

function checkNewCat(el) { document.getElementById('nCatInput').style.display = el.value === 'NEW' ? 'block' : 'none'; }
function delCat(i) {
    const catName = STATE.categories[i];
    const affected = STATE.items.filter(it => it.cat === catName).length;
    const msg = affected > 0
        ? `หมวดหมู่ "${catName}" มีสินค้าอยู่ ${affected} รายการ หากลบ สินค้าเหล่านี้จะถูกย้ายไปหมวด "ทั่วไป" อัตโนมัติ ยืนยันการลบ?`
        : `ลบหมวดหมู่ "${catName}"?`;
    if (confirm(msg)) {
        if (affected > 0) {
            if (!STATE.categories.includes('ทั่วไป')) STATE.categories.push('ทั่วไป');
            STATE.items.forEach(it => { if (it.cat === catName) it.cat = 'ทั่วไป'; });
        }
        STATE.categories.splice(i, 1);
        saveLocal(); updateCategoriesUI(); resetAndRender();
        if (STATE.currentFilter === catName) setFilter('ทั้งหมด', null);
    }
}
function openSettings() { document.getElementById('shopName').value = STATE.config.name; document.getElementById('scriptUrl').value = STATE.config.url; document.getElementById('imgbbKey').value = STATE.config.imgbb; openModal('modalSettings'); }

function openFavModal() {
    const l = document.getElementById('favList');
    const list = STATE.items.filter(i => STATE.favoriteIds.includes(String(i.id)));
    l.innerHTML = list.length ? list.map(i => `
        <div style="padding:15px; border-bottom:1px solid var(--border-light); cursor:pointer; display:flex; justify-content:space-between; transition:0.2s;" onclick="copy('${escapeHTML(i.code)}')">
            <div style="color:var(--text-main);">${escapeHTML(i.name)}</div>
            <div style="color:var(--primary); font-family:monospace; background:rgba(14,165,233,0.1); padding:2px 8px; border-radius:6px;">${escapeHTML(i.code)}</div>
        </div>`).join('') : '<div style="text-align:center; padding:30px; color:var(--text-sub);"><i class="ri-star-line" style="font-size:2rem; display:block; margin-bottom:10px;"></i> ไม่มีรายการโปรด</div>';
    openModal('modalFav');
}

function toggleFav(id) { const s = String(id); if(STATE.favoriteIds.includes(s)) STATE.favoriteIds = STATE.favoriteIds.filter(x => x !== s); else STATE.favoriteIds.push(s); saveLocal(); render(); }
function copy(text) { navigator.clipboard.writeText(text).then(() => showToast("คัดลอก: " + text)).catch(()=>showToast("คัดลอกไม่ได้")); }
function showToast(m) { const t=document.getElementById('toast'); t.innerText=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); }
function openModal(id) { document.getElementById(id).style.display='flex'; }
function closeModal(id) { document.getElementById(id).style.display='none'; }

// --- 10. ACCESSIBILITY: keyboard activation for role="button" elements ---
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) {
        e.preventDefault();
        e.target.click();
    }
});
