require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const TelegramBot = require('node-telegram-bot-api');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 5000;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.TELEGRAM_OWNER_ID;
const AUTH_DIR = process.env.WA_AUTH_DIR ||
    path.join(__dirname, 'auth_info');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const users = new Map();

let bot = null;
let waSocket = null;
let waStatus = 'DISCONNECTED';
let loaderRunning = false;
let pairingInProgress = false;

function isOwner(msg) {
    return Boolean(
        msg.from &&
        OWNER_ID &&
        String(msg.from.id) === String(OWNER_ID)
    );
}

function getUser(id) {
    if (!users.has(id)) {
        users.set(id, {
            step: 'uid',
            uid: '',
            phone: '',
            loaderName: ''
        });
    }

    return users.get(id);
}

function menu() {
    return {
        reply_markup: {
            keyboard: [
                ['🆔 Submit UID'],
                ['📱 Submit WhatsApp Number'],
                ['🏷️ Loader Name'],
                ['🔐 Generate Pairing Code'],
                ['📊 Loader Status'],
                ['▶️ Start Loader', '🛑 Stop Loader']
            ],
            resize_keyboard: true
        }
    };
}

async function send(chatId, message, options = {}) {
    if (bot) {
        return bot.sendMessage(chatId, message, options);
    }
}

async function connectWhatsApp(phone, chatId) {
    if (pairingInProgress) {
        return send(chatId, '⏳ Pairing already in progress.');
    }

    pairingInProgress = true;
    waStatus = 'CONNECTING';

    try {
        fs.mkdirSync(AUTH_DIR, { recursive: true });

        const { state, saveCreds } =
            await useMultiFileAuthState(AUTH_DIR);

        const { version } =
            await fetchLatestBaileysVersion();

        waSocket = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome')
        });

        waSocket.ev.on('creds.update', saveCreds);

        waSocket.ev.on('connection.update', async update => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                waStatus = 'CONNECTED';
                pairingInProgress = false;

                await send(
                    chatId,
                    '✅ WhatsApp connected successfully!',
                    menu()
                );
            }

            if (connection === 'close') {
                waStatus = 'DISCONNECTED';
                pairingInProgress = false;

                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut) {
                    await send(
                        chatId,
                        '⚠️ WhatsApp logged out. Run /pair again.'
                    );
                }
            }
        });

        if (!state.creds.registered) {
            await new Promise(resolve => setTimeout(resolve, 1500));

            const code = await waSocket.requestPairingCode(
                phone.replace(/\D/g, '')
            );

            await send(
                chatId,
                `🔐 Pairing Code: ${code}\n\n` +
                'WhatsApp → Linked Devices → Link a Device → ' +
                'Link with phone number.\n\n' +
                '⚠️ अपना pairing code किसी से साझा न करें।'
            );
        } else {
            pairingInProgress = false;

            await send(
                chatId,
                'ℹ️ Saved WhatsApp session मिली है।',
                menu()
            );
        }
    } catch (error) {
        pairingInProgress = false;
        waStatus = 'ERROR';

        console.error('WhatsApp error:', error);

        await send(
            chatId,
            `❌ Pairing error: ${error.message}`
        );
    }
}

app.get('/', (req, res) => {
    const index = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(index)) {
        return res.sendFile(index);
    }

    res.send('Telegram WhatsApp service is online.');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ONLINE',
        whatsapp: waStatus,
        uptime: Math.floor(process.uptime())
    });
});

app.get('/stats', (req, res) => {
    res.json({
        status: 'ONLINE',
        whatsapp: waStatus,
        loaderRunning,
        uptime: Math.floor(process.uptime())
    });
});

app.post('/stop', (req, res) => {
    loaderRunning = false;

    res.json({
        success: true,
        message: 'Loader stopped.'
    });
});

if (!TOKEN || !OWNER_ID) {
    console.error(
        'Set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID in Render Environment.'
    );
} else {
    bot = new TelegramBot(TOKEN, { polling: true });

    bot.onText(/^\/start$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);
        user.step = 'uid';

        await send(
            msg.chat.id,
            '🤖 Welcome!\n\nअपनी UID भेजें:',
            menu()
        );
    });

    bot.onText(/^\/pair$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);

        if (!user.phone) {
            return send(
                msg.chat.id,
                'पहले /start चलाकर WhatsApp नंबर दर्ज करें।'
            );
        }

        await connectWhatsApp(user.phone, msg.chat.id);
    });

    bot.onText(/^\/startloader$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);

        if (!user.uid || !user.phone || !user.loaderName) {
            return send(
                msg.chat.id,
                'पहले /start चलाकर UID, WhatsApp नंबर और Loader Name भरें।',
                menu()
            );
        }

        if (waStatus !== 'CONNECTED') {
            return send(
                msg.chat.id,
                '❌ WhatsApp connected नहीं है। पहले /pair चलाएँ।'
            );
        }

        loaderRunning = true;

        await send(
            msg.chat.id,
            `✅ ${user.loaderName} की loader state RUNNING है।\n` +
            'वास्तविक messaging engine अभी शामिल नहीं है।',
            menu()
        );
    });

    bot.onText(/^\/stop$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        loaderRunning = false;

        await send(
            msg.chat.id,
            '🛑 Loader stopped.',
            menu()
        );
    });

    bot.onText(/^\/status$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);

        await send(
            msg.chat.id,
            '📊 BOT STATUS\n\n' +
            `Server: ONLINE\n` +
            `WhatsApp: ${waStatus}\n` +
            `Loader: ${loaderRunning ? 'RUNNING' : 'STOPPED'}\n` +
            `UID: ${user.uid ? 'SAVED' : 'NOT SET'}\n` +
            `Phone: ${user.phone ? 'SAVED' : 'NOT SET'}\n` +
            `Loader Name: ${user.loaderName || 'NOT SET'}`,
            menu()
        );
    });

    bot.onText(/^\/help$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        await send(
            msg.chat.id,
            '/start - Setup\n' +
            '/pair - WhatsApp pairing\n' +
            '/startloader - Start loader state\n' +
            '/status - Check status\n' +
            '/stop - Stop loader\n' +
            '/help - Help',
            menu()
        );
    });

    bot.on('message', async msg => {
        if (!msg.text || !isOwner(msg)) return;
        if (msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const user = getUser(msg.from.id);
        const text = msg.text.trim();

        if (text === '🆔 Submit UID') {
            user.step = 'uid';
            return send(chatId, 'अपनी UID भेजें:');
        }

        if (text === '📱 Submit WhatsApp Number') {
            user.step = 'phone';
            return send(
                chatId,
                'WhatsApp नंबर country code सहित भेजें।\nउदाहरण: +91XXXXXXXXXX'
            );
        }

        if (text === '🏷️ Loader Name') {
            user.step = 'loaderName';
            return send(chatId, 'Loader Name भेजें:');
        }

        if (text === '🔐 Generate Pairing Code') {
            if (!user.phone) {
                return send(chatId, 'पहले अपना WhatsApp नंबर दर्ज करें।');
            }

            return connectWhatsApp(user.phone, chatId);
        }

        if (text === '📊 Loader Status') {
            return send(
                chatId,
                `WhatsApp: ${waStatus}\n` +
                `Loader: ${loaderRunning ? 'RUNNING' : 'STOPPED'}`,
                menu()
            );
        }

        if (text === '▶️ Start Loader') {
            if (waStatus !== 'CONNECTED') {
                return send(chatId, 'पहले WhatsApp pair करें।');
            }

            loaderRunning = true;

            return send(
                chatId,
                '✅ Loader state RUNNING है।',
                menu()
            );
        }

        if (text === '🛑 Stop Loader') {
            loaderRunning = false;
            return send(chatId, '🛑 Loader stopped.', menu());
        }

        if (user.step === 'uid') {
            if (text.length < 3 || text.length > 100) {
                return send(chatId, 'UID 3–100 characters की होनी चाहिए।');
            }

            user.uid = text;
            user.step = 'phone';

            return send(
                chatId,
                '✅ UID saved.\nअब WhatsApp नंबर country code सहित भेजें।'
            );
        }

        if (user.step === 'phone') {
            const phone = text.replace(/[\s()-]/g, '');

            if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
                return send(
                    chatId,
                    '❌ सही format में नंबर भेजें। उदाहरण: +91XXXXXXXXXX'
                );
            }

            user.phone = phone;
            user.step = 'loaderName';

            await send(
                chatId,
                '✅ Number saved.\nअब Loader Name भेजें।'
            );

            return;
        }

        if (user.step === 'loaderName') {
            if (text.length < 2 || text.length > 50) {
                return send(
                    chatId,
                    'Loader Name 2–50 characters का होना चाहिए।'
                );
            }

            user.loaderName = text;
            user.step = 'ready';

            return send(
                chatId,
                `✅ Setup complete!\nLoader Name: ${user.loaderName}\n\n` +
                'Pairing code के लिए /pair चलाएँ।',
                menu()
            );
        }

        if (user.step === 'ready') {
            return send(
                chatId,
                'Menu से विकल्प चुनें या /help चलाएँ।',
                menu()
            );
        }
    });

    bot.on('polling_error', error => {
        console.error('Telegram polling error:', error.message);
    });

    console.log('Telegram bot initialized.');
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
