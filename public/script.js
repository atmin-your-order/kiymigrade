
if (typeof Swal !== 'undefined') {
    const _originalSwalFire = Swal.fire;
    Swal.fire = function(options) {
        if (typeof options === 'object') {
            options.heightAuto = false;
            options.scrollbarPadding = false;
        }
        return _originalSwalFire.apply(this, arguments);
    };
}
let currentUser = null; 
let selectedProduct = null;
let allProducts = [];
let availableDomainsList = [];
let currentCategory = 'panel'; 

let checkInterval = null;
let timerInterval = null;
let activeTransaction = null;
let lastNotifTime = null;
let otpStore = null; 
let adminPinAuth = "";
let tempNewProfilePic = null; 
let otpInterval = null;
let currentReviewProductId = null;
let currentRatingValue = 0;
let currentSubdomainProductId = null; // Helper untuk subdomain
let appliedPromoCode = null;;
let cropper;
let currentCropType = 'avatar'; // Bisa 'avatar' atau 'banner'
let finalCroppedImage = null;   // Hasil crop avatar
let finalBannerImage = null;    // Hasil crop banner

async function checkPromoCode() {
    // 1. Pastikan user sudah pilih produk di langkah sebelumnya
    if(!selectedProduct) return showIosNotification('error', 'Pilih Produk', 'Silakan pilih paket produk dulu!');

    const inputCode = document.getElementById('input-promo').value.toUpperCase();
    const btn = document.getElementById('btn-check-promo');
    const msg = document.getElementById('promo-message');
    
    // Reset Tampilan Harga
    const btnPay = document.getElementById('btn-pay');
    
    if(!inputCode) return showIosNotification('error', 'Gagal', 'Masukkan kode promo dulu.');
    
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        // Kirim data produk yang dipilih user ke backend untuk validasi kategori/ID
        const res = await fetch('/api/promo/check', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                code: inputCode,
                category: currentCategory,      // Kirim kategori aktif (panel/script/dll)
                productId: selectedProduct.id || currentSubdomainProductId // Kirim ID produk
            })
        });
        const json = await res.json();

        if(json.success) {
            appliedPromoCode = json.data;
            msg.style.display = 'block';
            msg.style.color = '#10b981';
            msg.innerHTML = `<i class="fas fa-check-circle"></i> Valid! Diskon <b>${appliedPromoCode.discount}%</b>`;
            
            // --- LOGIKA CORET HARGA (VISUAL) ---
            const originalPrice = selectedProduct.price;
            const discountAmount = Math.ceil(originalPrice * (appliedPromoCode.discount / 100));
            const finalPrice = originalPrice - discountAmount;

            // Tampilkan di Tombol Bayar dengan Format Coret
            btnPay.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; line-height:1.2;">
                    <span style="font-size:0.8rem; text-decoration: line-through; opacity:0.7;">Rp ${originalPrice.toLocaleString()}</span>
                    <span style="font-size:1.1rem; font-weight:bold;">BAYAR Rp ${finalPrice.toLocaleString()}</span>
                </div>
            `;
            
            showIosNotification('success', 'Promo Terpasang', `Hemat Rp ${discountAmount.toLocaleString()}`);
        } else {
            appliedPromoCode = null;
            msg.style.display = 'block';
            msg.style.color = '#ef4444';
            msg.innerHTML = `<i class="fas fa-times-circle"></i> ${json.message}`;
            
            // Kembalikan Tombol Normal
            btnPay.innerHTML = 'BAYAR SEKARANG';
        }
    } catch(e) {
        showIosNotification('error', 'Error', 'Gagal cek promo.');
        console.log(e);
    }
    btn.innerHTML = 'CEK';
    btn.disabled = false;
}

function startOtpTimer(duration, displayId, type) {
    let timer = duration, minutes, seconds;
    const display = document.getElementById(displayId);
    const btnVerifId = type === 'reg' ? 'btn-reg-verif' : 'btn-reset-verif';
    const optsId = type === 'reg' ? 'reg-timeout-opts' : 'reset-timeout-opts';
    if (otpInterval) clearInterval(otpInterval);
    document.getElementById(btnVerifId).style.display = 'block';
    document.getElementById(optsId).style.display = 'none';
    display.style.color = '#f59e0b';
    otpInterval = setInterval(function () {
        minutes = parseInt(timer / 60, 10);
        seconds = parseInt(timer % 60, 10);
        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;
        display.textContent = "Sisa Waktu: " + minutes + ":" + seconds;

        if (--timer < 0) {
            clearInterval(otpInterval);
            display.textContent = "Waktu Habis!";
            display.style.color = '#ef4444'; 
            document.getElementById(btnVerifId).style.display = 'none';
            document.getElementById(optsId).style.display = 'block';
            if(navigator.vibrate) navigator.vibrate(200);
        }
    }, 1000);
}

function timeAgo(dateParam) {
    const date = typeof dateParam === 'object' ? dateParam : new Date(dateParam);
    const today = new Date();
    const seconds = Math.round((today - date) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (seconds < 5) return 'Baru saja';
    else if (seconds < 60) return `${seconds} detik lalu`;
    else if (minutes < 60) return `${minutes} menit lalu`;
    else if (hours < 24) return `${hours} jam lalu`;
    else if (days < 7) return `${days} hari lalu`;
    return date.toLocaleDateString();
}

function formatWIB(dateString) {
    const options = { 
        timeZone: 'Asia/Jakarta', 
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    };
    return new Date(dateString).toLocaleString('id-ID', options) + ' WIB';
}

function showIosNotification(type, title, message) {
    const container = document.getElementById('ios-notif-container');
    
    // [PERBAIKAN UTAMA] Hapus notifikasi lama sebelum memunculkan yang baru
    // Ini bikin notif "diam di tempat" dan tidak spam ke bawah
    container.innerHTML = ''; 

    // --- Format Pesan Agar Rapi ---
    let cleanMsg = message.replace(/\*/g, '').replace(/_/g, '').replace(/```/g, '').replace(/\n/g, ' ');
    let shortMsg = cleanMsg.length > 60 ? cleanMsg.substring(0, 60) + '...' : cleanMsg;

    const notif = document.createElement('div');
    notif.className = 'ios-toast';
    
    // Tentukan Warna & Ikon
    let iconHtml = '';
    let color = '';
    
    if(type === 'success') { iconHtml = '<i class="fas fa-check"></i>'; color = '#10b981'; } 
    else if(type === 'error') { iconHtml = '<i class="fas fa-times"></i>'; color = '#ef4444'; } 
    else if(type === 'info') { iconHtml = '<i class="fas fa-info"></i>'; color = '#3b82f6'; } 
    else { iconHtml = '<i class="fas fa-bell"></i>'; color = '#f59e0b'; } 

    // Isi HTML Notifikasi
    notif.innerHTML = `
        <div class="ios-icon" style="background:${color}; color:white;">${iconHtml}</div>
        <div style="overflow:hidden;">
            <div style="font-weight:bold; font-size:0.9rem; margin-bottom:2px;">${title}</div>
            <div style="font-size:0.8rem; opacity:0.9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:250px;">
                ${shortMsg}
            </div>
        </div>
    `;

    // Event Klik untuk buka detail (Lonceng)
    notif.style.cursor = 'pointer';
    notif.onclick = function() {
        notif.remove();
        showNotifications(); 
    };

    container.appendChild(notif);
    
    // Efek Getar HP
    if(navigator.vibrate) navigator.vibrate(100);

    // Hapus otomatis setelah 4 detik
    setTimeout(() => {
        // Cek dulu apakah elemen masih ada (karena mungkin sudah dihapus notif baru)
        if(container.contains(notif)) {
            notif.classList.add('hiding');
            notif.addEventListener('animationend', () => notif.remove());
        }
    }, 4000);
}

// --- INIT & LOAD ---

window.onload = async () => {
    // 1. KUNCI SCROLL SAAT LOAD (PENTING!)
    document.body.classList.add('lock-scroll'); 
    
    // 2. Jalankan Animasi Loading Bar FF
    const barFill = document.getElementById('ff-fill');
    const txtPercent = document.getElementById('ff-percent');
    
    if(barFill) {
        // Delay dikit biar transisi CSS kebaca
        setTimeout(() => {
            barFill.style.width = '100%'; // Jalan sampai penuh
        }, 100);

        // Efek Angka Persen Jalan (0% -> 100%)
        let count = 0;
        const counter = setInterval(() => {
            count++;
            if(txtPercent) txtPercent.innerText = count + '%';
            if(count >= 100) clearInterval(counter);
        }, 30); // 30ms x 100 = 3 detik (sesuai durasi loading)
    }

    // --- (SISA KODE LAMA KAMU DI BAWAH INI TETAP SAMA) ---
    
    // 3. JALANKAN LOGIKA TAHUN BARU
    handleNewYearTheme();

    // 4. HITUNG PENGUNJUNG OTOMATIS
    try {
        const res = await fetch('/api/visitor/track', { method: 'POST' });
        const data = await res.json();
        if(document.getElementById('count-visitor')) {
            document.getElementById('count-visitor').innerText = data.total;
        }
    } catch(e) { console.log("Gagal track visitor"); }

    if(localStorage.getItem('theme') === 'light') toggleTheme(false);
    setupAutoFormatInput('reg-user');   
    setupAutoFormatInput('login-user'); 
    setupAutoFormatInput('username');   
    
    const savedUser = localStorage.getItem('riki_user_session');
    if(savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            updateUIForLogin();
        } catch(e) { localStorage.removeItem('riki_user_session'); }
    }

    try {
        await loadProducts(); 
        await updateStats();
        setInterval(updateStats, 10000); 
    } catch(e) {}

    const path = window.location.pathname;
    if(path.includes('/script')) {
        const scriptBtn = document.querySelectorAll('.service-item')[1]; 
        if(scriptBtn) switchCategory('script', scriptBtn);
    } else {
        const panelBtn = document.querySelectorAll('.service-item')[0];
        if(panelBtn) switchCategory('panel', panelBtn);
    }

    // 5. SELESAI LOADING -> BUKA KUNCI SCROLL
    setTimeout(() => {
        const overlay = document.getElementById('intro-overlay');
        if(overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
                
                // --- BUKA KUNCI SCROLL DISINI ---
                document.body.classList.remove('lock-scroll'); 
                // -------------------------------

                const savedTrx = localStorage.getItem('pending_trx');
                const savedExpiry = localStorage.getItem('trx_expiry');
                if(savedTrx && savedExpiry && new Date().getTime() < parseInt(savedExpiry)) {
                    activeTransaction = JSON.parse(savedTrx);
                    switchView('pay');
                    renderQR(activeTransaction.qr_string, activeTransaction.amount, activeTransaction.fee, activeTransaction.transaction_id, activeTransaction.item, false); 
                }
            }, 500); 
        }
    }, 2000);
};


function handleNewYearTheme() {
    const content = document.getElementById('intro-content');
    const effectContainer = document.getElementById('effect-container');
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const nextYear = currentYear + 1;

    // 1. DATABASE TANGGAL PASTI (Fixed Date)
    const fixedEventsPattern = [
        { name: "Tahun Baru Masehi", month: 1, day: 1, type: "newyear", msg: "Happy New Year {YEAR}! 🎆" },
        { name: "Hari Kanker Sedunia", month: 2, day: 4, type: "indo", msg: "World Cancer Day 🎗️" },
        { name: "Hari Pers Nasional", month: 2, day: 9, type: "indo", msg: "Selamat Hari Pers Nasional 📰" },
        { name: "Hari Valentine", month: 2, day: 14, type: "love", msg: "Happy Valentine's Day 💖" },
        { name: "Hari Perempuan Internasional", month: 3, day: 8, type: "love", msg: "Happy International Women's Day 👩" },
        { name: "Hari Musik Nasional", month: 3, day: 9, type: "party", msg: "Majulah Musik Indonesia 🎵" },
        { name: "Hari Kesehatan Sedunia", month: 4, day: 7, type: "indo", msg: "World Health Day 🏥" },
        { name: "Hari Kartini", month: 4, day: 21, type: "love", msg: "Habis Gelap Terbitlah Terang 💡" },
        { name: "Hari Bumi", month: 4, day: 22, type: "indo", msg: "Jaga Bumi Kita (Earth Day) 🌍" },
        { name: "Hari Buruh Internasional", month: 5, day: 1, type: "indo", msg: "Selamat Hari Buruh (May Day) 👷" },
        { name: "Hari Pendidikan Nasional", month: 5, day: 2, type: "indo", msg: "Majulah Pendidikan Indonesia 🎓" },
        { name: "Hari Kebangkitan Nasional", month: 5, day: 20, type: "indo", msg: "Bangkitlah Indonesiaku 🇮🇩" },
        { name: "Hari Lahir Pancasila", month: 6, day: 1, type: "indo", msg: "Saya Indonesia, Saya Pancasila 🇮🇩" },
        { name: "Hari Lingkungan Hidup", month: 6, day: 5, type: "indo", msg: "Lestarikan Alam (Environment Day) 🌱" },
        { name: "Hari Anak Nasional", month: 7, day: 23, type: "party", msg: "Selamat Hari Anak Nasional 🎈" },
        { name: "HUT ASEAN", month: 8, day: 8, type: "indo", msg: "Selamat Ulang Tahun ASEAN 🤝" },
        { name: "Hari Pramuka", month: 8, day: 14, type: "indo", msg: "Salam Pramuka! ⚜️" },
        { name: "Kemerdekaan RI", month: 8, day: 17, type: "indo", msg: "Dirgahayu RI ke-{AGE} 🇮🇩" },
        { name: "Hari Palang Merah Indonesia", month: 9, day: 17, type: "indo", msg: "Setetes Darah Untuk Kemanusiaan 🩸" },
        { name: "Hari Tani Nasional", month: 9, day: 24, type: "indo", msg: "Maju Terus Petani Indonesia 🌾" },
        { name: "Hari Kesaktian Pancasila", month: 10, day: 1, type: "indo", msg: "Pancasila Sakti 🦅" },
        { name: "Hari Batik Nasional", month: 10, day: 2, type: "indo", msg: "Bangga Pakai Batik 👕" },
        { name: "Hari TNI", month: 10, day: 5, type: "indo", msg: "Dirgahayu TNI 🛡️" },
        { name: "Hari Kesehatan Jiwa", month: 10, day: 10, type: "indo", msg: "Mental Health Matters 🧠" },
        { name: "Hari Sumpah Pemuda", month: 10, day: 28, type: "indo", msg: "Satu Nusa, Satu Bangsa ✊" },
        { name: "Halloween", month: 10, day: 31, type: "party", msg: "Happy Halloween! 🎃" },
        { name: "Hari Pahlawan", month: 11, day: 10, type: "indo", msg: "Jasmerah! Hormati Pahlawan 🥀" },
        { name: "Hari Ayah Nasional", month: 11, day: 12, type: "love", msg: "Terima Kasih Ayah Tercinta ❤️" },
        { name: "Hari Guru Nasional", month: 11, day: 25, type: "indo", msg: "Terima Kasih Guruku 📚" },
        { name: "Hari AIDS Sedunia", month: 12, day: 1, type: "indo", msg: "Jauhi Penyakitnya, Bukan Orangnya 🎗️" },
        { name: "Hari HAM Sedunia", month: 12, day: 10, type: "indo", msg: "Human Rights Day ⚖️" },
        { name: "Hari Ibu", month: 12, day: 22, type: "love", msg: "Selamat Hari Ibu ❤️" },
        { name: "Hari Natal", month: 12, day: 25, type: "newyear", msg: "Merry Christmas 🎄" }
    ];

    let events = [];

    // Generate event otomatis
    [currentYear, nextYear].forEach(y => {
        fixedEventsPattern.forEach(p => {
            let message = p.msg.replace("{YEAR}", y);
            if(p.name === 'Kemerdekaan RI') {
                const age = y - 1945;
                message = message.replace("{AGE}", age);
            }
            events.push({
                name: p.name,
                date: `${y}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
                type: p.type,
                msg: message
            });
        });
    });

    // 2. DATABASE TANGGAL BERUBAH (Manual Update)
    const variableEvents = [
        { name: "Tahun Baru Imlek", date: "2025-01-29", type: "party", msg: "Gong Xi Fa Cai 🧧" },
        { name: "Isra Mi'raj", date: "2025-01-27", type: "islamic", msg: "Selamat Isra Mi'raj 1446 H 🕌" },
        { name: "Hari Raya Nyepi", date: "2025-03-29", type: "indo", msg: "Selamat Hari Raya Nyepi 🕉️" },
        { name: "Awal Puasa Ramadhan", date: "2025-03-01", type: "ramadan", msg: "Marhaban Ya Ramadhan 🌙" },
        { name: "Hari Raya Idul Fitri", date: "2025-03-31", type: "eid", msg: "Selamat Idul Fitri 1446 H 🙏" },
        { name: "Waisak", date: "2025-05-12", type: "indo", msg: "Selamat Hari Raya Waisak 🪷" },
        { name: "Kenaikan Isa Almasih", date: "2025-05-29", type: "indo", msg: "Selamat Kenaikan Isa Almasih ✝️" },
        { name: "Hari Raya Idul Adha", date: "2025-06-06", type: "eid", msg: "Selamat Idul Adha 1446 H 🐄" },
        { name: "Tahun Baru Islam", date: "2025-06-27", type: "islamic", msg: "Selamat Tahun Baru Hijriyah 1447 H ☪️" },
        { name: "Maulid Nabi", date: "2025-09-05", type: "islamic", msg: "Selamat Maulid Nabi SAW 💚" },
        { name: "Tahun Baru Imlek", date: "2026-02-17", type: "party", msg: "Gong Xi Fa Cai 🧧" },
        { name: "Awal Puasa Ramadhan", date: "2026-02-18", type: "ramadan", msg: "Marhaban Ya Ramadhan 🌙" },
        { name: "Hari Raya Idul Fitri", date: "2026-03-20", type: "eid", msg: "Mohon Maaf Lahir Batin 🙏" }
    ];

    events = events.concat(variableEvents);

    // --- LOGIKA FILTER (DIPERBAIKI: STRICT MODE) ---
    const upcoming = events.filter(e => {
        const eventDate = new Date(e.date + " 00:00:00");
        const diffTime = eventDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        // PERUBAHAN: Ganti -1 menjadi 0 agar tidak ada toleransi H+1
        return diffDays >= 0; 
    }).sort((a, b) => new Date(a.date) - new Date(b.date))[0];

    if (!upcoming) {
        showNormalLoading(content);
        return;
    }

    const eventDate = new Date(upcoming.date + " 00:00:00");
    const diffTime = eventDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // LOGIKA TAMPILAN
    // Cek jika diffDays == 0 (Hari H)
    if (diffDays === 0) {
        showPartyEffect(upcoming.type, effectContainer);
        content.innerHTML = `
            <h1 class="hny-text" style="font-size:2rem; line-height:1.2;">${upcoming.msg}</h1>
            <p style="color:white; margin-top:10px;">Semoga hari ini penuh berkah!</p>
            <div style="margin-top:20px; color:#f59e0b; font-weight:bold; animation:pulse 1s infinite;">
                <i class="fas fa-gift"></i> Cek Promo Spesial ${upcoming.name}!
            </div>
        `;
    } 
    // Cek jika H-10 sampai H-1
    else if (diffDays > 0 && diffDays <= 10) {
        setInterval(() => {
            const current = new Date();
            const diff = eventDate - current;
            const d = Math.floor(diff / (1000 * 60 * 60 * 24));
            const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);

            content.innerHTML = `
                <h3 style="color:#cbd5e1; font-weight:normal; margin-bottom:5px;">MENUJU</h3>
                <h2 style="color:white; margin-bottom:20px; font-size:1.5rem; color:var(--primary); text-transform:uppercase;">${upcoming.name}</h2>
                <div>
                    <div class="time-box"><span class="time-val">${d}</span><span class="time-label">Hari</span></div>
                    <div class="time-box"><span class="time-val">${h}</span><span class="time-label">Jam</span></div>
                    <div class="time-box"><span class="time-val">${m}</span><span class="time-label">Menit</span></div>
                    <div class="time-box"><span class="time-val">${s}</span><span class="time-label">Detik</span></div>
                </div>
                <p style="color:#64748b; margin-top:20px; font-size:0.8rem;">Menyiapkan Server Amane Shop...</p>
            `;
        }, 1000);
        startSnowEffect(); 
    } 
    else {
       // showNormalLoading(content);
    }
}

// Helper: Tampilan Normal
function showNormalLoading(content) {
    content.innerHTML = `
        <div style="position:relative; margin-bottom:20px;">
            <img src="images/Riki.jpg" style="width:80px; height:80px; border-radius:50%; border:3px solid var(--primary); padding:3px; animation: pulse 2s infinite;">
            <div style="position:absolute; bottom:5px; right:5px; background:#10b981; border:3px solid #0f172a; width:18px; height:18px; border-radius:50%; box-shadow: 0 0 10px #10b981;"></div>
        </div>
        <h3 style="color:white; font-weight:800; letter-spacing:1px; margin-bottom:5px;">AMANE SHOP REAL</h3>
        <p style="color:#64748b; font-size:0.9rem; margin-bottom:25px;">Connecting to Server...</p>
        <div class="loader-ring"></div>
    `;
}

// Helper: Efek Visual
function showPartyEffect(type, container) {
    if(!container) return;
    container.innerHTML = '';
    
    // Islamic / Religious
    if(type === 'eid' || type === 'ramadan' || type === 'islamic') {
        for(let i=0; i<20; i++) {
            const el = document.createElement('div');
            el.innerHTML = i % 2 === 0 ? '🌙' : '✨';
            el.style.position = 'absolute';
            el.style.left = Math.random() * 100 + 'vw';
            el.style.top = '-50px';
            el.style.fontSize = Math.random() * 20 + 10 + 'px';
            el.style.animation = `fall ${Math.random() * 3 + 3}s linear infinite`;
            container.appendChild(el);
        }
    }
    // Indonesia / Nasional (Merah Putih)
    else if(type === 'indo') {
        for(let i=0; i<30; i++) {
            const el = document.createElement('div');
            el.style.position = 'absolute';
            el.style.width = '10px'; el.style.height = '10px';
            el.style.borderRadius = '50%';
            el.style.background = i % 2 === 0 ? 'red' : 'white';
            el.style.left = Math.random() * 100 + 'vw';
            el.style.top = '-10px';
            el.style.animation = `fall ${Math.random() * 3 + 2}s linear infinite`;
            container.appendChild(el);
        }
    }
    // Love / Hari Ibu / Valentine
    else if(type === 'love') {
        for(let i=0; i<20; i++) {
            const el = document.createElement('div');
            el.innerHTML = '❤️';
            el.style.position = 'absolute';
            el.style.left = Math.random() * 100 + 'vw';
            el.style.top = '-20px';
            el.style.animation = `fall ${Math.random() * 4 + 3}s linear infinite`;
            container.appendChild(el);
        }
    }
    // Party / New Year / Halloween
    else {
        startFireworkEffect();
    }
}


// --- EFEK VISUAL ---

function startSnowEffect() {
    const container = document.getElementById('effect-container');
    if(!container) return;
    container.innerHTML = ''; // Bersihkan

    for (let i = 0; i < 30; i++) {
        const flake = document.createElement('div');
        flake.style.position = 'absolute';
        flake.style.top = '-10px';
        flake.style.background = 'white';
        flake.style.borderRadius = '50%';
        flake.style.opacity = Math.random();
        flake.style.width = Math.random() * 5 + 'px';
        flake.style.height = flake.style.width;
        flake.style.left = Math.random() * 100 + 'vw';
        flake.style.animation = `fall ${Math.random() * 5 + 5}s linear infinite`;
        container.appendChild(flake);
    }
    // Inject keyframes lewat JS biar ringkas
    const style = document.createElement('style');
    style.innerHTML = `@keyframes fall { to { transform: translateY(110vh); } }`;
    document.head.appendChild(style);
}

function startFireworkEffect() {
    const container = document.getElementById('effect-container');
    if(!container) return;
    container.innerHTML = ''; 

    // Buat kembang api acak
    setInterval(() => {
        const fw = document.createElement('div');
        fw.classList.add('firework');
        fw.style.left = Math.random() * 100 + 'vw';
        fw.style.top = Math.random() * 80 + 'vh';
        // Warna warni
        const colors = ['red', 'gold', 'cyan', 'lime', 'magenta'];
        fw.style.boxShadow = `0 0 10px 2px ${colors[Math.floor(Math.random() * colors.length)]}`;
        
        container.appendChild(fw);
        
        // Hapus elemen setelah animasi selesai biar ga berat
        setTimeout(() => fw.remove(), 1000);
    }, 300);
}

function setupAutoFormatInput(elementId) {
    const input = document.getElementById(elementId);
    if (input) {
        input.addEventListener('input', function(e) {
            const original = e.target.value;
            const formatted = original.toLowerCase().replace(/\s/g, '');
            if (original !== formatted) e.target.value = formatted;
        });
    }
}

// --- LOGIKA KATEGORI (PANEL vs SCRIPT) ---

function switchCategory(cat, btnElement) {
    currentCategory = cat;
    if(btnElement) {
        document.querySelectorAll('.service-item').forEach(e => e.classList.remove('active'));
        btnElement.classList.add('active');
    }
    
['step-panel-view', 'step-script-view', 'step-course-view', 'step-subdomain-view', 'step-vps-view', 'step-app-view'].forEach(id => {
        const el = document.getElementById(id); if(el) el.style.display = 'none';
    });
    
    if (cat === 'vps') {
        document.getElementById('step-vps-view').style.display = 'block';
    } else if (cat === 'app') {
        document.getElementById('step-app-view').style.display = 'block';
    } 
    
    // 2. Ambil elemen Step 2
    const prodList = document.getElementById('prod-list');
    const step2Sub = document.getElementById('step2-subdomain-view');

    if (cat === 'subdomain') {
        document.getElementById('step-subdomain-view').style.display = 'block';
        if(prodList) prodList.style.display = 'none';
        if(step2Sub) step2Sub.style.display = 'block';
        loadDomainOptions();
    } else {
        // LOGIKA TAMPILKAN INPUT SESUAI KATEGORI
        if(cat === 'panel') document.getElementById('step-panel-view').style.display = 'block';
        else if(cat === 'script') document.getElementById('step-script-view').style.display = 'block';
        else if(cat === 'course') document.getElementById('step-course-view').style.display = 'block';
        else if (cat === 'vps') document.getElementById('step-vps-view').style.display = 'block'; 
        else if (cat === 'app') document.getElementById('step-app-view').style.display = 'block';
        
        if(prodList) prodList.style.display = 'grid';
        if(step2Sub) step2Sub.style.display = 'none';
        
        renderProducts();
    }
}

async function loadDomainOptions() {
    const select = document.getElementById('sub-domain-select');
    const priceDisplay = document.getElementById('subdomain-price-display');
    
    select.innerHTML = '<option value="">Mengambil data...</option>';
    priceDisplay.innerText = 'Rp 0';

    try {
        const res = await fetch('/api/domains/list');
        const data = await res.json();
        availableDomainsList = data; // { domain, price, zone_id, productId }

        if(data.length === 0) {
            select.innerHTML = '<option value="">Tidak ada domain tersedia</option>';
            return;
        }

        // Render Dropdown
        select.innerHTML = '<option value="">-- Pilih Domain --</option>' + 
            data.map(d => `<option value="${d.domain}">${d.domain}</option>`).join('');

        // Event saat domain dipilih
        select.onchange = () => {
            const val = select.value;
            const item = availableDomainsList.find(d => d.domain === val);
            
            // Ambil elemen kotak deskripsi (Pastikan ID ini ada di HTML)
            const descBox = document.getElementById('subdomain-desc-box');

          if (item) {
                currentSubdomainProductId = item.productId;
                // Update Harga
                priceDisplay.innerText = `Rp ${item.price.toLocaleString()}`;
                
                // [BARU] Update Deskripsi
                if (descBox) {
                    if (item.description) {
                        descBox.style.display = 'block';
                        descBox.innerHTML = item.description.replace(/\n/g, '<br>');
                    } else {
                        descBox.style.display = 'none';
                    }
                }
            } else {
                // Reset jika tidak ada pilihan
                priceDisplay.innerText = 'Rp 0';
                if(descBox) descBox.style.display = 'none';
            }
        };

    } catch(e) {
        select.innerHTML = '<option value="">Gagal memuat</option>';
    }
}

async function loadProducts() {
    const res = await fetch('/api/products');
    allProducts = await res.json();
    renderProducts(); 
}

function renderProducts() {
    const list = document.getElementById('prod-list');
    
    const filtered = allProducts.filter(p => {
        const pCat = p.category || 'panel'; 
        return pCat === currentCategory;
    });

    if(filtered.length === 0) {
        list.innerHTML = '<p style="grid-column: span 2; text-align:center; padding:20px; color:var(--text-muted)">Produk belum tersedia.</p>';
        return;
    }
    list.innerHTML = filtered.map(p => {
        let desc = "";
        if(currentCategory === 'panel') desc = `RAM ${p.ram}MB`;
        else if(currentCategory === 'script') desc = `Script Permanent`;
        else if(currentCategory === 'vps') desc = `Setup Manual`;
        else if(currentCategory === 'app') desc = `Akun Otomatis`;
        else desc = `Full Bimbingan`; 

        return `
    <div class="product-item" onclick="selectItem(this, ${p.id})" style="position:relative; padding-bottom: 40px;"> 
        <b style="font-size:1.1rem; display:block; padding-right:5px;">${p.name}</b>
        <div style="font-size:0.8rem; color:var(--text-muted); margin:5px 0;">${desc}</div>
        <div style="color:var(--primary); font-weight:bold;">Rp ${p.price.toLocaleString()}</div>
        
        <div onclick="event.stopPropagation(); openReviewModal(${p.id}, '${p.name}')" 
             style="position:absolute; bottom:10px; right:10px; 
             background:var(--bg-body); 
             width:32px; height:32px; border-radius:10px; display:flex; align-items:center; 
             justify-content:center; 
             color:var(--text-muted);
             cursor:pointer; 
             border:1px solid var(--border);
             box-shadow: 0 2px 5px rgba(0,0,0,0.1); transition:0.2s;"
             
             onmouseover="this.style.background='var(--primary)'; this.style.color='#fff'; this.style.borderColor='var(--primary)'" 
             onmouseout="this.style.background='var(--bg-body)'; this.style.color='var(--text-muted)'; this.style.borderColor='var(--border)'">
             
             <i class="fas fa-comment-dots" style="font-size:0.9rem;"></i>
        </div>
    </div>`;
    }).join('');
}

function selectItem(el, id) {
    let isValid = false;
    let reqField = null;
    let msg = "";
    if(currentCategory === 'panel') {
        reqField = document.getElementById('username');
        if(!reqField.value || reqField.value.length < 3) {
            msg = "Eits, isi Username Panel dulu ya (min 3 huruf)!";
        } else {
            isValid = true;
        }
    }
    else if(currentCategory === 'script') {
        reqField = document.getElementById('script-phone');
        if(!reqField.value) {
            msg = "Mohon isi Nomor WhatsApp untuk pengiriman file!";
        } else {
            isValid = true;
        }
    }
    else if(currentCategory === 'course') {
        reqField = document.getElementById('course-phone');
        if(!reqField.value) {
            msg = "Isi Nomor WhatsApp dulu untuk invite ke grup!";
        } else {
            isValid = true;
        }
    }
    else if(currentCategory === 'vps') {
        reqField = document.getElementById('vps-phone');
        if(!reqField.value) msg = "Isi nomor WA agar Owner bisa menghubungi Anda.";
        else isValid = true;
    }
    else if(currentCategory === 'app') {
        reqField = document.getElementById('app-phone');
        if(!reqField.value) msg = "Isi nomor WA untuk menerima akun!";
        else isValid = true;
    }
    else {
        isValid = true;
    }
    if(!isValid && reqField) {
        reqField.focus();
        reqField.classList.add('input-error-shake');
        setTimeout(() => reqField.classList.remove('input-error-shake'), 500);
        return showIosNotification('error', 'Data Belum Lengkap', msg);
    }
    document.querySelectorAll('.product-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    selectedProduct = allProducts.find(p => p.id === id);
    if(document.getElementById('course-desc-box')) document.getElementById('course-desc-box').style.display = 'none';
    if(document.getElementById('vps-desc-box')) document.getElementById('vps-desc-box').style.display = 'none';
    if((currentCategory === 'course' || currentCategory === 'sewa') && selectedProduct.description) {
        const box = document.getElementById('course-desc-box');
        if(box) {
            box.style.display = 'block';
            let title = currentCategory === 'sewa' ? 'Keuntungan Sewa:' : 'Keuntungan:';
            box.innerHTML = `<b>${title}</b><br>` + selectedProduct.description.replace(/\n/g, '<br>');
        }
    }
    if(currentCategory === 'vps' && selectedProduct.description) {
        const box = document.getElementById('vps-desc-box');
        if(box) {
            box.style.display = 'block';
            box.innerHTML = `<b>Spesifikasi & Detail:</b><br>` + selectedProduct.description.replace(/\n/g, '<br>');
        }
    }
    setTimeout(() => {
        const paySection = document.getElementById('btn-pay'); 
        if(paySection) {
            paySection.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center'
            });
        }
    }, 100); 
}


function showScriptFeatures() {
    if(currentCategory !== 'script') return;
    if(!selectedProduct) return showIosNotification('info', 'Pilih Produk', 'Silakan pilih paket script terlebih dahulu!');
    
    const list = document.getElementById('script-features-list');
    list.innerHTML = "";
    
    // Cek apakah ada menu_preview dari JSON
    if (selectedProduct.menu_preview) {
        // Ambil nama user login, atau default 'Guest'
        const userName = currentUser ? (currentUser.name || currentUser.username) : "Guest";
        
        // Ganti placeholder ${name} dengan nama asli
        let formattedText = selectedProduct.menu_preview.replace('${name}', userName);
        
        // Ubah newline (\n) menjadi <br> agar turun baris di HTML
        formattedText = formattedText.replace(/\n/g, '<br>');

        // Render tampilan ala chat bot
        list.innerHTML = `
            <div style="
                background: #0f172a; 
                padding: 15px; 
                border-radius: 10px; 
                font-family: monospace; 
                font-size: 0.85rem; 
                line-height: 1.4; 
                border: 1px solid #334155;
                color: #e2e8f0;
                white-space: pre-wrap;">${formattedText}</div>
            <p style="text-align:center; font-size:0.8rem; color:var(--text-muted); margin-top:10px;">
                *Tampilan di atas adalah preview menu bot.
            </p>
        `;
    } 
    // Fallback jika pakai fitur list biasa (old style)
    else if(selectedProduct.features && selectedProduct.features.length > 0) {
        list.innerHTML = selectedProduct.features.map(f => 
            `<li style="padding:10px 0; border-bottom:1px solid var(--border); display:flex; align-items:center;">
                <i class="fas fa-check-circle" style="color:var(--primary); margin-right:10px;"></i> ${f}
             </li>`
        ).join('');
    } else {
        list.innerHTML = "<li style='padding:10px;'>Detail menu tidak tersedia.</li>";
    }
    
    openModal('modal-script-menu');
}

// --- VISITOR LOGIC ---
async function enterWebsite() {
    const btn = document.querySelector('#intro-action button');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    try {
        const res = await fetch('/api/visitor/track', { method: 'POST' });
        const data = await res.json();
        if(data.new_visitor && document.getElementById('count-visitor')) {
            document.getElementById('count-visitor').innerText = data.total;
        }
    } catch(e) {}
    const overlay = document.getElementById('intro-overlay');
    overlay.style.transition = 'opacity 0.5s'; overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
}

// --- AUTH & LOGIN UI ---

function checkAuthAction(callback) {
    const sb = document.getElementById('sidebar');
    if (sb && sb.classList.contains('open')) {
        toggleSidebar(); 
    }

    if(!currentUser) {
        window.location.href = '/login';
    } else {
        callback();
    }
}

// [UPDATED] UPDATE UI NAVBAR & SIDEBAR (Nama, @user, Phone)
function updateUIForLogin() {
    const btnGuest = document.getElementById('nav-guest-btn');
    
    // Elemen Navbar (Cukup Greeting)
    const navGreeting = document.getElementById('nav-greeting');
    const navImg = document.getElementById('nav-img-small');

    // Elemen Sidebar
    const sbName = document.getElementById('sidebar-name');
    const sbUser = document.getElementById('sidebar-username');
    const sbPhone = document.getElementById('sidebar-phone');
    const sbImg = document.getElementById('sidebar-img');

    if(currentUser) {
        btnGuest.style.display = 'none';
        let displayName = currentUser.name || currentUser.username;
        let displayUser = "@" + currentUser.username;
        let displayPhone = currentUser.phone;
        navGreeting.innerText = "Hi, " + displayName;
        navImg.src = currentUser.profile_pic || 'images/logo1.jpg';
        sbName.innerText = displayName;
        sbUser.innerText = displayUser;
        sbPhone.innerText = displayPhone;
        sbImg.src = currentUser.profile_pic || 'images/logo1.jpg';

    } else {
        btnGuest.style.display = 'block';
        
        // Reset ke Default (Guest)
        navGreeting.innerText = "Hi, Guest";
        
        sbName.innerText = "Guest";
        sbUser.innerText = "@guest";
        sbPhone.innerText = "Belum Login";
        sbImg.src = 'images/logo1.jpg';
    }
}

function doLogout() {
    Swal.fire({
        title: 'Ingin Keluar?', text: "Anda harus login ulang nanti.", icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#f43f5e', cancelButtonColor: '#333',
        confirmButtonText: 'Ya, Logout', cancelButtonText: 'Batal', background: '#1f2937', color: '#fff'
    }).then((result) => {
        if (result.isConfirmed) {
            localStorage.removeItem('riki_user_session');
            currentUser = null;
            // Arahkan ke halaman login
            window.location.href = '/login';
        }
    });
}

function togglePass(inputId, iconEl) {
    const input = document.getElementById(inputId);
    if(input.type === "password") { input.type = "text"; iconEl.classList.remove('fa-eye'); iconEl.classList.add('fa-eye-slash'); } 
    else { input.type = "password"; iconEl.classList.remove('fa-eye-slash'); iconEl.classList.add('fa-eye'); }
}

function closeProfileView() { document.getElementById('profile-view').style.display = 'none'; }

async function handleProfileUpload(input) {
    const file = input.files[0];
    if(!file || file.size > 2 * 1024 * 1024) return showIosNotification('error', 'Gagal', 'File max 2MB');
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('profile-img-large').src = e.target.result;
        tempNewProfilePic = e.target.result;
        document.getElementById('btn-save-profile').innerText = "SIMPAN FOTO BARU";
    };
    reader.readAsDataURL(file);
}


const imageElement = document.getElementById('image-to-crop');
const cropModal = document.getElementById('crop-modal');

function openProfileView() {
    if(!currentUser) return window.location.href = '/login';
    
    switchView('profile'); 
    
    // A. ISI FORM DATA
    document.getElementById('p-username').value = currentUser.username;
    document.getElementById('p-phone').value = currentUser.phone;
    
    // B. LOGIKA BATAS GANTI NAMA (7 HARI)
    const nameInput = document.getElementById('p-name');
    const infoText = document.getElementById('name-change-info');
    nameInput.value = currentUser.name || "";
    
    if (currentUser.last_name_update) {
        const lastUpdate = new Date(currentUser.last_name_update);
        const now = new Date();
        const diffTime = Math.abs(now - lastUpdate);
        const diffDays = diffTime / (1000 * 60 * 60 * 24); 
        
        if (diffDays < 7) {
            const sisaHari = Math.ceil(7 - diffDays);
            nameInput.disabled = true;
            nameInput.style.opacity = "0.6";
            // Pastikan elemen infoText ada di HTML (lihat langkah 2 jika belum)
            if(infoText) {
                infoText.innerHTML = `<i class="fas fa-clock"></i> Tunggu <b>${sisaHari} hari</b> lagi untuk ganti nama.`;
                infoText.style.color = "#ef4444";
            }
        } else {
            nameInput.disabled = false;
            nameInput.style.opacity = "1";
            if(infoText) {
                infoText.innerHTML = `<i class="fas fa-check-circle"></i> Nama dapat diubah sekarang.`;
                infoText.style.color = "#10b981";
            }
        }
    }

    // C. TAMPILAN TEXT ATAS
    document.getElementById('disp-name').innerText = currentUser.name || currentUser.username;
    document.getElementById('disp-username').innerText = '@' + currentUser.username;
    
    // D. FORMAT TANGGAL JOIN (SESUAI REQUEST: HITUNGAN AWAL BUAT AKUN)
    // Mengambil data 'joined_at' yang tersimpan saat register pertama kali
    const joinDate = currentUser.joined_at ? new Date(currentUser.joined_at) : new Date();
    const options = { day: 'numeric', month: 'long', year: 'numeric' }; // Contoh: 29 Desember 2025
    document.getElementById('disp-join').innerText = joinDate.toLocaleDateString('id-ID', options);
    
    // Phone
    document.getElementById('disp-phone').innerText = '+' + currentUser.phone;

    // E. LOAD GAMBAR
    // Avatar
    document.getElementById('profile-img-large').src = currentUser.profile_pic || 'images/logo1.jpg';
    
    // Banner (Default jika belum ada)
    const bannerUrl = currentUser.banner_pic || 'images/banner-default.jpg'; 
    const imgBanner = document.getElementById('img-banner-view');
    if(imgBanner) imgBanner.src = bannerUrl;
    
    // Reset variabel crop setiap kali buka profil
    finalCroppedImage = null;
    finalBannerImage = null;
}
// --- 3. SIMPAN PERUBAHAN (DIPERBARUI) ---

function closeProfileView() { 
    document.getElementById('profile-view').style.display = 'none'; 
}

// --- 2. TRIGGER SAAT PILIH FILE (CROPPER) ---
function handleProfilePicChange(event) {
    const file = event.target.files[0];
    if (file) startCropping(file, 'avatar');
    // Reset input agar bisa pilih file yang sama ulang
    event.target.value = '';
}

// --- 3. HANDLER TRIGGER FILE (BANNER) ---
function handleBannerChange(event) {
    const file = event.target.files[0];
    if (file) startCropping(file, 'banner');
    event.target.value = '';
}

function startCropping(file, type) {
    // Validasi Ukuran
    if (file.size > 5 * 1024 * 1024) {
        return Swal.fire('Gagal', 'Ukuran file maksimal 5MB!', 'error');
    }

    currentCropType = type; // Set tipe crop saat ini

    const reader = new FileReader();
    reader.onload = (e) => {
        const imageElement = document.getElementById('image-to-crop');
        const cropModal = document.getElementById('crop-modal');
        
        imageElement.src = e.target.result;
        cropModal.style.display = "block"; 
        
        if (cropper) cropper.destroy();

        // KONFIGURASI CROPPER SESUAI TIPE
        let cropOptions = {
            viewMode: 1,
            autoCropArea: 1, // Langsung seleksi full area aman
        };

        if (type === 'avatar') {
            // Avatar = Kotak (1:1)
            cropOptions.aspectRatio = 1;
        } else {
            // Banner = Persegi Panjang (Misal 2.5 : 1)
            // Ini membuat area potong memanjang seperti banner header
            cropOptions.aspectRatio = 2.5; 
        }

        cropper = new Cropper(imageElement, cropOptions);
    };
    reader.readAsDataURL(file);
}

// --- 3. TOMBOL BATAL CROP ---
function closeCrop() {
    document.getElementById('crop-modal').style.display = "none";
    if (cropper) cropper.destroy();
}

// --- 4. TOMBOL POTONG & PAKAI ---
function saveCrop() {
    if (!cropper) return;

    // Tentukan resolusi output (Biar HD)
    // Avatar 500x500, Banner 1000x400
    const w = currentCropType === 'avatar' ? 500 : 1000;
    const h = currentCropType === 'avatar' ? 500 : 400;

    const canvas = cropper.getCroppedCanvas({ 
        width: w, 
        height: h,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
    });

    const resultBase64 = canvas.toDataURL('image/jpeg', 0.9);

    if (currentCropType === 'avatar') {
        finalCroppedImage = resultBase64;
        document.getElementById('profile-img-large').src = resultBase64;
        document.querySelector('.btn-save-profile').innerText = "SIMPAN FOTO BARU";
    } else {
        finalBannerImage = resultBase64;
        document.getElementById('img-banner-view').src = resultBase64;
        document.querySelector('.btn-save-profile').innerText = "SIMPAN BANNER BARU";
    }
    
    closeCrop();
}

// --- 5. SIMPAN KE SERVER (DENGAN LOADING) ---
async function saveProfileChanges() {
    const nameInput = document.getElementById('p-name');
    const newName = nameInput.value.trim();
    const btnSave = document.querySelector('.btn-save-profile');
    
    if (nameInput.disabled && !finalCroppedImage && !finalBannerImage) {
    payload.newBannerPic = finalBannerImage;
        return Swal.fire('Info', 'Tidak ada perubahan yang perlu disimpan.', 'info');
    }

    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    
    try {
        const currentUser = JSON.parse(localStorage.getItem('riki_user_session'));
        if(!currentUser) return;

        const payload = { username: currentUser.username };
        
        // Kirim Nama (Hanya jika input aktif)
        if (!nameInput.disabled && newName !== currentUser.name) {
            payload.newName = newName;
        }
        // Kirim Avatar Baru
        if (finalCroppedImage) payload.newProfilePic = finalCroppedImage; 
        // Kirim Banner Baru
        if (finalBannerImage) payload.newBannerPic = finalBannerImage;

        const res = await fetch('/api/user/update', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            // Update Session Lokal
            if(data.data) {
                currentUser.name = data.data.name;
                currentUser.profile_pic = data.data.profile_pic;
                currentUser.last_name_update = data.data.last_name_update;
                if(data.data.banner_pic) currentUser.banner_pic = data.data.banner_pic;
                
                localStorage.setItem('riki_user_session', JSON.stringify(currentUser));
            }
            
            updateUIForLogin();
            Swal.fire('Berhasil', 'Profil berhasil diperbarui!', 'success');
        } else {
            Swal.fire('Gagal', data.message, 'error');
        }
    } catch (err) {
        console.log(err);
        Swal.fire('Error', 'Gagal koneksi server', 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = 'SIMPAN PERUBAHAN';
    }
}

function formatPhoneNumber(number) {
    if (!number) return '';
    // 1. Hapus semua karakter selain angka (spasi, strip, plus, dll)
    let cleaned = number.toString().replace(/[^0-9]/g, '');
    
    // 2. Logika ubah awalan
    if (cleaned.startsWith('08')) {
        return '62' + cleaned.slice(1); // 08 -> 628
    } else if (cleaned.startsWith('8')) {
        return '62' + cleaned; // 8 -> 628
    } else if (cleaned.startsWith('62')) {
        return cleaned; // Sudah benar
    }
    // Default kembalikan apa adanya jika format lain
    return cleaned;
}

let tempOrderPayload = null; 
// appliedPromoCode sudah dideklarasikan di bagian atas script.js kamu, biarkan saja.

// 1. FUNGSI VALIDASI AWAL (Membuka Popup)
async function preValidateOrder() {
    if(!currentUser) return window.location.href = '/login';
    if (localStorage.getItem('pending_trx')) return showIosNotification('info', 'Pending', 'Selesaikan transaksi sebelumnya.');

    // Reset State Promo setiap buka popup baru
    appliedPromoCode = null; 
    document.getElementById('popup-promo-code').value = '';
    document.getElementById('popup-promo-msg').style.display = 'none';
    document.getElementById('conf-total-strike').style.display = 'none';

    let bodyData = { phone: currentUser.phone, username: currentUser.username };
    const btn = document.getElementById('btn-pay'); 
    
    // --- VALIDASI DATA SESUAI KATEGORI (Sama seperti sebelumnya) ---
    if(currentCategory === 'subdomain') {
        const subName = document.getElementById('sub-name').value.trim().toLowerCase();
        const subIp = document.getElementById('sub-ip').value.trim();
        const subDomain = document.getElementById('sub-domain-select').value;
        
        if(!subName || !subIp || !subDomain) return showIosNotification('error', 'Data Kurang', 'Lengkapi form subdomain.');
        const selectedDom = availableDomainsList.find(d => d.domain === subDomain);
        if(!selectedDom) return showIosNotification('error', 'Error', 'Paket domain error.');

        // API Check Domain
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cek...'; btn.disabled = true;
        try {
            const check = await fetch('/api/domains/check', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ subdomain: subName, domain: subDomain, zone_id: selectedDom.zone_id })
            });
            const res = await check.json();
            if(!res.available) {
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> PESAN SEKARANG'; btn.disabled = false;
                return showIosNotification('error', 'Gagal', res.message);
            }
        } catch(e) { btn.disabled = false; return; }

        bodyData.category = 'subdomain';
        bodyData.productId = selectedDom.productId;
        bodyData.customData = { subdomain: subName, domain: subDomain, ip: subIp, zone_id: selectedDom.zone_id };
        selectedProduct = { name: `${subName}.${subDomain}`, price: selectedDom.price, id: selectedDom.productId };
    } 
    else {
        // Validasi Panel/Script/Course
        if(!selectedProduct || selectedProduct.category !== currentCategory) return showIosNotification('error', 'Pilih Produk', 'Silakan pilih paket dulu.');

        if(currentCategory === 'panel') {
            const user = document.getElementById('username').value.trim().toLowerCase();
            if(user.length < 3) return showIosNotification('error', 'Username', 'Minimal 3 karakter.');
            bodyData.username = user;
        } 
        else if(currentCategory === 'script') {
            const phone = document.getElementById('script-phone').value;
            if(!phone) return showIosNotification('error', 'Nomor', 'Isi nomor WA.');
            bodyData.phone = formatPhoneNumber(phone);
        }
        else if(currentCategory === 'course') {
            const phone = document.getElementById('course-phone').value;
            if(!phone) return showIosNotification('error', 'Nomor', 'Isi nomor WA.');
            bodyData.phone = formatPhoneNumber(phone);
        }
       else if(currentCategory === 'vps') {
            const phone = document.getElementById('vps-phone').value;
            if(!phone) return showIosNotification('error', 'Nomor', 'Isi nomor WA.');
            bodyData.phone = formatPhoneNumber(phone);
            bodyData.productId = selectedProduct.id;
        }
        else if(currentCategory === 'app') {
            const phone = document.getElementById('app-phone').value;
            if(!phone) return showIosNotification('error', 'Nomor', 'Isi nomor WA.');
            bodyData.phone = formatPhoneNumber(phone);
            bodyData.productId = selectedProduct.id;
        }

        bodyData.productId = selectedProduct.id;
        bodyData.category = currentCategory;
    }
    
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> PESAN SEKARANG'; btn.disabled = false;

    // Simpan Data & Buka Popup
    tempOrderPayload = bodyData;
    showConfirmationPopup(bodyData);
}

// 2. TAMPILKAN POPUP
function showConfirmationPopup(data) {
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    
    document.getElementById('conf-date').innerText = todayStr;
    document.getElementById('conf-cat').innerText = currentCategory.toUpperCase();
    document.getElementById('conf-product').innerText = selectedProduct.name;
    
    let info = "-";
    if(currentCategory === 'panel') info = "User: " + data.username;
    else if(currentCategory === 'subdomain') info = "Domain: " + selectedProduct.name;
    else info = "WA: " + data.phone;
    
    document.getElementById('conf-data-val').innerText = info;

    // Set Harga Normal Awal
    document.getElementById('conf-total').innerText = 'Rp ' + selectedProduct.price.toLocaleString();
    document.getElementById('conf-total-strike').style.display = 'none'; // Sembunyikan coret harga

    openModal('modal-confirm-order');
}

// 3. FUNGSI CEK PROMO DI DALAM POPUP (BARU)
async function checkPromoInPopup() {
    const code = document.getElementById('popup-promo-code').value.toUpperCase();
    const btn = document.getElementById('btn-popup-check');
    const msg = document.getElementById('popup-promo-msg');
    const totalEl = document.getElementById('conf-total');
    const strikeEl = document.getElementById('conf-total-strike');

    if(!code) return showIosNotification('info', 'Kode Kosong', 'Masukkan kode promo.');

    btn.innerHTML = '...'; btn.disabled = true;

    try {
        const res = await fetch('/api/promo/check', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                code: code,
                category: currentCategory,
                productId: selectedProduct.id || tempOrderPayload.productId
            })
        });
        const json = await res.json();

        if(json.success) {
            appliedPromoCode = json.data;
            
            // Hitung Diskon
            const originalPrice = selectedProduct.price;
            const discountRp = Math.ceil(originalPrice * (appliedPromoCode.discount / 100));
            const finalPrice = originalPrice - discountRp;

            // Update Tampilan Popup (Efek Coret)
            strikeEl.style.display = 'block';
            strikeEl.innerText = 'Rp ' + originalPrice.toLocaleString(); // Harga Coret
            totalEl.innerText = 'Rp ' + finalPrice.toLocaleString(); // Harga Baru
            
            msg.style.display = 'block';
            msg.style.color = '#10b981';
            msg.innerHTML = `<i class="fas fa-check-circle"></i> Diskon ${appliedPromoCode.discount}% diterapkan!`;
        } else {
            appliedPromoCode = null;
            // Reset Tampilan
            strikeEl.style.display = 'none';
            totalEl.innerText = 'Rp ' + selectedProduct.price.toLocaleString();
            
            msg.style.display = 'block';
            msg.style.color = '#ef4444';
            msg.innerHTML = `<i class="fas fa-times-circle"></i> ${json.message}`;
        }
    } catch(e) {
        msg.style.display = 'block';
        msg.style.color = '#ef4444';
        msg.innerText = 'Gagal cek promo.';
    }
    btn.innerHTML = 'Gunakan'; btn.disabled = false;
}

async function showDataVps() {
    if(!currentUser) return;
    openModal('modal-datavps');
    const list = document.getElementById('list-vps');
    list.innerHTML = '<p style="text-align:center;">Memuat data...</p>';

    try {
        const res = await fetch('/api/my-vps/'+currentUser.phone);
        const data = await res.json();

        if(data.length === 0) list.innerHTML = '<p style="text-align:center; color:gray; padding:20px;">Belum ada VPS dibeli.</p>';
        else {
            list.innerHTML = data.map(v => `
                <div class="panel-list-item" style="cursor:default; animation: slideInLeft 0.5s;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b style="color:#6366f1;">${v.productName}</b>
                        <small style="background:#10b981; color:white; padding:2px 6px; border-radius:4px;">AKTIF</small>
                    </div>
                    <div style="margin-top:10px; background:rgba(0,0,0,0.2); padding:10px; border-radius:5px; font-family:monospace; font-size:0.85rem;">
                        IP: ${v.ip}<br>
                        Pass: ${v.password}
                    </div>
                    <small style="display:block; margin-top:5px; color:var(--text-muted);">${v.description}</small>
                    <small style="display:block; margin-top:5px; color:var(--text-muted); font-size:0.7rem;">Dibeli: ${new Date(v.purchase_date).toLocaleDateString()}</small>
                </div>
            `).join('');
        }
    } catch(e) { list.innerHTML = 'Gagal memuat.'; }
}

async function processTransaction() {
    if(!tempOrderPayload) return;
    
    // Masukkan kode promo jika ada
    if(appliedPromoCode) {
        tempOrderPayload.promoCode = appliedPromoCode.code;
    }

    const btn = document.getElementById('btn-final-pay');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROSES...';
    btn.disabled = true;

    try {
        const req = await fetch('/api/transaction/create', { 
            method:'POST', headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify(tempOrderPayload) 
        });
        const data = await req.json();
        
        if(data.success) {
            closeModal('modal-confirm-order');
            
            // [UPDATE] SIMPAN DATA LENGKAP AGAR TIDAK NGACO DI PAYMENT.HTML
            activeTransaction = { 
    transaction_id: data.transaction_id, 
    qr_string: data.qr_string, 
    amount: data.amount, 
    
    // TAMBAHKAN INI:
    productId: selectedProduct.id, 

    // Simpan Detail Produk & Kategori
    item: selectedProduct.name, 
                category: currentCategory, 
                
                // Simpan Data Target (PENTING BIAR GAK MINUS)
                target_data: tempOrderPayload.username || tempOrderPayload.customData?.subdomain || tempOrderPayload.phone || '-',
                username: currentUser.username, // Cadangan

                // Simpan Profil Pembeli
                user_profile: currentUser.profile_pic || 'images/logo1.jpg',
                user_name: currentUser.username || 'Guest'
            };

            localStorage.setItem('pending_trx', JSON.stringify(activeTransaction));
            localStorage.setItem('trx_expiry', new Date().getTime() + 300000); 
            
            window.location.href = '/payment'; 
        } else {
            showIosNotification('error', 'Gagal', data.message);
        }
    } catch(e) { 
        showIosNotification('error', 'Error', 'Gagal menghubungi server.');
        console.error(e);
    }
    btn.innerHTML = 'LANJUT BAYAR <i class="fas fa-arrow-right"></i>'; 
    btn.disabled = false;
}


async function showDataSubdomain() {
    if(!currentUser) return;
    openModal('modal-datasubdomain');
    const list = document.getElementById('list-subdomains');
    list.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> Memuat...</div>';

    try {
        const res = await fetch('/api/my-subdomains/'+currentUser.phone);
        const data = await res.json();
        
        if(data.length === 0) {
            list.innerHTML = '<p style="text-align:center; color:gray; padding:20px;">Belum ada subdomain.</p>';
        } else {
            list.innerHTML = data.map(s => `
                <div class="panel-list-item" style="cursor:default; animation: slideInLeft 0.5s;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b style="color:#8b5cf6; font-size:1rem;">${s.subdomain}</b>
                        <small style="background:#10b981; color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem;">AKTIF</small>
                    </div>
                    <div style="margin-top:8px; font-size:0.85rem; color:var(--text-main);">
                        <div style="margin-bottom:2px;"><i class="fas fa-network-wired" style="width:20px;"></i> ${s.ip}</div>
                        <div><i class="fas fa-random" style="width:20px;"></i> ${s.node}</div>
                    </div>
                    <small style="color:var(--text-muted); display:block; margin-top:8px; border-top:1px solid var(--border); padding-top:5px;">
                        Dibuat: ${new Date(s.created_at).toLocaleDateString()}
                    </small>
                </div>
            `).join('');
        }
    } catch(e) { list.innerHTML = '<p style="text-align:center; color:red;">Gagal memuat data.</p>'; }
}

function renderQR(qrStr, amount, fee, trxId, itemName, resetTimer) {
    document.getElementById('qrcode').innerHTML = "";
    new QRCode(document.getElementById("qrcode"), { text: qrStr, width: 250, height: 250 });

    const total = amount; 
    let captionPay = `╭━━ ⪻ 𝐏𝐀𝐘𝐌𝐄𝐍𝐓 𝐃𝐄𝐓𝐀𝐈𝐋 ⪼ ━━╮\n`;
    captionPay += `│ 📦 Item : ${itemName}\n`;
    captionPay += `│ 💵 Harga : Rp ${total.toLocaleString()}\n`;
    captionPay += `│ 🆔 Trx ID : ${trxId}\n`;
    captionPay += `╰━━━━━━━━━━━━━━━━━━╯\n\n`;
    captionPay += `⚠️ PENTING: Scan QR di atas dan bayar sesuai nominal PAS.`;

    document.getElementById('payment-details').innerText = captionPay;
    
    if(timerInterval) clearInterval(timerInterval);
    if(checkInterval) clearInterval(checkInterval);

    const updateTimer = () => {
        const now = new Date().getTime();
        const expiry = parseInt(localStorage.getItem('trx_expiry'));
        const distance = expiry - now;

        if (distance < 0) { forceCancel("Waktu Habis"); return; }

        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        document.getElementById('timer').innerText = `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
        
        if(Math.floor(distance/1000) % 3 === 0) checkStatus(trxId);
    };

    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
}

async function checkStatus(trxId) {
     try {
        const res = await (await fetch('/api/transaction/check', { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({transaction_id:trxId}) 
        })).json();
        
        if(res.status === 'success' || res.status === 'completed') { 
            clearInterval(timerInterval); 
            const boughtProductId = (activeTransaction && activeTransaction.productId) ? activeTransaction.productId : (selectedProduct ? selectedProduct.id : null);
            const boughtProductName = (activeTransaction && activeTransaction.item) ? activeTransaction.item : "Produk";
            clearLocalData(); 
            showIosNotification('success', 'Pembayaran Sukses!', 'Silakan cek Data Panel / Data Script.');
            if(currentCategory === 'script') showDataScript();
            else if(currentCategory === 'course') showDataCourse(); 
            else if(currentCategory === 'app') showDataApps();
            else if(currentCategory === 'vps') {
                Swal.fire('Sukses', 'Pembayaran diterima. Silakan chat Admin untuk klaim VPS.', 'success');
            }
            else showDataPanel();

            switchView('app');
            if(boughtProductId) {
                setTimeout(() => {
                    Swal.fire({
                        title: 'Suka Produknya?',
                        text: `Bantu kami dengan memberi ulasan bintang 5 untuk ${boughtProductName} ya kak!`,
                        icon: 'question',
                        showCancelButton: true,
                        confirmButtonText: '⭐ Beri Ulasan',
                        cancelButtonText: 'Nanti Saja',
                        confirmButtonColor: '#10b981',
                        cancelButtonColor: '#334155',
                        background: '#1f2937', // Tema Gelap
                        color: '#fff'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            openReviewModal(boughtProductId, boughtProductName);
                        }
                    });
                }, 3000); 
            }
        }
        else if(res.status === 'canceled') {
            forceCancel("Transaksi Dibatalkan");
        }
    } catch(e){}
}

function forceCancel(reason) { 
    if(timerInterval) clearInterval(timerInterval); 
    clearLocalData(); 
    switchView('app'); 
    showIosNotification('info', 'Info', reason); 
}

function clearLocalData() { 
    localStorage.removeItem('pending_trx'); 
    localStorage.removeItem('trx_expiry'); 
    activeTransaction = null; 
}

async function cancelTransaction() {
    if(activeTransaction) {
        if(timerInterval) clearInterval(timerInterval);
        await fetch('/api/transaction/cancel', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ transaction_id: activeTransaction.transaction_id }) });
        clearLocalData(); 
        switchView('app'); 
        showIosNotification('success', 'Dibatalkan', 'Transaksi dibatalkan.');
    }
}

// --- DATA PANEL & HISTORY & SCRIPT ---

async function showDataPanel() {
    if(!currentUser) return; 
    
    // 1. Buka Modal Dulu (Biar user tau sistem bekerja)
    openModal('modal-datapanel');
    
    const list = document.getElementById('list-panels');
    // Tampilkan animasi loading
    list.innerHTML = `
        <div style="text-align:center; padding:20px;">
            <i class="fas fa-spinner fa-spin fa-2x" style="color:var(--primary)"></i>
            <p style="margin-top:10px; color:var(--text-muted);">Sedang memuat data panel...</p>
        </div>`;

    try {
        // 2. Baru Fetch Data
        const res = await fetch('/api/my-panels/'+currentUser.phone);
        const data = await res.json();
        
        if(data.length === 0) {
            list.innerHTML = `
                <div style="text-align:center; padding:30px;">
                    <i class="fas fa-box-open fa-3x" style="color:var(--border); margin-bottom:15px;"></i>
                    <p style="color:var(--text-muted)">Belum ada panel yang aktif.</p>
                </div>`;
        } else {
            list.innerHTML = data.map((p) => {
                const ramShow = (p.ram >= 1024) ? (p.ram/1024) + 'GB' : p.ram + 'MB';
                // Tambahkan animasi slideInLeft biar keren
                return `
                <div class="panel-list-item" onclick='showDetailPanel(${JSON.stringify(p)})' style="animation: slideInLeft 0.5s ease-out;">
                    <div style="display:flex; justify-content:space-between;">
                        <b>${p.username}</b>
                        <small style="color:${p.status === 'active' ? '#10b981' : '#ef4444'}">${p.status.toUpperCase()}</small>
                    </div>
                    <small style="color:var(--text-muted)">${ramShow} | Exp: ${new Date(p.expired_date).toLocaleDateString()}</small>
                </div>
            `}).join('');
        }
    } catch(e) { 
        list.innerHTML = `<p style="text-align:center; color:#ef4444;">Gagal memuat data. Cek koneksi internet.</p>`; 
    }
}

async function showDataScript() {
    if(!currentUser) return;
    
    // 1. Buka Modal Dulu
    openModal('modal-datascript');
    
    const list = document.getElementById('list-scripts');
    list.innerHTML = `
        <div style="text-align:center; padding:20px;">
            <i class="fas fa-spinner fa-spin fa-2x" style="color:var(--primary)"></i>
            <p style="margin-top:10px;">Mengambil data script...</p>
        </div>`;
    
    try {
        const res = await fetch('/api/my-scripts/'+currentUser.phone);
        const data = await res.json();
        
        if(data.length === 0) {
            list.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:20px;">Belum ada script yang dibeli.</p>`;
        } else {
            list.innerHTML = data.map(s => `
                <div class="panel-list-item" style="cursor:default; animation: slideInLeft 0.5s ease-out;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b>${s.name}</b>
                        <small style="color:#10b981; font-weight:bold;">LUNAS</small>
                    </div>
                    <small style="color:var(--text-muted)">Dibeli: ${new Date(s.purchase_date).toLocaleDateString()}</small>
                    <a href="${s.download_url}" target="_blank" style="display:block; margin-top:10px; padding:10px; background:var(--primary); color:white; border-radius:8px; text-decoration:none; text-align:center; font-weight:bold; transition:0.3s;">
                        <i class="fas fa-download"></i> DOWNLOAD FILE
                    </a>
                </div>
            `).join('');
        }
    } catch(e) { 
        list.innerHTML = `<p style="text-align:center; color:#ef4444;">Gagal memuat data script.</p>`; 
    }
}

function showDetailPanel(p) {
    let expDate = 'Unknown';
    try { if(p.expired_date) expDate = new Date(p.expired_date).toLocaleDateString(); } catch(e){}
    const loginUrl = p.login_url || 'panel.domain.com'; 
    const fullText = `DATA PANEL\nUsername: ${p.username}\nPassword: ${p.password}\nLink: ${loginUrl}\nExp: ${expDate}`;
    const content = `
        <p><b>Username:</b> ${p.username}</p>
        <p><b>Password:</b> ${p.password}</p>
        <p><b>Link:</b> <a href="${loginUrl.startsWith('http') ? loginUrl : 'https://'+loginUrl}" target="_blank">Login Disini</a></p>
        <hr style="border:0; border-top:1px solid #444; margin:10px 0;">
        <button class="copy-btn" onclick="copyAllText(\`${fullText}\`)"><i class="fas fa-copy"></i> SALIN SEMUA DATA</button>
    `;
    document.getElementById('detail-content').innerHTML = content;
    openModal('modal-detail');
}

function copyAllText(txt) {
    navigator.clipboard.writeText(txt);
    showIosNotification('success', 'Disalin', 'Data panel berhasil disalin.');
}


let allHistoryData = []; // Variabel global untuk simpan data sementara

async function openHistory() {
    if(!currentUser) return window.location.href = '/login';
    
    // 1. Pindah ke View History
    switchView('history');
    
    // 2. Set Tab Default ke 'Semua'
    filterHistory('all', document.querySelector('.h-tab')); 

    const list = document.getElementById('history-list-container');
    list.innerHTML = `<div style="text-align:center; padding:50px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:var(--primary)"></i></div>`;

    try {
        const res = await fetch('/api/history/'+currentUser.phone);
        const data = await res.json();
        allHistoryData = data; // Simpan ke variabel global
        
        // Render Awal (Tab Semua)
        renderHistoryList(allHistoryData);
        
    } catch(e) { 
        list.innerHTML = `<p style="text-align:center; color:red; padding:20px;">Gagal memuat data.</p>`; 
    }
}


function filterHistory(status, tabElement) {
    // 1. Atur Visual Tab (Active State)
    if(tabElement) {
        document.querySelectorAll('.h-tab').forEach(el => el.classList.remove('active'));
        tabElement.classList.add('active');
    }

    // 2. Filter Data
    let filteredData = [];
    if (status === 'all') {
        filteredData = allHistoryData;
    } else {
        filteredData = allHistoryData.filter(h => {
            // Mapping status dari backend ke Tab
            if (status === 'success' && h.status === 'success') return true;
            if (status === 'pending' && h.status === 'pending') return true;
            if (status === 'canceled' && (h.status === 'canceled' || h.status === 'failed')) return true;
            return false;
        });
    }

    renderHistoryList(filteredData);
}

// Helper: Ubah format tanggal jadi "Januari 2025"
function getMonthYearHeader(dateString) {
    const date = new Date(dateString);
    const options = { month: 'long', year: 'numeric' };
    return date.toLocaleDateString('id-ID', options);
}

function renderHistoryList(data) {
    const list = document.getElementById('history-list-container');
    
    if (data.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding:50px; color:var(--text-muted);">
                <i class="fas fa-clipboard-list fa-3x" style="margin-bottom:10px; opacity:0.5;"></i>
                <p>Tidak ada transaksi.</p>
            </div>`;
        return;
    }

    // 1. Urutkan dari yang paling baru
    data.sort((a, b) => new Date(b.time) - new Date(a.time));

    let htmlContent = '';
    let lastHeader = ''; 

    data.forEach(h => {
        // 2. Cek Bulan & Tahun Transaksi
        const currentHeader = getMonthYearHeader(h.time);

        // 3. Jika beda bulan dengan item sebelumnya, buat HEADER BARU
        if (currentHeader !== lastHeader) {
            htmlContent += `
                <div style="
                    background: var(--bg-body);
                    color: var(--primary);
                    font-weight: bold;
                    padding: 15px 10px 5px 10px;
                    font-size: 0.95rem;
                    position: sticky; 
                    top: 60px;
                    z-index: 5;
                    border-bottom: 2px solid rgba(255,255,255,0.05);
                ">
                    ${currentHeader}
                </div>
            `;
            lastHeader = currentHeader;
        }

        // 4. Render Item Transaksi
        let statusClass = 'st-pending';
        let statusText = 'PROSES';
        let btnPay = '';
        const now = new Date().getTime();
        const trxTime = new Date(h.time).getTime();
        
        if(h.status === 'success') { statusClass = 'st-success'; statusText = 'SUKSES'; }
        else if(h.status === 'canceled') { statusClass = 'st-canceled'; statusText = 'BATAL'; }
        else if(h.status === 'failed') { statusClass = 'st-failed'; statusText = 'GAGAL'; }
        else if(h.status === 'pending') {
            // Cek Expired 5 Menit
            if (now - trxTime > 300000) { 
                statusClass = 'st-failed'; statusText = 'EXPIRED'; 
            } else {
                // Tombol Bayar
                const dataStr = JSON.stringify(h).replace(/"/g, '&quot;');
                btnPay = `<div style="margin-top:5px;"><button onclick="continuePayment(${dataStr})" style="background:var(--primary); color:white; border:none; padding:4px 12px; border-radius:50px; font-size:0.65rem; cursor:pointer;">Bayar</button></div>`;
            }
        }

        htmlContent += `
        <div class="trx-card-item" style="animation:none;">
            <div class="trx-left">
                <h4 style="font-size:0.9rem;">${h.item}</h4>
                <small style="color:var(--text-muted);"><i class="far fa-clock"></i> ${formatWIB(h.time)}</small>
                <small style="display:block; font-size:0.65rem; opacity:0.7;">ID: ${h.transaction_id}</small>
            </div>
            <div class="trx-right" style="text-align:right;">
                <span class="trx-price" style="font-size:0.9rem;">Rp ${h.amount.toLocaleString()}</span>
                <span class="status-pill ${statusClass}" style="font-size:0.65rem; padding:2px 6px;">${statusText}</span>
                ${btnPay}
            </div>
        </div>`;
    });

    list.innerHTML = htmlContent;
}

async function showDataCourse() {
    if(!currentUser) return;
    const list = document.getElementById('list-courses');
    list.innerHTML = '<p style="text-align:center;">Memuat...</p>';
    
    try {
        const res = await fetch('/api/my-courses/'+currentUser.phone); // Endpoint Baru
        const data = await res.json();
        
        if(data.length === 0) list.innerHTML = '<p style="text-align:center; color:var(--text-muted)">Belum join kelas manapun.</p>';
        else {
            list.innerHTML = data.map(c => `
                <div class="panel-list-item" style="cursor:default;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b>${c.name}</b>
                        <small style="color:green;">AKTIF</small>
                    </div>
                    <small style="color:var(--text-muted)">Join: ${new Date(c.purchase_date).toLocaleDateString()}</small>
                    <a href="${c.link_url}" target="_blank" style="display:block; margin-top:10px; padding:10px; background:#d97706; color:white; border-radius:8px; text-decoration:none; text-align:center; font-weight:bold;">
                        <i class="fas fa-external-link-alt"></i> BUKA LINK / GRUP
                    </a>
                </div>
            `).join('');
        }
    } catch(e) { list.innerHTML = 'Gagal memuat data.'; }
    openModal('modal-datacourse');
}

function continuePayment(data) {
    closeModal('modal-history');
    activeTransaction = { transaction_id: data.transaction_id, qr_string: data.qr_string, amount: data.amount, fee: 0, item: data.item, phone: currentUser.phone };
    localStorage.setItem('pending_trx', JSON.stringify(activeTransaction));
    localStorage.setItem('trx_expiry', new Date().getTime() + 300000);
    switchView('pay');
    renderQR(activeTransaction.qr_string, activeTransaction.amount, 0, activeTransaction.transaction_id, activeTransaction.item, true);
}

// --- GENERAL UI ---

async function updateStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        // 1. Update Pengunjung & Transaksi
        if(document.getElementById('count-visitor')) document.getElementById('count-visitor').innerText = data.visitors;
        if(document.getElementById('count-trx')) document.getElementById('count-trx').innerText = data.transactions;
        
        // 2. Update Total Member (BARU)
        if(document.getElementById('count-users')) document.getElementById('count-users').innerText = data.total_users;

        // 3. Update Uptime Server (BARU - Format Detik ke Jam/Menit)
        if(document.getElementById('count-uptime')) {
            const sec = Math.floor(data.uptime);
            const d = Math.floor(sec / (3600 * 24));
            const h = Math.floor((sec % (3600 * 24)) / 3600);
            const m = Math.floor((sec % 3600) / 60);
            
            let uptimeStr = "";
            if(d > 0) uptimeStr += `${d}h `; // Hari
            if(h > 0) uptimeStr += `${h}j `; // Jam
            uptimeStr += `${m}m`;            // Menit
            
            document.getElementById('count-uptime').innerText = uptimeStr;
        }

                if(data.last_notif && JSON.stringify(data.last_notif) !== JSON.stringify(lastNotifTime)) {
            lastNotifTime = data.last_notif;
            showIosNotification('info', 'Info Baru', data.last_notif.msg);
            document.getElementById('bell-dot').style.display = 'block';
            document.getElementById('bell-icon').classList.add('bell-shake');
        }
    } catch(e){}
}

async function showNotifications() {
    // Reset tanda merah bell
    document.getElementById('bell-dot').style.display = 'none';
    document.getElementById('bell-icon').classList.remove('bell-shake');
    document.getElementById('bell-icon').style.color = '';
    
    const list = document.getElementById('list-notif');
    openModal('modal-notif');

    // Loading State
    list.innerHTML = `
        <div style="text-align:center; padding:40px;">
            <i class="fas fa-circle-notch fa-spin fa-2x" style="color:var(--primary)"></i>
            <p style="margin-top:10px; color:var(--text-muted); font-size:0.9rem;">Memuat...</p>
        </div>`;

    try {
        const res = await fetch('/api/notifications');
        const data = await res.json();
        
        if(data.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:40px; color:gray;">Tidak ada notifikasi baru.</div>`;
        } else {
            list.innerHTML = data.map((n, i) => {
                // Tentukan Icon
                let icon = 'fa-bell'; let color = '#f59e0b'; let bg = 'rgba(245, 158, 11, 0.1)';
                if(n.title.toLowerCase().includes('info')) { icon = 'fa-bullhorn'; color = '#3b82f6'; bg = 'rgba(59, 130, 246, 0.1)'; }
                
                // --- LOGIKA POTONG TEKS ---
                // 1. Versi Pendek (Preview)
                let cleanText = n.msg.replace(/\*/g, '').replace(/_/g, '').replace(/```/g, '');
                let shortText = cleanText.length > 80 ? cleanText.substring(0, 80) + '...' : cleanText;
                
                // 2. Versi Panjang (HTML Full)
                let fullHtml = n.msg.replace(/\*(.*?)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

                // Cek apakah perlu tombol "Baca Selengkapnya"
                let isLong = cleanText.length > 80 || n.msg.includes('\n');
                
                let contentHtml = '';
                if(isLong) {
                    contentHtml = `
                        <div id="short-${i}" style="display:block;">
                            ${shortText} <span onclick="toggleRead(${i})" style="color:var(--primary); cursor:pointer; font-weight:bold; font-size:0.75rem;">[Baca Selengkapnya]</span>
                        </div>
                        <div id="full-${i}" style="display:none; margin-top:5px; animation:fadeIn 0.3s;">
                            ${fullHtml} <span onclick="toggleRead(${i})" style="color:gray; cursor:pointer; font-size:0.75rem; display:block; margin-top:5px;">[Tutup]</span>
                        </div>
                    `;
                } else {
                    contentHtml = fullHtml;
                }

                return `
                <div style="display:flex; gap:12px; padding:15px; border-bottom:1px solid var(--border);">
                    <div style="width:35px; height:35px; background:${bg}; color:${color}; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div style="flex:1;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <b style="font-size:0.9rem;">${n.title}</b>
                            <span style="font-size:0.7rem; color:gray;">${timeAgo(n.time)}</span>
                        </div>
                        <div style="font-size:0.85rem; color:var(--text-muted); line-height:1.4;">
                            ${contentHtml}
                        </div>
                    </div>
                </div>`;
            }).join('');
        }
    } catch(e) {
        list.innerHTML = '<p style="text-align:center; padding:20px; color:red;">Gagal memuat.</p>';
    }
}

// Tambahkan fungsi helper ini di bagian bawah script.js atau di luar fungsi showNotifications
function toggleNotifRead(index) {
    const shortView = document.getElementById(`short-notif-${index}`);
    const fullView = document.getElementById(`full-notif-${index}`);
    
    if(shortView.style.display === 'none') {
        // Sedang terbuka, tutup kembali
        shortView.style.display = 'block';
        fullView.style.display = 'none';
    } else {
        // Sedang tertutup, buka detail
        shortView.style.display = 'none';
        fullView.style.display = 'block';
    }
}

let logoClicks = 0;
const logoNav = document.getElementById('nav-img-small');
if(logoNav) {
    logoNav.addEventListener('click', (e) => {
        e.stopPropagation(); 
        logoClicks++;
        logoNav.style.transform = 'scale(0.9)';
        setTimeout(() => logoNav.style.transform = 'scale(1)', 100);

        if(logoClicks === 5) { 
            logoClicks = 0; 
            if(navigator.vibrate) navigator.vibrate([100, 50, 100]);
            showIosNotification('success', 'Admin Detected', 'Mengalihkan ke Dashboard...');
            setTimeout(() => {
                window.location.href = '/admin';
            }, 1000);
        }
        setTimeout(() => logoClicks = 0, 2000); 
    });
}

async function loginAdmin() {
    adminPinAuth = document.getElementById('admin-pin').value;
    await loadAdminData(false);
}

async function loadAdminData(doSync = false) {
    const list = document.getElementById('adm-table-body');
    const btnSync = document.getElementById('btn-sync');
    if(doSync) { btnSync.innerHTML = '...'; btnSync.disabled = true; }
    
    try {
        const url = doSync ? '/api/admin/all-panels?sync=true' : '/api/admin/all-panels';
        const res = await fetch(url, { headers: { 'pin': adminPinAuth } });
        const json = await res.json();

        if(!json.success) { alert(json.message); return; }

        document.getElementById('admin-login-view').style.display = 'none';
        document.getElementById('admin-panel-view').style.display = 'block';
        document.getElementById('adm-total').innerText = json.data.length;

        list.innerHTML = json.data.map(p => `
            <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:10px;"><b>${p.username}</b><br><small>${p.phone}</small></td>
                <td style="padding:10px;"><small>RAM: ${p.ram}MB</small></td>
                <td style="padding:10px;">${p.status}</td>
                <td style="padding:10px; text-align:center;">
                    <button onclick="deletePanelAdmin('${p.server_id}', '${p.username}')" style="background:red; color:white; border:none; border-radius:5px;">Hapus</button>
                </td>
            </tr>`).join('');
    } catch(e) {}
    if(doSync) { btnSync.innerHTML = 'Cek Real'; btnSync.disabled = false; }
}

async function deletePanelAdmin(serverId, username) { // Tambah parameter username biar jelas
    // Ganti confirm biasa dengan SweetAlert
    Swal.fire({
        title: 'Hapus Panel?',
        html: `Yakin ingin menghapus panel <b>${username || 'ini'}</b>?<br><small style="color:#ef4444">Data tidak bisa dikembalikan!</small>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Ya, Hapus!',
        cancelButtonText: 'Batal',
        background: '#1f2937', // Warna background gelap
        color: '#fff' // Warna teks putih
    }).then(async (result) => {
        if (result.isConfirmed) {
            // Jika user klik Ya, baru eksekusi API
            try {
                Swal.fire({
                    title: 'Memproses...',
                    text: 'Sedang menghapus data...',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading(),
                    background: '#1f2937',
                    color: '#fff'
                });

                await fetch('/api/admin/delete-panel', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'pin': adminPinAuth }, 
                    body: JSON.stringify({ server_id: serverId }) 
                });
                
                await loadAdminData(false); // Refresh tabel
                Swal.fire({
                    title: 'Terhapus!',
                    text: 'Panel berhasil dihapus.',
                    icon: 'success',
                    background: '#1f2937',
                    color: '#fff'
                });

            } catch (e) {
                Swal.fire('Error', 'Gagal menghapus panel', 'error');
            }
        }
    });
}

// --- HELPERS ---
function switchView(view) {
    // 1. Sembunyikan Semua View
    const views = ['app-view', 'payment-view', 'history-view', 'rekap-view', 'info-view', 'profile-view'];
    views.forEach(v => {
        const el = document.getElementById(v);
        if(el) el.style.display = 'none';
    });

    // 2. Tampilkan View yang Dipilih
    if (view === 'profile') {
        // PERBAIKAN: Gunakan 'block' agar susunan Banner & Avatar vertikal (atas-bawah)
        document.getElementById('profile-view').style.display = 'block'; 
        
    } else {
        const target = document.getElementById(view + '-view') || document.getElementById(view === 'app' ? 'app-view' : view);
        if(target) target.style.display = 'block';
    }
    
    // 3. Update Warna Ikon Bottom Nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItems = document.querySelectorAll('.nav-item');
    
    // Mapping: 0=Home, 1=Transaksi, 2=Rekap, 3=Info, 4=Akun
    if(view === 'app') navItems[0].classList.add('active');
    if(view === 'history') navItems[1].classList.add('active');
    if(view === 'rekap') navItems[2].classList.add('active');
    if(view === 'info') navItems[3].classList.add('active');
    if(view === 'profile') navItems[4].classList.add('active');

    window.scrollTo(0, 0);
}

function closeProfileView() {
    // Saat tombol back ditekan, kembali ke tampilan utama (App)
    switchView('app');
}

function toggleTheme(switchState = true) {
    const body = document.body;
    if(switchState) {
        const isDark = body.getAttribute('data-theme') === 'dark';
        body.setAttribute('data-theme', isDark ? 'light' : 'dark');
        localStorage.setItem('theme', isDark ? 'light' : 'dark');
    } else { body.setAttribute('data-theme', 'light'); }
}
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if(sb.classList.contains('open')) { sb.classList.remove('open'); ov.style.display = 'none'; } 
    else { sb.classList.add('open'); ov.style.display = 'block'; }
}
function openModal(id) { 
    const modal = document.getElementById(id);
    modal.style.display = 'flex';
    void modal.offsetWidth; 
    modal.style.opacity = '1';
    document.body.classList.add('no-scroll');
}
function closeModal(id) { 
    const modal = document.getElementById(id);
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
        const anyModalOpen = Array.from(document.querySelectorAll('.modal-overlay')).some(
            el => el.style.display === 'flex' && el.style.opacity === '1' && el.id !== id
        );
        if (!anyModalOpen) {
            document.body.classList.remove('no-scroll');
        }
    }, 300);
}
function zoomQR() { 
    if(!activeTransaction) return; 
    document.getElementById('zoom-img').innerHTML = ""; 
    new QRCode(document.getElementById("zoom-img"), { text: activeTransaction.qr_string, width: 300, height: 300 }); 
    document.getElementById('zoom-modal').style.display='flex'; 
}

async function sendAdminInfo() {
    const msg = document.getElementById('adm-info-msg').value;
    if(!msg) return alert('Tulis pesan dulu!');
    
    if(!confirm('Kirim info ini ke Web & WA Channel?')) return;
    
    try {
        const res = await fetch('/api/admin/broadcast', {
            method: 'POST', headers: {'Content-Type': 'application/json', 'pin': adminPinAuth},
            body: JSON.stringify({ message: msg })
        });
        const json = await res.json();
        if(json.success) {
            Swal.fire('Terkirim', 'Info berhasil disebar!', 'success');
            document.getElementById('adm-info-msg').value = '';
        }
    } catch(e) { alert('Error'); }
}

// --- LOGIKA CLEAR NOTIF ---
async function clearAdminNotifs() {
    if(!confirm('Yakin ingin menghapus SEMUA notifikasi user?')) return;
    
    try {
        const res = await fetch('/api/admin/clear-notifs', {
            method: 'POST', headers: {'pin': adminPinAuth}
        });
        Swal.fire('Bersih', 'Notifikasi berhasil direset.', 'success');
    } catch(e) { alert('Error'); }
}

// Ganti Tab
function switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    event.currentTarget.classList.add('active'); 
    
    if(tabName === 'rekap') loadAdminRekap(); // <--- BARU
    if(tabName === 'produk') loadAdminProducts();
    if(tabName === 'user') loadAdminUsers();
    if(tabName === 'panel') loadAdminPanels();
}

async function loadAdminRekap() {
    try {
        const res = await fetch('/api/admin/rekap', { headers: {'pin': adminPinAuth} });
        const json = await res.json();
        if(json.success) {
            const d = json.data;
            document.getElementById('adm-omset').innerText = 'Rp ' + d.omset.toLocaleString();
            document.getElementById('adm-users').innerText = d.total_users;
            document.getElementById('adm-sukses').innerText = d.success_trx;
            document.getElementById('adm-visitor').innerText = d.total_visitors;
            document.getElementById('adm-pending').innerText = d.pending_trx;
            
            // Format Uptime (Detik ke Jam)
            const h = Math.floor(d.uptime / 3600);
            const m = Math.floor((d.uptime % 3600) / 60);
            document.getElementById('adm-uptime').innerText = `${h} Jam ${m} Menit`;
            
            // Auto switch view jika login berhasil
            document.getElementById('admin-login-view').style.display = 'none';
            document.getElementById('admin-panel-view').style.display = 'block';
        } else {
            alert('PIN Salah / Akses Ditolak');
        }
    } catch(e) {}
}

// --- MANAJEMEN PRODUK ---
async function loadAdminProducts() {
    const list = document.getElementById('adm-list-produk');
    list.innerHTML = '<tr><td colspan="4" style="text-align:center;">Memuat...</td></tr>';
    try {
        const res = await fetch('/api/products');
        const data = await res.json();
        list.innerHTML = data.map(p => `
            <tr>
                <td>#${p.id}</td>
                <td><b>${p.name}</b><br><small style="color:var(--text-muted)">${p.category.toUpperCase()}</small></td>
                <td>Rp ${p.price.toLocaleString()}</td>
                <td><button onclick="deleteProduct(${p.id})" style="background:#ef4444; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">Hapus</button></td>
            </tr>
        `).join('');
    } catch(e) {}
}

async function addAdminProduct() {
    const cat = document.getElementById('add-p-cat').value;
    const body = {
        category: cat,
        name: document.getElementById('add-p-name').value,
        price: document.getElementById('add-p-price').value,
        ram: document.getElementById('add-p-ram').value,
        disk: document.getElementById('add-p-disk').value,
        cpu: document.getElementById('add-p-cpu').value,
        link_url: document.getElementById('add-p-link').value,
        download_url: document.getElementById('add-p-link').value,
        description: document.getElementById('add-p-desc').value,
        menu_preview: document.getElementById('add-p-desc').value
    };

    try {
        const res = await fetch('/api/admin/product/add', {
            method: 'POST', headers: {'Content-Type': 'application/json', 'pin': adminPinAuth},
            body: JSON.stringify(body)
        });
        const json = await res.json();
        if(json.success) {
            Swal.fire('Sukses', 'Produk berhasil ditambahkan!', 'success');
            loadAdminProducts();
            // Reset Form
            document.getElementById('add-p-name').value = '';
        } else alert('Gagal: ' + json.message);
    } catch(e) { alert('Error koneksi'); }
}

async function deleteProduct(id) {
    if(!confirm('Hapus produk ini?')) return;
    await fetch('/api/admin/product/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json', 'pin': adminPinAuth},
        body: JSON.stringify({ id })
    });
    loadAdminProducts();
}

// Form Switcher (Panel vs Script)
document.getElementById('add-p-cat').addEventListener('change', (e) => {
    if(e.target.value === 'panel') {
        document.getElementById('extra-panel').style.display = 'grid';
        document.getElementById('extra-other').style.display = 'none';
    } else {
        document.getElementById('extra-panel').style.display = 'none';
        document.getElementById('extra-other').style.display = 'block';
    }
});

// --- MANAJEMEN USER ---
async function loadAdminUsers() {
    const list = document.getElementById('adm-list-user');
    try {
        const res = await fetch('/api/admin/users', { headers: {'pin': adminPinAuth} });
        const json = await res.json();
        list.innerHTML = json.data.map(u => `
            <tr>
                <td><b>${u.username}</b><br><small>${u.name}</small></td>
                <td>${u.phone}</td>
                <td><button onclick="deleteUser('${u.phone}')" style="background:#ef4444; color:white; border:none; padding:5px; border-radius:5px; cursor:pointer;"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');
    } catch(e) {}
}

async function deleteUser(phone) {
    if(!confirm('Yakin hapus member ini?')) return;
    await fetch('/api/admin/delete-user', {
        method: 'POST', headers: {'Content-Type': 'application/json', 'pin': adminPinAuth},
        body: JSON.stringify({ phone })
    });
    loadAdminUsers();
}

// --- MANAJEMEN PANEL (Ganti fungsi lama loadAdminData) ---
async function loadAdminPanels(sync=false) {
    const list = document.getElementById('adm-table-body');
    try {
        const url = sync ? '/api/admin/all-panels?sync=true' : '/api/admin/all-panels';
        const res = await fetch(url, { headers: { 'pin': adminPinAuth } });
        const json = await res.json();
        
        // Simpan auth sukses
        if(json.success) {
            document.getElementById('admin-login-view').style.display = 'none';
            document.getElementById('admin-panel-view').style.display = 'block';
        } else {
            alert('PIN Salah'); return;
        }

        list.innerHTML = json.data.map(p => `
            <tr>
                <td><b>${p.username}</b></td>
                <td><small>RAM: ${p.ram}MB</small></td>
                <td>${p.status}</td>
                <td><button onclick="deletePanelAdmin('${p.server_id}', '${p.username}')" style="background:red; color:white; border:none; padding:5px; border-radius:5px;">Hapus</button></td>
            </tr>`).join('');
    } catch(e) {}
}

async function showDataSewa() {
    if(!currentUser) return;
    openModal('modal-datasewa'); // Buat modal ini di HTML nanti
    const list = document.getElementById('list-sewa');
    list.innerHTML = 'Loading...';

    try {
        // Kita pakai endpoint my-panels tapi filter di frontend atau backend
        const res = await fetch('/api/my-panels/'+currentUser.phone);
        const data = await res.json();
        
        // Filter cuma yang kategori sewa
        const rentals = data.filter(p => p.category === 'sewa' && p.status !== 'deleted');

        if(rentals.length === 0) {
            list.innerHTML = '<p style="text-align:center;">Tidak ada sewa bot aktif.</p>';
        } else {
            list.innerHTML = rentals.map(r => `
                <div class="panel-list-item">
                    <div style="display:flex; justify-content:space-between;">
                        <b>${r.username}</b>
                        <small style="color:#10b981">RUNNING</small>
                    </div>
                    <small>Exp: ${new Date(r.expired_date).toLocaleDateString()}</small>
                    
                    <div style="margin-top:10px; display:flex; gap:5px;">
                         <button onclick="resetSesi('${r.username}', '${r.server_uuid}')" class="btn-submit" style="background:#ef4444; font-size:0.8rem;">
                            <i class="fas fa-trash-alt"></i> RESET / RESTART
                        </button>
                        
                        <button onclick="viewPairingCode('${r.server_uuid}')" class="btn-submit" style="background:#3b82f6; font-size:0.8rem;">
                            <i class="fas fa-eye"></i> LIHAT KODE
                        </button>
                    </div>
                    <small style="font-size:0.7rem; color:gray; margin-top:5px; display:block;">*Jika kode belum muncul, tunggu 1 menit lalu klik lagi.</small>
                </div>
            `).join('');
        }
    } catch(e) { list.innerHTML = 'Error data.'; }
}

async function viewPairingCode(uuid) {
    Swal.fire({ title: 'Mengambil Kode...', didOpen: () => Swal.showLoading() });
    
    try {
        const res = await fetch('/api/rental/get-code', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ server_uuid: uuid })
        });
        const json = await res.json();
        
        if(json.success) {
            Swal.fire({
                title: 'KODE PAIRING',
                html: `<h1 style="font-size:3rem; letter-spacing:5px; color:#3b82f6; margin:10px 0;">${json.code}</h1>
                       <p>Silakan scan kode ini di WhatsApp Anda.<br>Menu: Perangkat Tertaut > Tautkan Perangkat > Masuk dengan No HP.</p>`,
                width: 600,
                confirmButtonText: 'Tutup'
            });
        } else {
            Swal.fire('Belum Muncul', 'Bot sedang proses start/install. Tunggu sebentar lalu coba lagi.', 'warning');
        }
    } catch(e) {
        Swal.fire('Error', 'Gagal mengambil kode.', 'error');
    }
}

// 2. Fungsi Eksekusi Reset
async function resetSesi(username, uuid) {
    Swal.fire({
        title: 'Reset Sesi Bot?',
        text: "Bot akan direstart dan minta scan ulang. Gunakan ini jika bot error/logout.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Ya, Reset!',
        background: '#1f2937', color: '#fff'
    }).then(async (res) => {
        if (res.isConfirmed) {
            Swal.fire({ title: 'Memproses...', didOpen: () => Swal.showLoading(), background: '#1f2937', color: '#fff' });
            
            try {
                const req = await fetch('/api/rental/reset', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ username, server_uuid: uuid })
                });
                const json = await req.json();
                
                if(json.success) {
                    Swal.fire('Berhasil', json.message, 'success');
                } else {
                    Swal.fire('Gagal', json.message, 'error');
                }
            } catch(e) { Swal.fire('Error', 'Gagal menghubungi server.', 'error'); }
        }
    });
}

// --- FORMAT ANGKA (1000 -> 1k) ---
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num;
}

// --- FUNGSI REAKSI USER ---
async function toggleReaction(reviewId, type, btnElement) {
    if(!currentUser) return showIosNotification('error', 'Login Dulu', 'Anda harus login untuk bereaksi.');
    
    // Efek visual klik (Bounce)
    btnElement.style.transform = "scale(1.3)";
    setTimeout(() => btnElement.style.transform = "scale(1)", 200);

    try {
        const res = await fetch('/api/reviews/react', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ reviewId, username: currentUser.username, type })
        });
        const json = await res.json();
        
        if(json.success) {
            // Update angka & warna secara manual di UI (tanpa reload)
            const count = json.reactions[type].length;
            const isActive = json.reactions[type].includes(currentUser.username);
            
            // Cari elemen icon & text di dalam tombol
            const icon = btnElement.querySelector('i');
            const text = btnElement.querySelector('span');
            
            text.innerText = formatNumber(count);
            
            if(isActive) {
                btnElement.classList.add('active-react');
                // Warna khusus
                if(type === 'love') icon.style.color = '#ec4899'; // Pink
                if(type === 'like') icon.style.color = '#3b82f6'; // Biru
                if(type === 'dislike') icon.style.color = '#ef4444'; // Merah
            } else {
                btnElement.classList.remove('active-react');
                icon.style.color = 'var(--text-muted)';
            }

            // Jika Like/Dislike, reset tombol lawannya (opsional, biar rapi)
            if(type === 'like' || type === 'dislike') {
                // Reload modal biar sinkron (cara termudah)
                // Atau biarkan saja user refresh sendiri
            }
        }
    } catch(e) {}
}

// --- FUNGSI UTAMA REVIEW MODAL ---
async function openReviewModal(productId, productName = "Produk") {
    if(!productId) return showIosNotification('error', 'Error', 'Produk tidak valid');
    
    currentReviewProductId = productId;
    currentRatingValue = 0;
    updateStarUI(0); 
    document.getElementById('review-comment').value = '';
    
    const nameLabel = document.getElementById('review-product-name');
    nameLabel.innerText = "Ulasan: " + productName;

    openModal('modal-reviews');

    // --- 1. CEK STATUS KOMENTAR PRODUK (Admin Setting) ---
    const formBox = document.getElementById('review-form-box');
    const msgContainer = document.getElementById('review-disabled-msg');
    
    // [FIX UTAMA] Gunakan '==' bukan '===' agar string/number cocok
    // Tambahkan safety check (|| {}) agar tidak error jika produk tidak ditemukan
    const product = allProducts.find(p => p.id == productId);
    
    // Default true (boleh review) jika produk tidak ditemukan di list lokal
    const isReviewAllowed = product ? (product.allowReview !== false) : true;

    // Bersihkan pesan error lama jika ada
    if(msgContainer) msgContainer.remove();

    if (!isReviewAllowed) {
        // JIKA DIMATIKAN ADMIN
        formBox.style.display = 'none';
        
        const msg = document.createElement('div');
        msg.id = 'review-disabled-msg';
        msg.style.cssText = "background:rgba(239, 68, 68, 0.1); color:#ef4444; padding:15px; border-radius:10px; text-align:center; margin-bottom:20px; border:1px solid rgba(239, 68, 68, 0.3); font-weight:bold;";
        msg.innerHTML = '<i class="fas fa-lock"></i> Komentar di produk ini dinonaktifkan Developer.';
        
        nameLabel.parentNode.insertBefore(msg, nameLabel.nextSibling);
    } else {
        // JIKA AKTIF
        formBox.style.display = 'block';
    }
    
    // --- 2. LOAD LIST REVIEW DARI SERVER ---
    const list = document.getElementById('review-list');
    list.innerHTML = '<p style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';

    try {
        const res = await fetch(`/api/reviews/${productId}`);
        const data = await res.json();

        if(!Array.isArray(data) || data.length === 0) {
            list.innerHTML = `
                <div style="text-align:center; padding:20px; color:var(--text-muted);">
                    <i class="far fa-comment-dots fa-2x"></i>
                    <p>Belum ada ulasan. Jadilah yang pertama!</p>
                </div>`;
        } else {
            list.innerHTML = data.map(r => {
                // 1. Badge Centang Biru
                let badgeVerified = r.isLoyal ? 
                    `<i class="fas fa-check-circle" style="color:#3b82f6; font-size:0.85rem; margin-left:5px;" title="Verified Sultan"></i>` : '';

                // 2. Badge Sultan
                let badgeLoyal = r.isLoyal ? 
                    `<span class="badge-verified" style="background:linear-gradient(135deg, #f59e0b, #d97706); color:white; font-size:0.65rem; padding:2px 6px; border-radius:4px; margin-left:5px; vertical-align:middle;"><i class="fas fa-crown"></i> Sultan</span>` : '';

                // Logika Reaksi
                const loves = r.reactions?.love || [];
                const likes = r.reactions?.like || [];
                const dislikes = r.reactions?.dislike || [];
                const myUser = currentUser ? currentUser.username : '';
                
                const isLoved = loves.includes(myUser) ? 'color:#ec4899;' : 'color:var(--text-muted);';
                const isLiked = likes.includes(myUser) ? 'color:#3b82f6;' : 'color:var(--text-muted);';
                const isDisliked = dislikes.includes(myUser) ? 'color:#ef4444;' : 'color:var(--text-muted);';
                
                const devLoved = loves.includes('Admin');
                const devLiked = likes.includes('Admin');
                const badgeDevLove = devLoved ? `<i class="fas fa-check-circle" style="color:#ec4899; font-size:0.7rem; margin-left:3px;" title="Disukai Developer"></i>` : '';
                const badgeDevLike = devLiked ? `<i class="fas fa-check-circle" style="color:#3b82f6; font-size:0.7rem; margin-left:3px;" title="Disukai Developer"></i>` : '';

                // Logika Balasan Developer
                let repliesHtml = '';
                if (r.replies && r.replies.length > 0) {
                    repliesHtml = r.replies.map(rep => `
                        <div class="reply-box" style="margin-top:10px; margin-left:15px; background:rgba(59,130,246,0.1); border-left:3px solid #3b82f6; padding:10px; border-radius:0 8px 8px 0;">
                            <div style="display:flex; align-items:center; gap:5px; font-weight:bold; color:#3b82f6; font-size:0.85rem; margin-bottom:3px;">
                                <i class="fas fa-code"></i> ${rep.name} <span style="background:#3b82f6; color:white; font-size:0.6rem; padding:1px 4px; border-radius:3px;">DEV</span>
                            </div>
                            <p style="margin:0; font-size:0.9rem; color:var(--text-main);">${rep.text}</p>
                        </div>
                    `).join('');
                }

                // Render HTML Per Item
                return `
                <div class="review-item" style="display:flex; flex-direction:column; gap:0; padding:15px; border-bottom:1px solid var(--border);">
                    <div style="display:flex; gap:12px;">
                        <img src="${r.userPic || 'images/logo1.jpg'}" class="review-avatar" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div>
                                    <b style="font-size:0.95rem;">${r.username}</b>
                                    ${badgeVerified} ${badgeLoyal}
                                </div>
                                <span class="review-date" style="font-size:0.75rem; color:var(--text-muted);">${timeAgo(r.date)}</span>
                            </div>
                            
                            <div class="review-stars" style="color:#f59e0b; font-size:0.8rem; margin:2px 0;">${renderStars(r.rating)}</div>
                            
                            <p style="font-size:0.95rem; color:var(--text-main); margin-top:5px; line-height:1.4;">"${r.comment}"</p>
                            
                            <div style="display:flex; gap:15px; margin-top:10px; border-top:1px solid rgba(255,255,255,0.05); padding-top:8px;">
                                <button onclick="toggleReaction(${r.id}, 'love', this)" style="background:transparent; border:none; cursor:pointer; display:flex; align-items:center; gap:5px; font-size:0.85rem; color:var(--text-muted);"><i class="fas fa-heart" style="${isLoved}"></i> <span>${formatNumber(loves.length)}</span>${badgeDevLove}</button>
                                <button onclick="toggleReaction(${r.id}, 'like', this)" style="background:transparent; border:none; cursor:pointer; display:flex; align-items:center; gap:5px; font-size:0.85rem; color:var(--text-muted);"><i class="fas fa-thumbs-up" style="${isLiked}"></i> <span>${formatNumber(likes.length)}</span>${badgeDevLike}</button>
                                <button onclick="toggleReaction(${r.id}, 'dislike', this)" style="background:transparent; border:none; cursor:pointer; display:flex; align-items:center; gap:5px; font-size:0.85rem; color:var(--text-muted);"><i class="fas fa-thumbs-down" style="${isDisliked}"></i> <span>${formatNumber(dislikes.length)}</span></button>
                            </div>
                        </div>
                    </div>
                    ${repliesHtml}
                </div>`;
            }).join('');
        }
    } catch(e) { 
        console.error(e);
        // Tampilkan pesan error yang lebih informatif
        list.innerHTML = `<div style="color:#ef4444; text-align:center; padding:20px;">
            <i class="fas fa-exclamation-triangle"></i> Gagal memuat ulasan.<br>
            <small>${e.message}</small>
        </div>`; 
    }
}

// 2. Helper Render Bintang (Output)
function renderStars(rating) {
    let html = '';
    for(let i=1; i<=5; i++) {
        if(i <= rating) html += '<i class="fas fa-star"></i>';
        else html += '<i class="far fa-star" style="opacity:0.3"></i>';
    }
    return html;
}

// 3. Logic Input Bintang (Input)
function setRating(val) {
    currentRatingValue = val;
    updateStarUI(val);
}

function updateStarUI(val) {
    const stars = document.querySelectorAll('#star-input-wrapper i');
    document.getElementById('rating-text').innerText = `(${val}/5)`;
    stars.forEach(s => {
        const starVal = parseInt(s.getAttribute('data-val'));
        if(starVal <= val) {
            s.classList.remove('far'); s.classList.add('fas', 'active');
            s.style.color = '#f59e0b';
        } else {
            s.classList.remove('fas', 'active'); s.classList.add('far');
            s.style.color = '#4b5563';
        }
    });
}

// 4. Kirim Review
async function submitReview() {
    if(!currentUser) return showIosNotification('error', 'Login Dulu', 'Silakan login untuk berkomentar.');
    if(currentRatingValue === 0) return showIosNotification('info', 'Rating', 'Pilih jumlah bintang (1-5).');
    
    const comment = document.getElementById('review-comment').value;
    if(!comment) return showIosNotification('info', 'Komentar', 'Tuliskan ulasan Anda.');

    const btn = document.querySelector('#review-form-box button');
    btn.innerHTML = 'Mengirim...'; btn.disabled = true;

    try {
        const res = await fetch('/api/reviews/add', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                username: currentUser.username,
                productId: currentReviewProductId,
                rating: currentRatingValue,
                comment: comment
            })
        });
        const json = await res.json();

        if(json.success) {
            showIosNotification('success', 'Terkirim', 'Terima kasih atas ulasannya!');
            // Refresh Modal (Load ulang list)
            openReviewModal(currentReviewProductId, document.getElementById('review-product-name').innerText.replace("Ulasan: ", ""));
        } else {
            showIosNotification('error', 'Gagal', json.message);
        }
    } catch(e) { showIosNotification('error', 'Error', 'Gagal koneksi server.'); }

    btn.innerHTML = 'KIRIM ULASAN'; btn.disabled = false;
}


// Tambahkan fungsi helper ini di paling bawah script.js
function toggleRead(id) {
    const shortDiv = document.getElementById(`short-${id}`);
    const fullDiv = document.getElementById(`full-${id}`);
    if(shortDiv.style.display === 'none') {
        shortDiv.style.display = 'block'; fullDiv.style.display = 'none';
    } else {
        shortDiv.style.display = 'none'; fullDiv.style.display = 'block';
    }
}

// Fitur Tempel / Paste Kode Promo
async function pastePromoCode() {
    try {
        const text = await navigator.clipboard.readText();
        if(text) {
            document.getElementById('input-promo').value = text;
            // Opsional: Langsung cek otomatis setelah ditempel
            // checkPromoCode(); 
        } else {
            showIosNotification('info', 'Kosong', 'Tidak ada teks yang disalin.');
        }
    } catch(err) {
        showIosNotification('error', 'Gagal', 'Ijin tempel ditolak browser/HP.');
    }
}

// --- FITUR REKAP TRANSAKSI (Hitung Manual di Client) ---
async function openRekap() {
    if(!currentUser) return window.location.href = '/login';
    switchView('rekap');
    
    document.getElementById('rekap-username').innerText = currentUser.username;
    
    try {
        const res = await fetch('/api/history/'+currentUser.phone);
        const data = await res.json();
        
        // Hitung Statistik
        let totalSpend = 0;
        let countSuccess = 0;
        let countPending = 0;
        let countFailed = 0;

        data.forEach(trx => {
            if(trx.status === 'success') {
                totalSpend += trx.amount;
                countSuccess++;
            } else if(trx.status === 'pending') {
                countPending++;
            } else {
                countFailed++;
            }
        });

        // Update UI
        document.getElementById('rekap-total').innerText = 'Rp ' + totalSpend.toLocaleString();
        document.getElementById('rekap-sukses').innerText = countSuccess;
        document.getElementById('rekap-pending').innerText = countPending;
        document.getElementById('rekap-gagal').innerText = countFailed;

    } catch(e) {
        console.log("Gagal load rekap");
    }
}

// --- FITUR INFORMASI (Halaman Full) ---
async function openFullInfo() {
    switchView('info');
    const container = document.getElementById('full-info-list');
    container.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> Memuat info...</div>';

    try {
        const res = await fetch('/api/notifications'); // Endpoint yang sama dgn lonceng
        const data = await res.json();

        if(data.length === 0) {
            container.innerHTML = `<div style="text-align:center; color:gray; padding:50px;">Belum ada informasi.</div>`;
        } else {
            container.innerHTML = data.map(n => `
                <div class="info-card-full">
                    <div class="info-card-header">
                        <div style="background:rgba(59,130,246,0.1); color:#3b82f6; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                            <i class="fas fa-bullhorn"></i>
                        </div>
                        <div>
                            <b style="font-size:0.95rem;">${n.title}</b><br>
                            <small style="color:var(--text-muted);">${timeAgo(n.time)}</small>
                        </div>
                    </div>
                    <div style="font-size:0.9rem; line-height:1.5; color:var(--text-main);">
                        ${n.msg.replace(/\n/g, '<br>')}
                    </div>
                </div>
            `).join('');
        }
    } catch(e) {
        container.innerHTML = '<p style="text-align:center; color:red;">Gagal memuat informasi.</p>';
    }
}

async function showDataApps() {
    if(!currentUser) return;
    openModal('modal-dataapps');
    const list = document.getElementById('list-apps');
    list.innerHTML = '<p style="text-align:center;">Memuat data...</p>';

    try {
        const res = await fetch('/api/my-apps/'+currentUser.phone);
        const data = await res.json();

        if(data.length === 0) list.innerHTML = '<p style="text-align:center; color:gray; padding:20px;">Belum ada aplikasi dibeli.</p>';
        else {
            list.innerHTML = data.map(v => `
                <div class="panel-list-item" style="cursor:default; animation: slideInLeft 0.5s;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b style="color:#ef4444;">${v.productName}</b>
                        <small style="background:#10b981; color:white; padding:2px 6px; border-radius:4px;">LUNAS</small>
                    </div>
                    <div style="margin-top:10px; background:rgba(0,0,0,0.2); padding:10px; border-radius:5px; font-family:monospace; font-size:0.85rem; user-select:text;">
                        Email: ${v.email}<br>
                        Pass: ${v.password}
                    </div>
                    <small style="display:block; margin-top:5px; color:var(--text-muted);">${v.description}</small>
                    <small style="display:block; margin-top:5px; color:var(--text-muted); font-size:0.7rem;">Dibeli: ${new Date(v.purchase_date).toLocaleDateString()}</small>
                </div>
            `).join('');
        }
    } catch(e) { list.innerHTML = 'Gagal memuat.'; }
}

// --- FITUR TOMBOL BANTUAN ---
function toggleHelp() {
    const menu = document.getElementById('help-menu');
    const btn = document.querySelector('.help-btn');
    const icon = document.getElementById('help-icon-main');
    
    // Toggle class show
    if (menu.classList.contains('show')) {
        menu.classList.remove('show');
        btn.classList.remove('active');
        icon.classList.remove('fa-times');
        icon.classList.add('fa-headset');
    } else {
        menu.classList.add('show');
        btn.classList.add('active');
        icon.classList.remove('fa-headset');
        icon.classList.add('fa-times');
    }
}

// Tutup menu kalau klik di luar area
document.addEventListener('click', function(e) {
    const container = document.querySelector('.help-container');
    const menu = document.getElementById('help-menu');
    
    // Jika klik terjadi di luar container dan menu sedang terbuka
    if (!container.contains(e.target) && menu.classList.contains('show')) {
        toggleHelp(); // Tutup
    }
});

window.addEventListener('load', async () => {
    // 1. Cek apakah ada parameter 'review_code' di URL
    const urlParams = new URLSearchParams(window.location.search);
    const reviewCode = urlParams.get('review_code');

    if (reviewCode) {
        // Hapus parameter dari URL agar bersih (opsional)
        window.history.replaceState({}, document.title, "/");

        console.log("Mencoba membuka ulasan untuk:", reviewCode);

        // 2. Tunggu sebentar sampai produk dimuat (fetchProducts)
        // Kita pakai interval untuk mengecek apakah 'allProducts' sudah terisi
        let attempts = 0;
        const waitForProducts = setInterval(() => {
            attempts++;
            // Jika allProducts sudah ada isinya ATAU sudah mencoba 20x (2 detik)
            if ((typeof allProducts !== 'undefined' && allProducts.length > 0) || attempts > 20) {
                clearInterval(waitForProducts);
                
                // 3. Cari produk berdasarkan kode atau nama
                const productToReview = allProducts.find(p => 
                    p.code === reviewCode || p.title === reviewCode
                );

                if (productToReview) {
                    // 4. Buka Modal Detail Produk
                    openProductDetail(productToReview);
                    
                    // 5. (Opsional) Scroll ke bagian komentar/rating
                    // Pastikan di dalam modal ada elemen ID 'review-section' atau sesuaikan
                    setTimeout(() => {
                        const reviewSection = document.getElementById('reviews-container');
                        if(reviewSection) {
                            reviewSection.scrollIntoView({ behavior: 'smooth' });
                            // Trigger tombol "Tulis Ulasan" jika ada
                            // document.getElementById('btn-write-review')?.click();
                        }
                    }, 500);
                    
                    // Notifikasi kecil
                    Swal.fire({
                        icon: 'success',
                        title: 'Silakan Nilai Produk',
                        text: `Bagaimana pengalamanmu membeli ${productToReview.title}?`,
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 3000
                    });
                }
            }
        }, 100); // Cek setiap 100ms
    }
});