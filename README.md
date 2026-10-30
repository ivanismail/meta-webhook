# meta-webhook

## Forward incoming Meta messages

The Meta webhook `POST /` forwards incoming `messages` events to the configured
application webhook. It looks up `session_id` using the incoming
`metadata.phone_number_id` in `whatsapp_sessions`. Delivery/read status events
are acknowledged without forwarding.

Set `INBOUND_WEBHOOK_API_KEY` to the API key for the receiver. The receiver URL
defaults to `https://localhost/api/whatsapp/webhook` and can be
overridden with `INBOUND_WEBHOOK_URL`. The endpoint must respond with JSON
containing `"status": true`; unsuccessful forwarding returns HTTP 500 to Meta
so the event can be retried.

Forwarded message fields map from Meta as follows: `from` from the sender,
`to` from `metadata.display_phone_number`, `body` from the text or media
caption, `type` from the message type, `t` from the Unix timestamp, and
`pushName` from the matching contact profile.

## Send a WhatsApp message

`POST /send-message` looks up the session's `phone_number_id` in
`whatsapp_sessions` and sends a text message through the WhatsApp Graph API.

Configure these environment variables before starting the app:

- `WHATSAPP_ACCESS_TOKEN`: WhatsApp Cloud API access token.
- `MYSQL_PASSWORD`: password for the MySQL user (may be empty if the account has
  no password).
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_DATABASE`: optional; default to
  `localhost`, `root`, and `wa`.

The database table must have `session_id` and `phone_number_id` columns. Install
dependencies with `npm install`, then start the server with `npm start`.

Request body:

```json
{
  "session": "tenant-4-customer-service",
  "number": "6282113032503",
  "message": "Halo"
}
```

The request uses `number` as the recipient and `message` as the text body.

## Send an image

`POST /send-media` sends an image using the `media` HTTPS URL. The `message`
value is used as the image caption.

```json
{
  "session": "tenant-1-customer-service",
  "number": "6282113032503",
  "message": "test bro",
  "media": "https://picsum.photos/id/237/1200/800.jpg"
}
```
