const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const pino = require('pino');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Johnny Sins Bot is running!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const ai = new GoogleGenAI({ apiKey: 'YOUR_GEMINI_API_KEY' });
const systemInstruction = `أنت مساعد ذكي يدعى "Johnny Sins". أنت حاد في الكلام، صارم، لا تضيع الوقت، وتنفذ الطلبات بجدية تامة وبأعلى دقة علمية وبرمجية. أجب باختصار وحزم واحترافية شديدة.`;

const interactionLogs = new Map();
const spamTracker = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✨ تم الاتصال بالواتساب بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid.endsWith('@g.us')) return;

        const messageBody = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const senderId = msg.key.participant || remoteJid;

        try {
            const groupMetadata = await sock.groupMetadata(remoteJid);
            const participants = groupMetadata.participants;
            const participant = participants.find(p => p.id === senderId);
            const isAdmin = participant ? (participant.admin === 'admin' || participant.admin === 'superadmin') : false;

            if (!isAdmin) {
                const now = Date.now();
                if (!spamTracker.has(senderId)) spamTracker.set(senderId, []);
                let timestamps = spamTracker.get(senderId).filter(t => now - t < 3000);
                timestamps.push(now);
                spamTracker.set(senderId, timestamps);

                if (timestamps.length > 4) {
                    await sock.sendMessage(remoteJid, { text: 'إنت فاكرها فوضى؟ أقلع عن السبام فوراً وإلا سيتم طردك.' }, { quoted: msg });
                    return;
                }
            }

            interactionLogs.set(senderId, {
                id: senderId,
                time: new Date().toLocaleString('ar-EG')
            });

            if (messageBody.trim() === 'جوني سينس') {
                await sock.sendMessage(remoteJid, { text: 'بس يلا' }, { quoted: msg });
                return;
            }

            if (messageBody.startsWith('/bot ')) {
                const query = messageBody.replace('/bot ', '').trim();
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: query,
                    config: { systemInstruction }
                });
                await sock.sendMessage(remoteJid, { text: response.text }, { quoted: msg });
                return;
            }

            if (messageBody.startsWith('/code ')) {
                const codeQuery = messageBody.replace('/code ', '').trim();
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `اشرح وفصل بالتفصيل الدقيق هذا السؤال:\n${codeQuery}`,
                    config: { systemInstruction }
                });
                await sock.sendMessage(remoteJid, { text: response.text }, { quoted: msg });
                return;
            }

            if (messageBody.trim() === '/help') {
                if (interactionLogs.size === 0) {
                    await sock.sendMessage(remoteJid, { text: 'سجل التفاعلات فارغ.' }, { quoted: msg });
                    return;
                }
                let report = '📜 *سجل التفاعلات مع Johnny Sins:*\n\n';
                let i = 1;
                for (let [id, data] of interactionLogs.entries()) {
                    report += `${i}. المستخدم: ${id.split('@')[0]} | الوقت: ${data.time}\n`;
                    i++;
                }
                await sock.sendMessage(remoteJid, { text: report }, { quoted: msg });
                return;
            }

            if (messageBody.trim() === '/recover') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: 'هذا الأمر للمشرفين فقط يا فالح.' }, { quoted: msg });
                    return;
                }
                spamTracker.clear();
                await sock.sendMessage(remoteJid, { text: 'تم تطهير عداد المحادثة بنجاح.' }, { quoted: msg });
                return;
            }

            if (messageBody.startsWith('/block')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, { text: 'لست مشرفاً لتستخدِم صلاحيات الطرد.' }, { quoted: msg });
                    return;
                }
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                if (mentioned && mentioned.length > 0) {
                    try {
                        await sock.groupParticipantsUpdate(remoteJid, [mentioned[0]], 'remove');
                        await sock.sendMessage(remoteJid, { text: 'تم طرد العنصر بنجاح.' }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(remoteJid, { text: 'فشل الطرد. تأكد أن البوت مشرف بالمجموعة.' }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(remoteJid, { text: 'يجب عمل منشن للشخص المراد طرده.' }, { quoted: msg });
                }
                return;
            }

        } catch (error) {
            console.error('خطأ:', error);
        }
    });
}

startBot();
                                           
