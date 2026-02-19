module.exports = {
    commands: ['.menuadmin', '.rekap', '.info', '.notifclear'],
    tags: 'info',
    help: 'Menu Admin & Info Website',
    run: async (m, { sock, command, args, adminSessions, dbFunc }) => {
        const from = m.key.remoteJid;
        
        // Cek Auth
        if (!adminSessions.has(from)) return;

        const { readDB, writeDB, readUsers, readVisitors } = dbFunc;

        // ==========================================
        // 1. MENU ADMIN (DENGAN PANDUAN)
        // ==========================================
        if (command === '.menuadmin') {
            let text = `🤖 *ADMIN DASHBOARD PANEL* 🤖\n`;
            text += `_Control panel via WhatsApp_\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

            text += `🛍️ *MANAJEMEN PRODUK*\n`;
            text += `├ 🔹 *.listproduk* _(Lihat Stok)_\n`;
            text += `├ 🔹 *.addproduk* _(Tambah Stok)_\n`;
            text += `└ 🔹 *.delproduk* ID _(Hapus Stok)_\n\n`;

            text += `👥 *MANAJEMEN MEMBER*\n`;
            text += `├ 🔹 *.listuser* _(Daftar Member)_\n`;
            text += `└ 🔹 *.deluser* NoWA _(Hapus Member)_\n\n`;

            text += `📢 *INFORMASI & SISTEM*\n`;
            text += `├ 🔹 *.info* Teks _(Kirim Notif Web)_\n`;
            text += `├ 🔹 *.rekap* _(Cek Statistik)_\n`;
            text += `├ 🔹 *.uptesti* _(kirim testimoni)_\n`;
            text += `├ 🔹 *.notifclear* _(bersihkan semua notif)_\n`;
            text += `└ 🔹 *.logout* _(Keluar Sesi)_\n\n`;

            text += `📝 *PANDUAN FORMAT COMMAND:*\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━\n`;
            text += `1️⃣ *Tambah Course (Murid):*\n`;
            text += `_Format: .addproduk course|Nama|Harga|Link|Desc_\n`;
            text += `_Contoh: .addproduk course|Murid Unbend|15000|https://grup.wa|Full Bimbingan_\n\n`;

            text += `2️⃣ *Tambah Panel:*\n`;
            text += `_Format: .addproduk panel|Nama|Harga|RAM|Disk|CPU_\n`;
            text += `_Contoh: .addproduk panel|Panel Sultan|5000|1024|1024|100_\n\n`;

            text += `3️⃣ *Hapus Member:*\n`;
            text += `_Format: .deluser 628xxx_\n`;
            text += `_Contoh: .deluser 628123456789_\n\n`;

            text += `_Riki Shop Real System_`;

            return sock.sendMessage(from, { text });
        }

        // ==========================================
        // 2. REKAP STATISTIK
        // ==========================================
        if (command === '.rekap') {
            const visitors = readVisitors();
            const users = readUsers();
            const db = readDB();
            
            const successTrx = db.history.filter(h => h.status === 'success').length;
            const pendingTrx = db.history.filter(h => h.status === 'pending').length;
            const totalOmset = db.history
                .filter(h => h.status === 'success')
                .reduce((acc, curr) => acc + curr.amount, 0);

            let text = `📊 *LIVE STATISTIK WEBSITE* 📊\n`;
            text += `📅 ${new Date().toLocaleString('id-ID')}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━\n`;
            text += `👥 *Traffic:* ${visitors.length} IP Address\n`;
            text += `👤 *Member:* ${users.length} User Terdaftar\n`;
            text += `✅ *Trx Sukses:* ${successTrx}\n`;
            text += `⏳ *Trx Pending:* ${pendingTrx}\n`;
            text += `💰 *Total Omset:* Rp ${totalOmset.toLocaleString()}\n`;
            
            await sock.sendMessage(from, { text });
        }
        
                // ==========================================
        // 4. FITUR BERSIHKAN NOTIFIKASI
        // ==========================================
        if (command === '.notifclear') {
            const db = readDB();
            
            // Kosongkan array notifications saja
            db.notifications = [];
            
            // Simpan database
            writeDB(db);

            await sock.sendMessage(from, { text: '✅ *SUKSES*\nSeluruh notifikasi (lonceng) di website telah dibersihkan menjadi 0.' });
        }

        // ==========================================
        // 3. FITUR INFO (KE NOTIF LONCENG)
        // ==========================================
        if (command === '.info') {
            const infoText = args.join(' ').trim();
            if (!infoText) return sock.sendMessage(from, { text: '❌ Masukkan teks info.\nContoh: *.info Website maintenance sebentar.*' });

            const db = readDB();
            db.notifications.unshift({
                title: "📢 INFO DEVELOPER",
                msg: infoText,
                time: new Date().toISOString()
            });
            writeDB(db);

            await sock.sendMessage(from, { text: `✅ *INFO DIKIRIM KE WEB*\n"${infoText}"` });
        }
    }
};
