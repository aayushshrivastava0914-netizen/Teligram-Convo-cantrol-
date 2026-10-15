// ===== TELEGRAM BOT CONTROLS =====

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

let telegramBot = null;
let stopRequested = false;

if (TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
        polling: true
    });

    function isOwner(msg) {
        return TELEGRAM_OWNER_ID &&
            String(msg.from.id) === String(TELEGRAM_OWNER_ID);
    }

    telegramBot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
        if (!isOwner(msg)) {
            return telegramBot.sendMessage(
                msg.chat.id,
                '⛔ Access denied.'
            );
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            'नमस्ते भाई! ❤️ आपका Telegram Bot चालू है।\n\n' +
            '/status - सर्वर का स्टेटस देखें\n' +
            '/stop - Stop Request सेट करें'
        );
    });

    telegramBot.onText(/^\/status(?:@\w+)?$/, async (msg) => {
        if (!isOwner(msg)) {
            return telegramBot.sendMessage(msg.chat.id, '⛔ Access denied.');
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            '✅ Server Online\n' +
            '⏱️ Uptime: ' + Math.floor(process.uptime()) + ' seconds\n' +
            '📊 Active Sessions: ' + activeSessions.size + '\n' +
            '🛑 Stop Requested: ' + (stopRequested ? 'Yes' : 'No')
        );
    });

    telegramBot.onText(/^\/stop(?:@\w+)?$/, async (msg) => {
        if (!isOwner(msg)) {
            return telegramBot.sendMessage(msg.chat.id, '⛔ Access denied.');
        }

        stopRequested = true;

        // Stop active sessions safely.
        for (const [key, session] of activeSessions.entries()) {
            session.running = false;
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            '🛑 Stop request set. Active sessions have been asked to stop.'
        );
    });

    telegramBot.on('polling_error', (error) => {
        console.error('Telegram polling error:', error.message);
    });

    console.log('Telegram bot initialized.');
} else {
    console.error('TELEGRAM_BOT_TOKEN is missing from Render Environment.');
}

// ===== END TELEGRAM BOT CONTROLS =====
