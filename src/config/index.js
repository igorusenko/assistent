require('dotenv').config();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const N8N_CONFIG_WEBHOOK_URL = process.env.N8N_CONFIG_WEBHOOK_URL || 'https://dev-115-n8n.aitency.net/webhook/config';

if (!OPENAI_API_KEY) {
    console.error('⚠️  WARNING: OPENAI_API_KEY не установлен! Установите переменную окружения.');
}

module.exports = {
    PORT,
    OPENAI_API_KEY,
    N8N_CONFIG_WEBHOOK_URL
};

