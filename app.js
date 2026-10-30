require('dotenv').config();
// Import Express.js
const express = require('express');
const mysql = require('mysql2/promise');

// Create an Express app
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Set port and verify_token
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const inboundWebhookUrl =
  process.env.INBOUND_WEBHOOK_URL || 'https://localhost/api/whatsapp/webhook';
const inboundWebhookApiKey = process.env.INBOUND_WEBHOOK_API_KEY;
const db = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'wa',
  waitForConnections: true,
  connectionLimit: 10,
});

// Route for GET requests
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

async function forwardMetaMessage(message, metadata, contacts) {
  const [sessions] = await db.execute(
    'SELECT session_id FROM whatsapp_sessions WHERE phone_number_id = ? LIMIT 1',
    [metadata.phone_number_id]
  );
  if (sessions.length === 0 || !sessions[0].session_id) {
    throw new Error(`No session found for phone_number_id ${metadata.phone_number_id}`);
  }

  const contact = contacts.find((item) => item.wa_id === message.from) || contacts[0];
  const timestamp = Number(message.timestamp);
  const payload = {
    event: 'message',
    session: sessions[0].session_id,
    data: {
      from: message.from,
      to: metadata.display_phone_number,
      body:
        message.text?.body ??
        message.image?.caption ??
        message.video?.caption ??
        message.document?.caption ??
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        '',
      type: message.type,
      t: Number.isFinite(timestamp) ? timestamp : message.timestamp,
      fromMe: false,
      pushName: contact?.profile?.name ?? null,
    },
  };

  let response;
  try {
    response = await fetch(inboundWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': inboundWebhookApiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Forward webhook request failed:', error.message);
    throw new Error('Could not reach the forwarding webhook');
  }

  let responseBody;
  try {
    responseBody = await response.json();
  } catch (error) {
    console.error('Forward webhook returned invalid JSON:', error.message);
    throw new Error('Forward webhook returned an invalid response');
  }

  if (!response.ok || responseBody.status !== true) {
    console.error('Forward webhook rejected the message:', response.status, responseBody);
    throw new Error('Forward webhook did not confirm the message');
  }
}

// Route for POST requests
app.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const pendingMessages = [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        if (change?.field !== 'messages') continue;

        const value = change.value || {};
        const metadata = value.metadata || {};
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const contacts = Array.isArray(value.contacts) ? value.contacts : [];

        if (messages.length === 0) continue;
        if (!metadata.phone_number_id || !metadata.display_phone_number) {
          throw new Error('Meta message is missing phone number metadata');
        }

        for (const message of messages) {
          pendingMessages.push({ message, metadata, contacts });
        }
      }
    }

    if (pendingMessages.length === 0) return res.status(200).end();

    if (!inboundWebhookApiKey) {
      console.error('INBOUND_WEBHOOK_API_KEY is not configured');
      return res.status(500).end();
    }

    for (const pendingMessage of pendingMessages) {
      await forwardMetaMessage(
        pendingMessage.message,
        pendingMessage.metadata,
        pendingMessage.contacts
      );
    }

    return res.status(200).end();
  } catch (error) {
    console.error('Failed to process Meta webhook:', error);
    return res.status(500).end();
  }
});

app.post('/send-message', async (req, res) => {
  const { session, number, message } = req.body || {};
  if (
    typeof session !== 'string' || !session.trim() ||
    typeof number !== 'string' || !number.trim() ||
    typeof message !== 'string' || !message.trim()
  ) {
    return res.status(400).json({
      error: 'session, number, and message must be non-empty strings',
    });
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(503).json({ error: 'WhatsApp access token is not configured' });
  }

  try {
    const [sessions] = await db.execute(
      'SELECT phone_number_id FROM whatsapp_sessions WHERE session_id = ? LIMIT 1',
      [session.trim()]
    );
    if (sessions.length === 0) {
      return res.status(404).json({ error: 'WhatsApp session not found' });
    }

    const phoneNumberId = sessions[0].phone_number_id;
    if (!phoneNumberId) {
      return res.status(500).json({ error: 'Session has no phone_number_id' });
    }

    let response;
    try {
      response = await fetch(
        `https://graph.facebook.com/v25.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: number.trim(),
            type: 'text',
            text: { body: message },
          }),
        }
      );
    } catch (error) {
      console.error('WhatsApp API request failed:', error);
      return res.status(502).json({ error: 'Could not reach WhatsApp API' });
    }

    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      console.error('WhatsApp API returned invalid JSON:', error);
      return res.status(502).json({ error: 'WhatsApp API returned an invalid response' });
    }

    if (!response.ok) {
      console.error('WhatsApp API returned an error:', response.status, responseBody);
      return res.status(502).json({
        error: 'WhatsApp API request failed',
        details: responseBody,
      });
    }

    return res.status(200).json(responseBody);
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }
});

app.post('/send-media', async (req, res) => {
  const { session, number, message, media } = req.body || {};
  if (
    typeof session !== 'string' || !session.trim() ||
    typeof number !== 'string' || !number.trim() ||
    typeof message !== 'string' || !message.trim() ||
    typeof media !== 'string' || !media.trim()
  ) {
    return res.status(400).json({
      error: 'session, number, message, and media must be non-empty strings',
    });
  }

  let mediaUrl;
  try {
    mediaUrl = new URL(media);
  } catch (error) {
    return res.status(400).json({ error: 'media must be a valid HTTPS URL' });
  }
  if (mediaUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'media must be a valid HTTPS URL' });
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(503).json({ error: 'WhatsApp access token is not configured' });
  }

  try {
    const [sessions] = await db.execute(
      'SELECT phone_number_id FROM whatsapp_sessions WHERE session_id = ? LIMIT 1',
      [session.trim()]
    );
    if (sessions.length === 0) {
      return res.status(404).json({ error: 'WhatsApp session not found' });
    }

    const phoneNumberId = sessions[0].phone_number_id;
    if (!phoneNumberId) {
      return res.status(500).json({ error: 'Session has no phone_number_id' });
    }

    let response;
    try {
      response = await fetch(
        `https://graph.facebook.com/v25.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number.trim(),
            type: 'image',
            image: {
              link: mediaUrl.toString(),
              caption: message,
            },
          }),
        }
      );
    } catch (error) {
      console.error('WhatsApp API request failed:', error);
      return res.status(502).json({ error: 'Could not reach WhatsApp API' });
    }

    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      console.error('WhatsApp API returned invalid JSON:', error);
      return res.status(502).json({ error: 'WhatsApp API returned an invalid response' });
    }

    if (!response.ok) {
      console.error('WhatsApp API returned an error:', response.status, responseBody);
      return res.status(502).json({
        error: 'WhatsApp API request failed',
        details: responseBody,
      });
    }

    return res.status(200).json(responseBody);
  } catch (error) {
    console.error('Failed to send WhatsApp media:', error);
    return res.status(500).json({ error: 'Failed to send WhatsApp media' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});