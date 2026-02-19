module.exports = {
    commands: ['.addproduk', '.delproduk', '.listproduk'],
    tags: 'store',
    help: 'Kelola Produk (Add/Delete/List)',
    run: async (m, { sock, args, command, adminSessions, dbFunc, env }) => {
        const from = m.key.remoteJid;
        
        // Cek Auth
        if (!adminSessions.has(from)) return;

        // Ambil fungsi DB dan Produk
        const { readProducts, writeProducts, readDB, writeDB } = dbFunc;
        const products = readProducts();
        const db = readDB(); 

        // ==========================================
        // 1. LIST PRODUK (LIMIT 50 ITEM)
        // ==========================================
        if (command === '.listproduk') {
            if (products.length === 0) return sock.sendMessage(from, { text: '📂 *DAFTAR PRODUK KOSONG*\nBelum ada produk yang dijual.' });

            // --- CONFIG HALAMAN ---
            const limit = 50; // <--- SUDAH DIUBAH JADI 50
            const page = args[0] ? parseInt(args[0]) : 1;
            const totalPages = Math.ceil(products.length / limit);

            // Validasi Halaman
            if (page > totalPages || page < 1) {
                return sock.sendMessage(from, { text: `❌ Halaman ${page} tidak ditemukan.\nTotal halaman saat ini: *${totalPages}*` });
            }

            // Potong Array Produk Sesuai Halaman
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const pageProducts = products.slice(startIndex, endIndex);

            // Susun Pesan
            let text = `📦 *DAFTAR PRODUK TOKO* (Hal ${page}/${totalPages})\n`;
            text += `Total: ${products.length} Produk\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            text += pageProducts.map(p => `🆔 *ID: ${p.id}*\n🔹 ${p.name}\n💰 Rp ${p.price.toLocaleString()}\n🏷️ ${p.category ? p.category.toUpperCase() : 'PANEL'}\n-------------------------`).join('\n');
            
            // Footer Navigasi
            if(page < totalPages) {
                text += `\n👉 *Ketik .listproduk ${page + 1} untuk halaman selanjutnya.*`;
            }
            text += `\n\n_Gunakan .delproduk ID untuk menghapus._`;

            await sock.sendMessage(from, { text });
            return;
        }

        // ==========================================
        // 2. ADD PRODUK (Lengkap)
        // ==========================================
        if (command === '.addproduk') {
            if (args.length < 3) return sock.sendMessage(from, { text: '❌ Format salah! Lihat .menuadmin' });

            const category = args[0].trim().toLowerCase();
            const name = args[1].trim();
            const price = parseInt(args[2].trim());
            const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
            const createdAt = new Date().toISOString(); 

            let newProduct = null;
            let specsInfo = "";

            if (category === 'script') {
                const link = args[3] ? args[3].trim() : '#';
                const menu = args.slice(4).join('|') || 'Menu tidak tersedia';
                newProduct = { id: newId, category: 'script', name, price, download_url: link, menu_preview: menu, created_at: createdAt };
                specsInfo = "⚡ *Fitur:* Script Anti-Delay & Responsive";
            } 
            else if (category === 'course') {
                const link = args[3] ? args[3].trim() : '#';
                const descRaw = args.slice(4).join('|');
                const desc = descRaw ? descRaw.trim() : 'Fasilitas lengkap.';
                newProduct = { id: newId, category: 'course', name, price, link_url: link, description: desc, created_at: createdAt };
                specsInfo = "🎓 *Fasilitas:* " + desc.substring(0, 50) + "...";
            }
            else if (category === 'panel') {
                const ram = args[3] ? parseInt(args[3]) : 1024;
                const disk = args[4] ? parseInt(args[4]) : 1024;
                const cpu = args[5] ? parseInt(args[5]) : 100;
                newProduct = { id: newId, category: 'panel', name, ram, disk, cpu, price, created_at: createdAt };
                specsInfo = `⚙️ *Spek:* RAM ${ram}MB | Disk ${disk}MB | CPU ${cpu}%`;
            } else return sock.sendMessage(from, { text: '❌ Kategori salah! Pilih: panel, script, atau course.' });

            if(newProduct) {
                // A. Simpan Produk
                products.push(newProduct);
                writeProducts(products);
                
                // B. Notifikasi Website (Lonceng)
                db.notifications.unshift({
                    title: "✨ PRODUK BARU!",
                    msg: `Telah hadir ${name} harga Rp ${price.toLocaleString()}.`,
                    time: new Date().toISOString()
                });
                writeDB(db); 

                // C. Respon ke Admin
                await sock.sendMessage(from, { text: `✅ *PRODUK DITAMBAH*\n📦 ${name}\n🆔 ID: ${newId}` });

                // D. Broadcast ke Channel WA (Jika ada)
                if(env.CHANNEL_ID) {
                    let broadcast = `✨ *NEW ARRIVAL UPDATE* ✨\n`;
                    broadcast += `━━━━━━━━━━━━━━━━━━\n\n`;
                    broadcast += `📦 *Produk:* ${name}\n`;
                    broadcast += `🏷️ *Kategori:* ${category.toUpperCase()}\n`;
                    broadcast += `💰 *Harga:* Rp ${price.toLocaleString()}\n`;
                    broadcast += `${specsInfo}\n\n`;
                    broadcast += `🔥 *Kelebihan:*\n`;
                    broadcast += `✅ Server Stabil & Cepat\n`;
                    broadcast += `✅ Garansi Full 30 Hari\n`;
                    broadcast += `✅ Support 24/7\n\n`;
                    broadcast += `🛒 *Order Sekarang Disini:*\n`;
                    broadcast += `${env.PTERO_DOMAIN || 'https://rikishop.my.id'}\n\n`;
                    broadcast += `━━━━━━━━━━━━━━━━━━\n`;
                    broadcast += `_Riki Shop Real System_`;
                    
                    try { await sock.sendMessage(env.CHANNEL_ID, { text: broadcast }); } catch(e) {}
                }
            }
        }

        // ==========================================
        // 3. DELETE PRODUK
        // ==========================================
        if (command === '.delproduk') {
            if (args.length < 1) return sock.sendMessage(from, { text: '❌ Masukkan ID.' });
            const targetId = parseInt(args[0].trim());
            const index = products.findIndex(p => p.id === targetId);

            if (index === -1) return sock.sendMessage(from, { text: `❌ ID ${targetId} tidak ditemukan.` });

            const deletedItem = products[index];
            
            // A. Hapus Produk
            products.splice(index, 1);
            writeProducts(products);

            // B. Notifikasi Website (Lonceng)
            db.notifications.unshift({
                title: "📢 INFO STOK",
                msg: `Produk ${deletedItem.name} sudah SOLD OUT/HABIS.`,
                time: new Date().toISOString()
            });
            writeDB(db);

            // C. Respon Admin
            await sock.sendMessage(from, { text: `🗑️ *PRODUK DIHAPUS*\n📦 ${deletedItem.name}` });

            // D. Broadcast Channel WA
            if(env.CHANNEL_ID) {
                try { 
                    await sock.sendMessage(env.CHANNEL_ID, { text: `📢 *INFO STOK HABIS*\n\nMaaf, produk *${deletedItem.name}* saat ini sudah SOLD OUT. 🙏` }); 
                } catch(e) {}
            }
        }
    }
};
