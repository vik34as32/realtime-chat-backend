# Real-Time Chat Backend API

Small Express API for one-to-one chats. MySQL stores users, chats, and chat members. Firebase Firestore stores messages, read receipts, and last-seen positions.

Create an account with `POST /user/register`, then login with `POST /user/login`. After login, send the token in the `Authorization` header. Do not send `x-user-id`.

## Project structure

```text
src/
  config/db.ts                 MySQL connection pool
  config/firebase.ts           Firebase Admin SDK, initialized once
  controllers/chat.controller.ts
  controllers/user.controller.ts
  middlewares/errorHandler.ts  Consistent JSON errors
  routes/chat.routes.ts
  routes/user.routes.ts
  services/chat.service.ts     MySQL and Firestore chat operations
  services/user.service.ts     Register, login, and token lookup
  types/chat.types.ts
  utils/errors.ts
  utils/validate.ts            Request checks
  app.ts
  server.ts
database/schema.sql
```

## Prerequisites

- Node.js 20 or newer
- MySQL 8
- A Firebase project with Cloud Firestore
- A Firebase service-account JSON file kept outside Git

## 1. Install dependencies

```powershell
npm install
```

## 2. Create the MySQL database

The schema creates the `realtime_chat` database and three tables. Accounts are created from the API, not from SQL.

Run it with a MySQL account that can create databases:

```powershell
mysql -u root -p < database/schema.sql
```

If `mysql` is not on your PATH, use the full path to `mysql.exe`.

Running the script again deletes local accounts and chats, then creates the tables again. Do that once after this update so `phone`, `profile_url`, and `password_hash` exist.

### Tables

`users` stores `id`, `name`, `email`, `phone`, `profile_url`, `password_hash`, and `created_at`. Email and phone are unique. The password is stored as a hash. Login returns a signed JSON Web Token and does not save that token in MySQL.

`chats` stores `id`, `created_at`, and `updated_at`. It also stores `pair_key`, such as `1:2`. The two user IDs are always written with the smaller ID first, so user 2 + user 1 is the same chat as user 1 + user 2. `pair_key` is unique, which rejects a second one-to-one chat for the same people.

`chat_members` stores `chat_id`, `user_id`, and `created_at`. The primary key is `(chat_id, user_id)`, so a user cannot join the same chat twice. Both columns have foreign keys.

Creating a chat locks the two user rows inside a transaction, in ascending ID order, then inserts the chat and both members. If two requests race, the unique `pair_key` lets one insert succeed. The other request returns the chat that was just created.

`chats.updated_at` changes when the chat is created and when a message is sent. Listing chats uses this MySQL column only. It does not read Firestore.

## 3. Configure Firebase

1. Create a Firebase project.
2. Create a Firestore database.
3. Open Project settings → Service accounts → Generate new private key.
4. Save that JSON file as `secrets/firebase-service-account.json`.
5. Do not commit the file. `secrets/` and service-account JSON files are listed in `.gitignore`.

Firestore layout:

```text
chats/{chatId}/messages/{messageId}
  senderId, text, createdAt, readBy

chats/{chatId}/messages/{messageId}/readReceipts/{userId}
  userId, messageId, readAt

chats/{chatId}/lastSeen/{userId}
  userId, lastSeenMessageId, updatedAt
```

`createdAt`, `readAt`, and `updatedAt` are Firestore server timestamps. `readBy` is an array of user IDs. A new message starts with the sender's ID in `readBy`. Marking a message read uses `arrayUnion`, so other users stay in the array and the same user is not added twice. The separate receipt document stores the server timestamp for that reader.

Message reads are ordered by `createdAt` and then by the document ID. In the Firebase console, create these two composite indexes if Firestore asks for them. The collection ID is `messages` and the scope is Collection:

| Field        | Order      |
|--------------|------------|
| createdAt    | Ascending  |
| Document ID  | Ascending  |

| Field        | Order       |
|--------------|-------------|
| createdAt    | Descending  |
| Document ID  | Descending  |

If a query still fails, the server log contains the Firestore error and the index link. The API response does not include that link.

Messages with no `createdAt` cannot be ordered, so Firestore omits them from these pages. If a stored timestamp is not a Firestore timestamp, the API returns `createdAt: null` instead of crashing. A missing timestamp cannot be used as a pagination cursor or as a last-seen position.

## 4. Environment variables

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

| Variable | Purpose |
|----------|---------|
| `PORT` | API port. Default in the example is `3000`. |
| `MYSQL_HOST` | MySQL host |
| `MYSQL_PORT` | MySQL port |
| `MYSQL_USER` | MySQL user |
| `MYSQL_PASSWORD` | MySQL password. Empty is allowed. |
| `MYSQL_DATABASE` | Database name. Use `realtime_chat` if you ran the schema as written. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Path to the service-account JSON file |
| `JWT_SECRET` | Secret used to sign login tokens. Do not commit the real value. |

Do not put real passwords or the Firebase private key in `.env.example`, source files, or Git.

## 5. Run the server

Development, with restart handled by starting `tsx` again after code changes:

```powershell
npm run dev
```

Production build and start:

```powershell
npm run build
npm start
```

`npm run build` compiles `src` to `dist` with TypeScript strict mode.

## Login token

Register and login return a JSON Web Token in `data.token`. The token expires after 7 days. Register and login do not need a header. Every other request needs:

```text
Authorization: Bearer YOUR_TOKEN
```

Copy `token` from the register or login response. In Postman, add header key `Authorization` and value `Bearer YOUR_TOKEN`. The logged-in user is the sender, so message, read, and last-seen bodies do not include a user id. An old random token from before this change will not work. Register or login again.

## Response format

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "message": "Useful error message"
}
```

Status codes:

| Code | When |
|------|------|
| 200 | Read succeeded, or the chat already existed |
| 201 | A chat or message was created |
| 400 | Invalid input, self-chat, or last seen moved backwards |
| 401 | Missing login token, or email/password is wrong |
| 403 | The header user is not allowed |
| 404 | User, chat, or message was not found |
| 500 | Unexpected server error |

Error responses do not include database credentials, Firebase credentials, SQL, or stack traces. Unexpected errors are printed on the server only.

User IDs in JSON bodies are numbers, not strings.

## Create account

`POST /user/register`

No header.

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "phone": "9876543210",
  "profileUrl": "https://example.com/alice.jpg",
  "password": "alice123"
}
```

`profile_url` is also accepted. `password` is required so the user can login. The response includes `token` and the user. Status `201`.

## Login

`POST /user/login`

No header.

```json
{
  "email": "alice@example.com",
  "password": "alice123"
}
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "token": "login-token",
    "user": {
      "id": 1,
      "name": "Alice",
      "email": "alice@example.com",
      "phone": "9876543210",
      "profileUrl": "https://example.com/alice.jpg"
    }
  }
}
```

## API 1: Create or get chat

`POST /chat/create`

Header: `Authorization: Bearer YOUR_TOKEN`

`userId` is the other person. The logged-in user is added automatically.

```json
{
  "userId": 2
}
```

- Both IDs must be positive integers.
- Both users must already exist.
- A user cannot create a chat with themselves.
- Sending the same pair again, in either order, returns the original chat.

First response, `201`:

```json
{
  "success": true,
  "data": {
    "chatId": 1
  }
}
```

Later response for the same pair, `200`:

```json
{
  "success": true,
  "data": {
    "chatId": 1
  }
}
```

Errors:

| Status | Example |
|--------|---------|
| 400 | `userId` is missing, or it is your own id |
| 401 | Login token is missing |
| 404 | The other user does not exist |

## API 2: Send message

`POST /chat/:chatId/message/send`

Header: `Authorization: Bearer YOUR_TOKEN`

The logged-in user is the sender.

```json
{
  "text": "Hello"
}
```

`text` must not be empty. The sender must be a member of the chat. Firestore generates the message ID.

Response, `201`:

```json
{
  "success": true,
  "data": {
    "messageId": "firestoreMessageId",
    "senderId": 1,
    "text": "Hello",
    "createdAt": "2026-10-28T10:00:00.000Z",
    "readBy": [1]
  }
}
```

`createdAt` is `null` only when Firestore did not return a timestamp. The saved document still uses a server timestamp. If MySQL cannot update `chats.updated_at` after the message is saved, the request still returns `201` and the server logs that failure.

Errors:

| Status | Example |
|--------|---------|
| 400 | Empty text |
| 401 | Login token is missing |
| 403 | The logged-in user is not a member of the chat |
| 404 | Chat does not exist |

## API 3: Get messages

`GET /chat/:chatId/messages?limit=50`

The logged-in user must be a member of the chat. Header: `Authorization: Bearer YOUR_TOKEN`. No body.

Without a cursor, the API returns the latest page. `limit` defaults to 50 and cannot be higher than 100. The messages inside the page are ordered oldest first. Firestore performs the ordering. The server does not load the whole chat and sort it in Node.js.

Response, `200`:

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "messageId": "olderMessageId",
        "senderId": 1,
        "text": "Hello",
        "createdAt": "2026-10-28T10:00:00.000Z",
        "readBy": [1, 2]
      }
    ],
    "pagination": {
      "limit": 50,
      "hasMore": false,
      "olderCursor": "base64urlCursor",
      "newerCursor": "base64urlCursor"
    }
  }
}
```

`hasMore` means another page exists in the direction you requested. On the first page, that direction is older messages.

Older page:

```text
GET /chat/1/messages?limit=50&cursor=OLDER_CURSOR&direction=before
```

Newer page:

```text
GET /chat/1/messages?limit=50&cursor=NEWER_CURSOR&direction=after
```

Use `olderCursor` with `direction=before`, and `newerCursor` with `direction=after`. If `cursor` is omitted, `direction` is ignored. An invalid cursor returns `400`.

The cursor includes the message timestamp and document ID, so two messages saved in the same millisecond do not get skipped or repeated.

Errors:

| Status | Example |
|--------|---------|
| 400 | `limit` is 0, 101, or not an integer; cursor is invalid |
| 403 | The logged-in user is not a member |
| 404 | Chat does not exist |

## API 4: Mark message read

`POST /chat/:chatId/message/:messageId/read`

The logged-in user must belong to the chat, and the message must be in that chat. The user is added to `readBy` with `arrayUnion`. A receipt document stores `readAt`. Calling this again returns success and does not add the user a second time.

Response, `200`:

```json
{
  "success": true,
  "data": {
    "messageId": "firestoreMessageId",
    "userId": 2,
    "readBy": [1, 2],
    "readAt": "2026-10-28T10:05:00.000Z"
  }
}
```

Errors:

| Status | Example |
|--------|---------|
| 401 | Login token is missing |
| 403 | The logged-in user is not a member |
| 404 | Chat or message does not exist |

## API 5: Update last seen message

`POST /chat/:chatId/lastseen`

Header: `Authorization: Bearer YOUR_TOKEN`

```json
{
  "messageId": "firestoreMessageId"
}
```

This writes one Firestore document for that chat and user:

```json
{
  "userId": 2,
  "lastSeenMessageId": "firestoreMessageId",
  "updatedAt": "server timestamp"
}
```

The message must exist in the chat. The update runs in a Firestore transaction. If the new message is older than the saved last-seen message, the API returns `400` and does not change the document. Two messages with the same timestamp are ordered by their Firestore document IDs. Sending the same `messageId` again is a retry: it returns `200` and leaves the saved timestamp in place.

If the previous last-seen message was deleted, the new message is accepted because there is no older timestamp left to compare. If either timestamp is missing, the API refuses the move instead of guessing.

Response, `200`:

```json
{
  "success": true,
  "data": {
    "userId": 2,
    "lastSeenMessageId": "firestoreMessageId",
    "updatedAt": "2026-10-28T10:06:00.000Z"
  }
}
```

Errors:

| Status | Example |
|--------|---------|
| 400 | Message ID is invalid, the message has no timestamp, or the move is backwards |
| 401 | Login token is missing |
| 403 | The logged-in user is not a member |
| 404 | Chat or message does not exist |

## API 6: List user chats

`GET /user/chats`

Header: `Authorization: Bearer YOUR_TOKEN`. No body. This returns the logged-in user's chats.

Response, `200`:

```json
{
  "success": true,
  "data": {
    "chats": [
      {
        "chatId": 1,
        "memberIds": [1, 2],
        "createdAt": "2026-10-28T09:55:00.000Z",
        "updatedAt": "2026-10-28T10:00:00.000Z"
      }
    ]
  }
}
```

Chats are ordered by `updated_at` descending. An existing user with no chats gets an empty array. This query reads MySQL only.

Errors:

| Status | Example |
|--------|---------|
| 401 | Login token is missing |

## Postman

1. Start the server with `npm run dev`.
2. Open Postman and click **New** → **HTTP Request**.
3. Set the method and URL. Example: `POST` and `http://localhost:3000/chat/create`.
4. For chat requests, open the **Headers** tab and add `Authorization` with value `Bearer YOUR_TOKEN`. Register and login do not need this header.
5. For POST requests, open **Body** → **raw** → **JSON** and paste the request body from the API section above.
6. Click **Send**.
7. Copy `chatId` and `messageId` from the response and use them in the next URL.

There is no Postman collection file in this project. Create one request at a time. Use the same base URL, `http://localhost:3000`, for every API.

## Suggested test order

1. Run `database/schema.sql` again so the new user columns exist.
2. Start the server with `npm run dev`.
3. Register two accounts and save each `token` and `id`.
4. Login as the first user.
5. Create a chat with the second user's `id`.
6. Send a message with only `text`.
7. Login as the second user and read the messages with that token.

## Verification

`npx tsc --noEmit` completed successfully after register and login were added.

Register, login, and sending a message were not called against MySQL or Firestore in this session. MySQL was running, but no project `.env` password was configured, and there is no Firebase service-account file.
