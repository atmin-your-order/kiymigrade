module.exports = {
    commands: ['.listuser', '.deluser'],
    tags: 'users',
    help: 'Manajemen User Website',
    run: async (m, { sock, args, command, adminSessions, dbFunc }) => {
        const from = m.key.remoteJid;
        
        // Cek Auth Admin
        if (!adminSessions.has(from)) return;

        const { readUsers, writeUsers } = dbFunc;
        const users = readUsers();

        // ==========================================
        // 1. LIST USER (.listuser)
        // ==========================================
        if (command === '.listuser') {
            if (users.length === 0) return sock.sendMessage(from, { text: '📂 *DATA USER KOSONG*\nBelum ada member mendaftar.' });

            // Paginasi (Biar gak kepanjangan kalau user ribuan)
            const limit = 10; 
            const page = args[0] ? parseInt(args[0]) : 1;
            const totalPages = Math.ceil(users.length / limit);

            if (page > totalPages || page < 1) {
                return sock.sendMessage(from, { text: `❌ Halaman ${page} tidak ditemukan.\nTotal halaman: ${totalPages}` });
            }

            const startIndex = (page - 1) * limit;
            const pageUsers = users.slice(startIndex, startIndex + limit);

            let text = `👥 *DAFTAR MEMBER WEBSITE* (Hal ${page}/${totalPages})\n`;
            text += `Total: ${users.length} Member\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

            text += pageUsers.map((u, index) => {
                let displayPhone = u.phone;
                // Sensor sedikit nomornya biar aman jika di screenshot
                // displayPhone = displayPhone.substring(0, 4) + 'xxxx' + displayPhone.substring(displayPhone.length - 3);
                return `${startIndex + index + 1}. *${u.name}*\n   🆔 @${u.username}\n   📱 ${displayPhone}\n   📅 Join: ${new Date(u.joined_at).toLocaleDateString()}`;
            }).join('\n\n');

            if(page < totalPages) text += `\n\n👉 *Ketik .listuser ${page + 1} untuk halaman selanjutnya.*`;
            text += `\n\n_Gunakan .deluser NoWA untuk menghapus._`;

            await sock.sendMessage(from, { text });
        }

        // ==========================================
        // 2. DELETE USER (.deluser)
        // ==========================================
        if (command === '.deluser') {
            if (args.length < 1) return sock.sendMessage(from, { text: '❌ Masukkan Nomor WA User.\nContoh: *.deluser 628123456789*' });

            const targetPhone = args[0].trim().replace(/[^0-9]/g, ''); // Ambil angka saja

            const index = users.findIndex(u => u.phone === targetPhone);

            if (index === -1) {
                return sock.sendMessage(from, { text: `❌ User dengan nomor *${targetPhone}* tidak ditemukan.` });
            }

            const deletedUser = users[index];
            
            // Hapus dari array
            users.splice(index, 1);
            writeUsers(users); // Simpan ke file

            let msg = `🗑️ *MEMBER BERHASIL DIHAPUS*\n\n`;
            msg += `👤 Nama: ${deletedUser.name}\n`;
            msg += `🆔 Username: ${deletedUser.username}\n`;
            msg += `📱 No WA: ${deletedUser.phone}\n`;
            msg += `\n_User ini tidak bisa login lagi ke website._`;

            await sock.sendMessage(from, { text: msg });
        }
    }
};
