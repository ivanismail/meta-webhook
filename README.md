# meta-webhook

## Send a WhatsApp message

`POST /send-message` looks up the session's `phone_number_id` in
`whatsapp_sessions` and sends a text message through the WhatsApp Graph API.

Configure these environment variables before starting the app:

- `WHATSAPP_ACCESS_TOKEN`: WhatsApp Cloud API access token.
- `MYSQL_PASSWORD`: password for the MySQL user (may be empty if the account has
  no password).
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_DATABASE`: optional; default to
  `localhost`, `userapp`, and `wa_saas`.

The database table must have `session` and `phone_number_id` columns. Install
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
